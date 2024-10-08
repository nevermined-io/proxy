import {
  ChargeType,
  DDO,
  NFTServiceAttributes,
  Nevermined,
  NvmAccount,
  ServiceNFTAccess,
  jsonReplacer,
} from '@nevermined-io/sdk'
import { Client } from 'pg'
import pino from 'pino'
import { ConfigEntry, getNVMConfig, getWalletFromJSON, postgresConfigTemplate } from './config'

const verbose = process.env.VERBOSE === 'true'
const maxRetries = process.env.MAX_RETRIES || 3

const sleepDuration = Number(process.env.SLEEP_DURATION) || 5000

const logger = pino({
  level: verbose ? 'debug' : 'info',
})

let config: ConfigEntry

interface TransactionsProcessed {
  success: TransactionSuccess[]
  errors: TransactionError[]
}

interface TransactionSuccess {
  atxId: string
  creditsBurned: string
  message?: string
}

interface TransactionError {
  atxId: string
  errorCode: string
  errorMessage: string
}

const loadNevermined = async (
  config: ConfigEntry,
  verbose: boolean = false,
): Promise<Nevermined> => {
  try {
    logger.info(`Connecting to Nevermined at ${config.nvm.web3ProviderUri}`)
    const nvm = await Nevermined.getInstance({
      ...config.nvm,
      verbose: verbose ? verbose : config.nvm.verbose,
    })

    const accounts = await nvm.accounts.list()
    logger.debug(`Accounts: ${accounts.length}`)
    accounts.forEach((account) => {
      logger.debug(account.getId())
    })

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
  logger.trace(`Connecting to Postgres at ${postgresConfig.host}:${postgresConfig.port}`)
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

const getTransactionBatches = async (pgClient: Client): Promise<any> => {
  try {
    const results = await pgClient.query(
      `SELECT * FROM public."accessTransactions" as txs, public."accessProcessorQueue" as queue WHERE queue.status = 'Pending' AND retried < ${maxRetries} AND txs."atxId" = queue."atxId" ORDER BY queue."createdAt" `,
    )
    logger.info(`Access txs Found: ${results.rows.length}`)

    return results.rows
  } catch (error) {
    logger.error(`Unable to get Access Transaction batches from database`)
    logger.error(`ERROR: ${(error as Error).message}`)
    process.exit(1)
  }
}

const burnTransactions = async (
  nvm: Nevermined,
  txs: any[],
  account: NvmAccount,
): Promise<TransactionsProcessed> => {

  const results: any[] = []
  const errors: any[] = []
  let activeContractAddress = ''

  logger.trace(`Using account: ${account.getId()}`)

  for await (const tx of txs) {
    logger.info(`Processing (burn) transaction: ${tx.atxId}`)

    try {
      // 1. Get the DID from the tx
      const serviceDID = tx.did
      const consumer = tx.consumer
      const upstreamStatus = tx.accessResult
      let nvmCredits: bigint | undefined

      if (serviceDID === undefined || serviceDID === '')
        throw new Error(`Invalid DID: ${serviceDID}`)
      if (consumer === undefined || consumer === '') throw new Error(`Invalid consumer: ${consumer}`)
      if (upstreamStatus.toString().startsWith('2') === false)
        throw new Error(`Upstream Service didnt work so we dont charge credits for it`)

      // 2. Resolve the DDO from the DID
      logger.debug(`Resolving DID: ${serviceDID}`)
      const ddo = await nvm.assets.resolve(serviceDID)

      // 3. Load the NFT contract
      const nftAccess = ddo.findServiceByReference('nft-access')
      const ddoContractAddress = DDO.getNftContractAddressFromService(nftAccess as ServiceNFTAccess)
      const tokenId = DDO.getTokenIdFromService(nftAccess)
      const subscriptionDID = `did:nv:${tokenId}`
      const ddoOwner = await nvm.assets.owner(subscriptionDID)

      const serviceMetadata = ddo.findServiceByReference('metadata')

      if (ddoContractAddress !== activeContractAddress) {
        logger.debug(`Loading NFT from address: ${ddoContractAddress}`)
        await nvm.contracts.loadNft1155(ddoContractAddress)
        activeContractAddress = ddoContractAddress
      } else {
        logger.debug(`NFT contract already loaded, skipping`)
      }

      try {
        nvmCredits = BigInt(tx.nvmCredits)
        nvmCredits = nvmCredits < 0n ? undefined : nvmCredits
      } catch (error) {
        logger.warn(`Unable to parse credits: ${tx.nvmCredits}`)
      }

      
      logger.debug(`Default credits to burn: ${nvmCredits}, pending to validate DDO ...`)

      const chargeType = serviceMetadata.attributes.main.webService?.chargeType ? serviceMetadata.attributes.main.webService?.chargeType : ChargeType.Fixed
      const adjustedCredits = NFTServiceAttributes.getCreditsToCharge(
        nftAccess.attributes.main.nftAttributes,
        chargeType,
        nvmCredits,
      )

      logger.debug(`Credits requested to burn (by upstream service): ${nvmCredits} with chargeType: ${chargeType}`)
      logger.debug(`Adjusted Amount to burn: ${adjustedCredits}`)

      if (consumer.toLowerCase() === ddoOwner.toLowerCase()) {
        logger.info(`Skipping DID ${serviceDID} because it is called by the owner`)
        results.push({ atxId: tx.atxId, creditsBurned: 0n, message: 'Call by owner' })
      } else if (adjustedCredits === undefined || adjustedCredits < 1n) {
        // The NFT Access Service is a free service
        logger.info(`Skipping DID ${serviceDID} because it is a free service`)
        results.push({ atxId: tx.atxId, creditsBurned: 0n, message: 'Free Service' })
      } else {
        const userBalance = await nvm.nfts1155.balance(subscriptionDID, consumer)
        logger.debug(`User [${consumer}] balance: ${userBalance} for tokenId: ${tokenId}`)

        // 5. Burn the NFT
        logger.debug(`Credits to burn: ${adjustedCredits} from subscription: ${subscriptionDID}`)
        if (
          NFTServiceAttributes.isCreditsBalanceEnough(
            nftAccess.attributes.main.nftAttributes,
            userBalance,
            nvmCredits
          )
        ) {
          logger.info(
            `Burning ${adjustedCredits} credits from user ${consumer} on DID ${subscriptionDID} using account ${account.getId()}`,
          )
          await nvm.nfts1155.burnFromHolder(consumer, tokenId, adjustedCredits, account)
          results.push({ atxId: tx.atxId, creditsBurned: adjustedCredits, message: 'Burned' })
        } else if (userBalance === 0n) {
          logger.warn(
            `User ${consumer} does not have any balance to burn: ${userBalance} credits on DID ${serviceDID}, this request had to be blocked by the proxy`,
          )
          results.push({ atxId: tx.atxId, creditsBurned: 0n, message: 'Insufficient Funds' })
        } else {

          logger.warn(
            `User ${consumer} does not have enough credits to burn ${nvmCredits} credits on DID ${serviceDID}, burning remaining balance: ${userBalance}`,
          )
          await nvm.nfts1155.burnFromHolder(consumer, tokenId, userBalance, account)
          results.push({ atxId: tx.atxId, creditsBurned: userBalance, message: 'Burned' })
          
        }
      }
    } catch (error) {
      logger.warn(`Unable to process Nevermined transaction: ${tx.atxId}`)
      logger.warn(`ERROR: ${(error as Error).message}`)
      errors.push({
        atxId: tx.atxId,
        errorCode: 'BURN-001',
        errorMessage: (error as Error).message.replace(/[^\x20-\x7E]/g, ''),
      })
    }
  }
  return { success: results, errors }
}

const updateDBTransactions = async (
  pgClient: Client,
  inputTxs: TransactionsProcessed,
): Promise<TransactionsProcessed> => {
  logger.trace(`Starting to update DB transactions`)

  const txsProcessed: TransactionSuccess[] = []
  const nvmErrors: TransactionError[] = []

  for await (const tx of inputTxs.success) {
    logger.debug(`Updating DB transaction: ${JSON.stringify(tx, jsonReplacer)}}`)

    try {
      const updateQuery = `UPDATE public."accessProcessorQueue" as c SET status = 'Done', "errorMessage" = '', "updatedAt" = NOW() WHERE c."atxId" = '${tx.atxId}'`
      logger.debug(`Update Query: ${updateQuery}`)
      const result = await pgClient.query(updateQuery)
      logger.info(`DB transaction updated: ${tx.atxId} with result ${result.rowCount}`)
      txsProcessed.push({ atxId: tx.atxId, creditsBurned: tx.creditsBurned, message: tx.message })
    } catch (error) {
      logger.warn(`Unable to update DB transaction: ${tx.atxId}`)
      logger.warn(`ERROR: ${(error as Error).message}`)
      nvmErrors.push({
        atxId: tx.atxId,
        errorCode: 'UPDATE-001',
        errorMessage: (error as Error).message,
      })
    }
  }

  for await (const error of inputTxs.errors) {
    logger.debug(`Updating DB Error transaction: ${error.atxId}}`)

    try {
      const updateQuery = `UPDATE public."accessProcessorQueue" as c SET retried = retried+1, "updatedAt" = NOW(), "errorMessage" = '${error.errorCode} ${error.errorMessage}' WHERE c."atxId" = '${error.atxId}'`
      logger.info(`Update Error Query: ${updateQuery}`)
      const result = await pgClient.query(updateQuery)
      logger.info(`DB transaction updated to Error: ${error.atxId} with result ${result.rowCount}`)
    } catch (error) {
      logger.warn(`Unable to update DB transaction to Error: ${(error as Error).message}}`)
      logger.warn(`ERROR: ${(error as Error).message}`)
    }
  }

  return { success: txsProcessed, errors: nvmErrors }
}

const cleanupDBPendingTransactions = async (pgClient: Client): Promise<any> => {
  try {
    const updateQuery = `UPDATE public."accessProcessorQueue" as c SET status = 'Error', "updatedAt" = NOW() WHERE retried >= ${maxRetries} and status != 'Error' `
    logger.trace(`Cleanup transactions query: ${updateQuery}`)
    const result = await pgClient.query(updateQuery)
    if (result.rowCount > 0) logger.info(`DB transaction cleanup with result ${result.rowCount}`)
  } catch (error) {
    logger.error(`Unable to cleanup Transactions from database`)
    logger.error(`ERROR: ${(error as Error).message}`)
    process.exit(1)
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const main = async () => {
  config = await getNVMConfig()
  const nvm = await loadNevermined(config, verbose)
  const account = getWalletFromJSON(config.keyfilePath!, config.keyfilePassword!)

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const pgClient = await loadPostgresClient(postgresConfigTemplate)

    const batches = await getTransactionBatches(pgClient)
    const txs = await burnTransactions(nvm, batches, account)

    logger.trace(
      `Transactions to update: Success = ${txs.success.length} - Errors = ${txs.errors.length}`,
    )
    await updateDBTransactions(pgClient, txs)

    await cleanupDBPendingTransactions(pgClient)

    await pgClient.end()
    logger.info(`Burner round finished! Sleeping ${sleepDuration}ms ...`)
    await sleep(sleepDuration)
  }
}

main()
  .then(() => logger.info('Burner is Done!'))
  .catch((err) => logger.error(err))
