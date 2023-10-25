import { Account, DDO, Nevermined, ServiceNFTAccess } from '@nevermined-io/sdk'
import { Client } from 'pg'
import { ConfigEntry, getNVMConfig, postgresConfigTemplate } from './config'

const verbose = process.env.VERBOSE === 'true'
const maxRetries = process.env.MAX_RETRIES || 10

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
  

  // const accounts = await nvm.accounts.list()
  // const account = accounts[accountIndex]

  logger.debug(`Using account: ${account.getId()}`)

  for await (const log of logs) {
  
  // logs.forEach(async (log) => {
    logger.info(`Processing (burn) transaction: ${log.logId}`)    

    try {
      // 1. Get the DID from the log
      const logEntry = JSON.parse(log.logLine)
      const serviceDID = logEntry.scope
      const userId = logEntry.user_id      
      let creditsConsumed: bigint

      if (serviceDID === undefined || serviceDID === '')
        throw new Error(`Invalid DID: ${serviceDID}`)
      if (userId === undefined || userId === '')
        throw new Error(`Invalid userId: ${userId}`)
      if (logEntry.upstream_http_NVMCreditsConsumed === undefined || logEntry.upstream_http_NVMCreditsConsumed === '' || BigInt(logEntry.upstream_http_NVMCreditsConsumed) < 1n)
        creditsConsumed = 1n

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

      // 4. Get the user balance
      const minAmountToBurn = DDO.getNftAmountFromService(nftAccess)
      logger.debug(`Min amount to burn: ${minAmountToBurn}`)

      if (minAmountToBurn === undefined || minAmountToBurn < 1n)  { // The NFT Access Service is a free service
        logger.info(`Skipping DID ${serviceDID} because it is a free service`)
        results.push({ logId: log.logId, creditsBurned: 0n, message: 'Free Service' })
        
      } else {

        const userBalance = await nvm.nfts1155.balance(subscriptionDID, userId)
        logger.debug(`User [${userId}] balance: ${userBalance} for tokenId: ${tokenId}`)

        // 5. Burn the NFT
        const creditsToBurn = creditsConsumed > minAmountToBurn ? creditsConsumed : minAmountToBurn        
        logger.debug(`Credits to burn: ${creditsToBurn} from subscription: ${subscriptionDID}`)

        if (userBalance >= creditsToBurn) {
          logger.info(`Burning ${creditsToBurn} credits from user ${userId} on DID ${subscriptionDID} using account ${account.getId()}`)          
          await nvm.nfts1155.burnFromHolder(userId, tokenId, creditsToBurn, account)
          results.push({ logId: log.logId, creditsBurned: creditsToBurn, message: 'Burned' })

        } else {
          throw new Error(`User ${userId} does not have enough credits to burn ${creditsConsumed} credits on DID ${serviceDID}`)
        }
  
      }

    } catch (error) {
      logger.warn(`Unable to process Nevermined transaction: ${log.logId}`)
      logger.warn(`ERROR: ${(error as Error).message}`)
      errors.push({logId: log.logId, errorCode: 'BURN-001', errorMessage: (error as Error).message.replace('\'', '').replace('"', '')})
    }
    
  } //)
  return { success: results, errors }
}

const updateDBTransactions = async (pgClient: Client, inputTxs: TransactionsProcessed): Promise<TransactionsProcessed> => {
  
  logger.debug(`Starting to update DB transactions`)

  const txsProcessed: TransactionSuccess[] = []
  const nvmErrors: TransactionError[] = []

  for await (const tx of inputTxs.success) {
    logger.debug(`Updating DB transaction: ${tx}}`)

    try {      
      const updateQuery = `UPDATE public."serviceLogsQueue" as c SET status = 'Done', "errorMessage" = '' WHERE c."logId" = '${tx.logId}'`
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
      // UPDATE public."serviceLogsQueue" as c SET status = 'Error', retried = retried+1, "errorMessage" = 'BURN-001 Cannot read properties of undefined (reading toLowerCase)' WHERE c."logId" = 'd8514abf-9415-481d-9005-b36bd817aee3';

      const updateQuery = `UPDATE public."serviceLogsQueue" as c SET retried = retried+1, "errorMessage" = '${error.errorCode} ${error.errorMessage}' WHERE c."logId" = '${error.logId}'`
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

    const updateQuery = `UPDATE public."serviceLogsQueue" as c SET status = 'Error' WHERE retried >= ${maxRetries}`
    logger.debug(`Update Error Query: ${updateQuery}`)
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
      const account = await nvm.accounts.getAccount(config.nvm.neverminedNodeAddress)
      // const account = (await nvm.accounts.list())[0]
      return account
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

