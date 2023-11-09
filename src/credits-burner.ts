import { Account, DDO, NFTServiceAttributes, Nevermined, ServiceNFTAccess } from '@nevermined-io/sdk'
import { Client } from 'pg'
import { ConfigEntry, getNVMConfig, postgresConfigTemplate } from './config'

const verbose = process.env.VERBOSE === 'true'
const maxRetries = process.env.MAX_RETRIES || 3

// eslint-disable-next-line @typescript-eslint/no-var-requires
const logger = require('pino')({  
  level: verbose ? 'info' : 'debug',
})

let config: ConfigEntry

interface TransactionsProcessed {
  success: TransactionSuccess[]
  errors: TransactionError[]
}

interface TransactionSuccess {
  logId: string
  creditsBurned: string
  message?: string
}

interface TransactionError {
  logId: string
  errorCode: string
  errorMessage: string
}

const loadNevermined = async (
  config: ConfigEntry,
  verbose: boolean = false
): Promise<Nevermined> => {

  try {
    logger.info(`Connecting to Nevermined at ${config.nvm.web3ProviderUri}`)
    const nvm = await Nevermined.getInstance({
      ...config.nvm,
      verbose: verbose ? verbose : config.nvm.verbose
    })
    
    const accounts = await nvm.accounts.list()
    logger.debug(`Accounts: ${accounts.length}`)    
    accounts.forEach((account) => { logger.debug(account.getId())})
    

    if (!nvm.keeper) {
      logger.error(`ERROR: Nevermined could not connect to the network`)
    }    
    return nvm
  } catch (error) {
    logger.error(`ERROR: ${(error as Error).message}\n`)
    process.exit(1)
}

}

const loadPostgresClient = async (postgresConfig: any): Client => {
  logger.info(`Connecting to Postgres at ${postgresConfig.host}:${postgresConfig.port}`)
  // Set up Postgresql client
  const postgresClient = new Client({
    host: postgresConfig.host,
    port: postgresConfig.port,
    database: postgresConfig.database,
    user: postgresConfig.user,
    password: postgresConfig.password,
  })
  await postgresClient.connect()

  return postgresClient

}

const getTransacionBatches = async (pgClient: Client): Promise<any> => {
  
  try {

    const results = await pgClient.query(`SELECT * FROM public."serviceLogsQueue" WHERE status = 'Pending' AND retried < ${maxRetries}`)
    logger.info(`Logs Found: ${results.rows.length}`)
  
    return results.rows
  } catch (error) {
    logger.error(`Unable to get Transaction batches from database`)
    logger.error(`ERROR: ${(error as Error).message}`)
    process.exit(1)
  }
  
}



const burnTransactions = async (nvm: Nevermined, logs: any[], account: Account): Promise<TransactionsProcessed> => {
  const results = []
  const errors = []
  let activeContractAddress = ''

  logger.debug(`Using account: ${account.getId()}`)

  for await (const log of logs) {
  
    logger.info(`Processing (burn) transaction: ${log.logId}`)    

    try {
      // 1. Get the DID from the log
      const logEntry = JSON.parse(log.logLine)
      const serviceDID = logEntry.scope
      const userId = logEntry.user_id   
      const upstreamStatus = logEntry.upstream_status   
      let creditsConsumed: bigint
      
      if (serviceDID === undefined || serviceDID === '')
        throw new Error(`Invalid DID: ${serviceDID}`)
      if (userId === undefined || userId === '')
        throw new Error(`Invalid userId: ${userId}`)
      if (upstreamStatus.startsWith('2') === false)
        throw new Error(`Upstream Service didnt work so we dont charge credits for it`)
      
      if (logEntry.upstream_http_NVMCreditsConsumed === undefined || logEntry.upstream_http_NVMCreditsConsumed === '' || BigInt(logEntry.upstream_http_NVMCreditsConsumed) < 1n)
        creditsConsumed = 1n
      else
        creditsConsumed = BigInt(logEntry.upstream_http_NVMCreditsConsumed)

      // 2. Resolve the DDO from the DID
      logger.debug(`Resolving DID: ${serviceDID}`)
      const ddo = await nvm.assets.resolve(serviceDID)

      // 3. Load the NFT contract
      const nftAccess = ddo.findServiceByReference('nft-access')
      const ddoContractAddress = DDO.getNftContractAddressFromService(nftAccess as ServiceNFTAccess)
      const tokenId = DDO.getTokenIdFromService(nftAccess)
      const subscriptionDID = `did:nv:${tokenId}`

      if (ddoContractAddress !== activeContractAddress) {
        logger.debug(`Loading NFT from address: ${ddoContractAddress}`)
        await nvm.contracts.loadNft1155(ddoContractAddress)
        activeContractAddress = ddoContractAddress
      } else {
        logger.debug(`NFT contract already loaded, skipping`)
      }

      
      const adjustedCredits = NFTServiceAttributes.getCreditsToCharge(
        nftAccess.attributes.main.nftAttributes, creditsConsumed
      )
      
      logger.debug(`Credits requested to burn (by upstream service): ${creditsConsumed}`)
      logger.debug(`Adjusted Amount to burn: ${adjustedCredits}`)

      if (adjustedCredits === undefined || adjustedCredits < 1n)  { // The NFT Access Service is a free service
        logger.info(`Skipping DID ${serviceDID} because it is a free service`)
        results.push({ logId: log.logId, creditsBurned: 0n, message: 'Free Service' })
        
      } else {
        const userBalance = await nvm.nfts1155.balance(subscriptionDID, userId)
        logger.debug(`User [${userId}] balance: ${userBalance} for tokenId: ${tokenId}`)

        // 5. Burn the NFT        
        logger.debug(`Credits to burn: ${adjustedCredits} from subscription: ${subscriptionDID}`)                
        if (NFTServiceAttributes.isCreditsBalanceEnough(nftAccess.attributes.main.nftAttributes, userBalance)) {
          logger.info(`Burning ${adjustedCredits} credits from user ${userId} on DID ${subscriptionDID} using account ${account.getId()}`)          
          await nvm.nfts1155.burnFromHolder(userId, tokenId, adjustedCredits, account)
          results.push({ logId: log.logId, creditsBurned: adjustedCredits, message: 'Burned' })

        } else {
          throw new Error(`User ${userId} does not have enough credits to burn ${creditsConsumed} credits on DID ${serviceDID}`)
        }
  
      }

    } catch (error) {
      logger.warn(`Unable to process Nevermined transaction: ${log.logId}`)
      logger.warn(`ERROR: ${(error as Error).message}`)
      errors.push({logId: log.logId, errorCode: 'BURN-001', errorMessage: (error as Error).message.replace('\'', '').replace('"', '')})
    }
    
  }
  return { success: results, errors }
}

