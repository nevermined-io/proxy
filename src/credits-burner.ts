import {
  Account,
  ChargeType,
  DDO,
  NFTServiceAttributes,
  Nevermined,
  ServiceNFTAccess,
  jsonReplacer,
} from '@nevermined-io/sdk'
import { Client } from 'pg'
import { ConfigEntry, getNVMConfig, loadZerodevSigner, postgresConfigTemplate } from './config'
import pino from 'pino'
import { ZeroDevAccountSigner } from '@zerodev/sdk'

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
      `SELECT * FROM public."serviceLogsQueue" WHERE status = 'Pending' AND retried < ${maxRetries}`,
    )
    logger.info(`Logs Found: ${results.rows.length}`)

    return results.rows
  } catch (error) {
    logger.error(`Unable to get Transaction batches from database`)
    logger.error(`ERROR: ${(error as Error).message}`)
    process.exit(1)
  }
}

const burnTransactions = async (
  nvm: Nevermined,
  logs: any[],
  account: Account,
  zerodevSigner?: ZeroDevAccountSigner<'ECDSA'>,
): Promise<TransactionsProcessed> => {
  const results = []
  const errors = []
  let activeContractAddress = ''

  logger.trace(`Using account: ${account.getId()}`)

  for await (const log of logs) {
    logger.info(`Processing (burn) transaction: ${log.logId}`)

    try {
      // 1. Get the DID from the log
      const logEntry = JSON.parse(log.logLine)
      const serviceDID = logEntry.scope
      const userId = logEntry.user_id
      const upstreamStatus = logEntry.upstream_status
      let creditsFromHeader: bigint = undefined

      if (serviceDID === undefined || serviceDID === '')
        throw new Error(`Invalid DID: ${serviceDID}`)
      if (userId === undefined || userId === '') throw new Error(`Invalid userId: ${userId}`)
      if (upstreamStatus.startsWith('2') === false)
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
        if (
          logEntry.upstream_http_NVMCreditsConsumed !== undefined &&
          BigInt(logEntry.upstream_http_NVMCreditsConsumed)
        ) {
          logger.debug(`Fould "upstream_http_NVMCreditsConsumed" header in log entry: ${logEntry.upstream_http_NVMCreditsConsumed}`)
          creditsFromHeader = BigInt(logEntry.upstream_http_NVMCreditsConsumed)
        }
      } catch (error) {
        logger.warn(
          `Unable to parse credits from header: ${logEntry.upstream_http_NVMCreditsConsumed}`,
        )
      }

      logger.debug(`Default credits to burn: ${creditsFromHeader}, pending to validate DDO ...`)

      const chargeType = serviceMetadata.attributes.main.webService?.chargeType ? serviceMetadata.attributes.main.webService?.chargeType : ChargeType.Fixed
      const adjustedCredits = NFTServiceAttributes.getCreditsToCharge(
        nftAccess.attributes.main.nftAttributes,
        chargeType,
        creditsFromHeader,
      )

      logger.debug(`Credits requested to burn (by upstream service): ${creditsFromHeader} with chargeType: ${chargeType}`)
      logger.debug(`Adjusted Amount to burn: ${adjustedCredits}`)

      if (userId.toLowerCase() === ddoOwner.toLowerCase()) {
        logger.info(`Skipping DID ${serviceDID} because it is called by the owner`)
        results.push({ logId: log.logId, creditsBurned: 0n, message: 'Call by owner' })
      } else if (adjustedCredits === undefined || adjustedCredits < 1n) {
        // The NFT Access Service is a free service
        logger.info(`Skipping DID ${serviceDID} because it is a free service`)
        results.push({ logId: log.logId, creditsBurned: 0n, message: 'Free Service' })
      } else {
        const userBalance = await nvm.nfts1155.balance(subscriptionDID, userId)
        logger.debug(`User [${userId}] balance: ${userBalance} for tokenId: ${tokenId}`)

        // 5. Burn the NFT
        logger.debug(`Credits to burn: ${adjustedCredits} from subscription: ${subscriptionDID}`)
        if (
          NFTServiceAttributes.isCreditsBalanceEnough(
            nftAccess.attributes.main.nftAttributes,
            userBalance,
            creditsFromHeader
          )
        ) {
          logger.info(
            `Burning ${adjustedCredits} credits from user ${userId} on DID ${subscriptionDID} using account ${account.getId()}`,
          )
          await nvm.nfts1155.burnFromHolder(userId, tokenId, adjustedCredits, account, {
            zeroDevSigner: zerodevSigner,
          })
          results.push({ logId: log.logId, creditsBurned: adjustedCredits, message: 'Burned' })
        } else if (userBalance === 0n) {
          logger.warn(
            `User ${userId} does not have any balance to burn: ${userBalance} credits on DID ${serviceDID}, this request had to be blocked by the proxy`,
          )
          results.push({ logId: log.logId, creditsBurned: 0n, message: 'Insufficient Funds' })
        } else {

          logger.warn(
            `User ${userId} does not have enough credits to burn ${creditsFromHeader} credits on DID ${serviceDID}, burning remaining balance: ${userBalance}`,
          )
          await nvm.nfts1155.burnFromHolder(userId, tokenId, userBalance, account, {
            zeroDevSigner: zerodevSigner,
          })
          results.push({ logId: log.logId, creditsBurned: userBalance, message: 'Burned' })
          
        }
      }
    } catch (error) {
      logger.warn(`Unable to process Nevermined transaction: ${log.logId}`)
      logger.warn(`ERROR: ${(error as Error).message}`)
      errors.push({
        logId: log.logId,
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
      const updateQuery = `UPDATE public."serviceLogsQueue" as c SET status = 'Done', "errorMessage" = '', "updatedAt" = NOW() WHERE c."logId" = '${tx.logId}'`
      logger.debug(`Update Query: ${updateQuery}`)
      const result = await pgClient.query(updateQuery)
      logger.info(`DB transaction updated: ${tx.logId} with result ${result.rowCount}`)
      txsProcessed.push({ logId: tx.logId, creditsBurned: tx.creditsBurned, message: tx.message })
    } catch (error) {
      logger.warn(`Unable to update DB transaction: ${tx.logId}`)
      logger.warn(`ERROR: ${(error as Error).message}`)
      nvmErrors.push({
        logId: tx.logId,
        errorCode: 'UPDATE-001',
        errorMessage: (error as Error).message,
      })
    }
  }

  for await (const error of inputTxs.errors) {
    logger.debug(`Updating DB Error transaction: ${error.logId}}`)

    try {
      const updateQuery = `UPDATE public."serviceLogsQueue" as c SET retried = retried+1, "updatedAt" = NOW(), "errorMessage" = '${error.errorCode} ${error.errorMessage}' WHERE c."logId" = '${error.logId}'`
      logger.info(`Update Error Query: ${updateQuery}`)
      const result = await pgClient.query(updateQuery)
      logger.info(`DB transaction updated to Error: ${error.logId} with result ${result.rowCount}`)
    } catch (error) {
      logger.warn(`Unable to update DB transaction to Error: ${error.message}}`)
      logger.warn(`ERROR: ${(error as Error).message}`)
    }
  }

  return { success: txsProcessed, errors: nvmErrors }
}

const cleanupDBPendingTransactions = async (pgClient: Client): Promise<any> => {
  try {
    const updateQuery = `UPDATE public."serviceLogsQueue" as c SET status = 'Error', "updatedAt" = NOW() WHERE retried >= ${maxRetries} and status != 'Error' `
    logger.trace(`Cleanup transactions query: ${updateQuery}`)
    const result = await pgClient.query(updateQuery)
    if (result.rowCount > 0) logger.info(`DB transaction cleanup with result ${result.rowCount}`)
  } catch (error) {
    logger.error(`Unable to cleanup Transactions from database`)
    logger.error(`ERROR: ${(error as Error).message}`)
    process.exit(1)
  }
}

const getAccount = (config: ConfigEntry, nvm: Nevermined): Account => {
  try {
    return nvm.accounts.getAccount(config.nvm.neverminedNodeAddress)
  } catch (error) {
    logger.error(`Unable to get NODE account`)
    logger.error(`ERROR: ${(error as Error).message}`)
    process.exit(1)
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const main = async () => {
  config = await getNVMConfig()
  const nvm = await loadNevermined(config, verbose)

  let account: Account
  let zerodevSigner: ZeroDevAccountSigner<'ECDSA'> | undefined

  if (config.zerodevProjectId && config.zerodevProjectId !== '') {
    zerodevSigner = await loadZerodevSigner(config.signer, config.zerodevProjectId)
    account = await Account.fromZeroDevSigner(zerodevSigner)
  } else {
    account = getAccount(config, nvm)
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const pgClient = await loadPostgresClient(postgresConfigTemplate)

    const batches = await getTransactionBatches(pgClient)
    const txs = await burnTransactions(nvm, batches, account, zerodevSigner)

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
