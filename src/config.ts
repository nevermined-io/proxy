import {
  makeWallets,
  NeverminedOptions,
  NvmAccount,
} from '@nevermined-io/sdk'

import { ethers, Signer } from 'ethers'
import * as fs from 'fs'
import os from 'os'

export const ARTIFACTS_PATH = process.env.ARTIFACTS_PATH || `${os.homedir()}/artifacts`

export interface ConfigEntry {
  nvm: NeverminedOptions
  signer: Signer
  envDescription?: string
  envUrl?: string
  isProduction?: boolean
  chainId?: string
  networkName?: string
  contractsVersion?: string
  tagName?: string
  nativeToken: string
  etherscanUrl: string
  nftTokenAddress: string
  erc20TokenAddress: string
  seed?: string
  keyfilePath?: string
  keyfilePassword?: string
  gasMultiplier?: number
  gasPriceMultiplier?: number
  externalNetwork?: boolean
  zerodevProjectId?: string
}

export async function getNVMConfig(_accountIndex = 0): Promise<ConfigEntry> {
  if (!process.env.SEED_WORDS) {
    if (!process.env.KEYFILE_PATH || !process.env.KEYFILE_PASSWORD) {
      const accountMessage =
        "'SEED_WORDS' or 'KEYFILE' not set in environment! Please see http://docs.nevermined.io/docs/cli/getting-started/#configure-your-account for details."
      throw new Error(accountMessage)
    }
  }
  const config = networkConfigTemplate as ConfigEntry

  config.seed = process.env.SEED_WORDS
  config.keyfilePath = process.env.KEYFILE_PATH
  config.keyfilePassword = process.env.KEYFILE_PASSWORD

  if (!config.nvm.web3ProviderUri || config.nvm.web3ProviderUri.length < 1) {
    throw new Error(
      `You need to configure a 'NETWORK' or a 'WEB3_PROVIDER_URL' environment variable pointing to the right network. \nFor complete reference please visit: \nhttp://docs.nevermined.io/docs/cli/advanced_configuration#connecting-to-different-environments documentation \n`,
    )
  }

  let accounts: NvmAccount[] = []

  if (!process.env.SEED_WORDS) {

    const wallet = getWalletFromJSON(process.env.KEYFILE_PATH!, process.env.KEYFILE_PASSWORD!)
    const acc = NvmAccount.fromAccount(wallet)

    accounts.push(acc)
  } else {
    accounts = makeWallets(config.seed!)
  }

  return {
    ...config,
    nvm: {
      ...config.nvm,
      artifactsFolder: ARTIFACTS_PATH,
      circuitsFolder: undefined,
      accounts,
    },
  }
}

export const getWalletFromJSON = (keyfilePath: string, password: string): any => {
  const data = fs.readFileSync(keyfilePath).toString()
  return ethers.Wallet.fromEncryptedJsonSync(data, password)
}

const networkConfigTemplate = {
  nvm: {
    chainId: Number(process.env.NETWORK_ID) || 421614,
    web3ProviderUri: process.env.WEB3_PROVIDER_URL || 'http://contracts.nevermined.localnet',
    marketplaceUri: process.env.MARKETPLACE_API_URL || 'http://marketplace.nevermined.localnet',
    graphHttpUri: '',
    neverminedNodeUri: process.env.NVM_NODE_URL || 'http://node.nevermined.localnet',
    neverminedNodeAddress: process.env.NODE_ADDRESS,
    verbose: process.env.VERBOSE || true,
  },
  networkName: process.env.NETWORK_NAME || 'arbitrum-goerli',
  contractsVersion: process.env.CONTRACTS_VERSION || '3.5.2',
  tagName: process.env.CONTRACTS_TAG || 'public',
  erc20TokenAddress: process.env.TOKEN_ADDRESS || '0xfd064A18f3BF249cf1f87FC203E90D8f650f2d63',
  gasMultiplier: process.env.GAS_MULTIPLIER || 0,
  gasPriceMultiplier: process.env.GAS_PRICE_MULTIPLIER || 0,
}

export const postgresConfigTemplate = {
  host: process.env.PG_HOST || 'localhost',
  port: process.env.PG_PORT || 5432,
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || '',
  database: process.env.PG_DB || 'nvm_one',
}