const updateDBTransactions = async (pgClient: Client, inputTxs: TransactionsProcessed): Promise<TransactionsProcessed> => {
  
  logger.debug(`Starting to update DB transactions`)

  const txsProcessed: TransactionSuccess[] = []
  const nvmErrors: TransactionError[] = []

  for await (const tx of inputTxs.success) {
    logger.debug(`Updating DB transaction: ${JSON.stringify(tx)}}`)

    try {      
      const updateQuery = `UPDATE public."serviceLogsQueue" as c SET status = 'Done', "errorMessage" = '', "updatedAt" = NOW() WHERE c."logId" = '${tx.logId}'`
      logger.debug(`Update Query: ${updateQuery}`)
      const result = await pgClient.query(updateQuery)
      logger.info(`DB transaction updated: ${tx.logId} with result ${result.rowCount}`)
      txsProcessed.push({ logId: tx.logId, creditsBurned: tx.creditsBurned, message: tx.message })

    } catch (error) {
      logger.warn(`Unable to update DB transaction: ${tx.logId}`)
      logger.warn(`ERROR: ${(error as Error).message}`)
      nvmErrors.push({logId: tx.logId, errorCode: 'UPDATE-001', errorMessage: (error as Error).message})
    }
    
  }

  for await (const error of inputTxs.errors) {

    logger.debug(`Updating DB Error transaction: ${error.logId}}`)

    try {    
      const updateQuery = `UPDATE public."serviceLogsQueue" as c SET retried = retried+1, "updatedAt" = NOW(), "errorMessage" = '${error.errorCode} ${error.errorMessage}' WHERE c."logId" = '${error.logId}'`
      logger.debug(`Update Error Query: ${updateQuery}`)
      const result = await pgClient.query(updateQuery)
      logger.info(`DB transaction updated to Error: ${error.logId} with result ${result.rowCount}`)
    } catch (error) {
      logger.warn(`Unable to update DB transaction to Error: ${error.logId}}`)
      logger.warn(`ERROR: ${(error as Error).message}`)      
    }
  }

  return { success: txsProcessed, errors: nvmErrors }
}

const cleanupDBPendingTransactions = async (pgClient: Client): Promise<any> => {
  
  try {

    const updateQuery = `UPDATE public."serviceLogsQueue" as c SET status = 'Error', "updatedAt" = NOW() WHERE retried >= ${maxRetries}`
    logger.debug(`Cleanup transactions query: ${updateQuery}`)
    const result = await pgClient.query(updateQuery)
    logger.info(`DB transaction cleanup with result ${result.rowCount}`)

  } catch (error) {
    logger.error(`Unable to cleanup Transactions from database`)
    logger.error(`ERROR: ${(error as Error).message}`)
    process.exit(1)
  }
  
}

const getAccount = async (config: ConfigEntry, nvm: Nevermined): Promise<Account> => {
  
    try {      
      return await nvm.accounts.getAccount(config.nvm.neverminedNodeAddress)      
    } catch (error) {
      logger.error(`Unable to get NODE account`)
      logger.error(`ERROR: ${(error as Error).message}`)
      process.exit(1)
    }
}


const main = async () => {

  const pgClient = await loadPostgresClient(postgresConfigTemplate)

  config = await getNVMConfig()
  const nvm = await loadNevermined(config, verbose)
  const account = await getAccount(config, nvm)

  const batches = await getTransacionBatches(pgClient)
  const txs = await burnTransactions(nvm, batches, account)

  logger.debug(`Transactions to update: Success = ${txs.success.length} - Errors = ${txs.errors.length}`)
  await updateDBTransactions(pgClient, txs)

  await cleanupDBPendingTransactions(pgClient)

  await pgClient.end()
}


main().then(() => logger.info('Burner is Done!')).catch((err) => logger.error(err))

