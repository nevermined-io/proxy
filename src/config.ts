import {
  convertEthersV6SignerToAccountSigner,
  makeAccounts,
  NeverminedOptions,
  Web3Provider,
} from '@nevermined-io/sdk'
import { ZeroDevAccountSigner, ZeroDevEthersProvider } from '@zerodev/sdk'

import { ethers, HDNodeWallet, Signer, Wallet } from 'ethers'
import * as fs from 'fs'
import os from 'os'

export const ARTIFACTS_PATH = process.env.ARTIFACTS_PATH || `${os.homedir()}/artifacts`

export interface ConfigEntry {
  nvm: NeverminedOptions
  signer: Signer
  envDescription?: string
  envUrl?: string
  isProduction?: boolean
  networkId?: string
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

  const provider = await Web3Provider.getWeb3(config.nvm)

  let signer: Signer
  let accounts: ethers.Wallet[] = []

  if (!process.env.SEED_WORDS) {
    signer = Wallet.fromEncryptedJsonSync(
      fs.readFileSync(process.env.KEYFILE_PATH!).toString(),
      process.env.KEYFILE_PASSWORD!,
    )

    accounts.push(
      getWalletFromJSON(process.env.KEYFILE_PATH!, process.env.KEYFILE_PASSWORD!) as Wallet,
    )
  } else {
    signer = Wallet.fromPhrase(config.seed!)
    accounts = makeAccounts(config.seed!)
  }

  return {
    ...config,
    signer: signer.connect(provider),
    nvm: {
      ...config.nvm,
      artifactsFolder: ARTIFACTS_PATH,
      circuitsFolder: undefined,
      accounts,
    },
  }
}

export async function loadZerodevSigner(
  owner: Signer,
  projectId: string,
): Promise<ZeroDevAccountSigner<'ECDSA'>> {
  const zerodevProvider = await ZeroDevEthersProvider.init('ECDSA', {
    projectId,
    owner: convertEthersV6SignerToAccountSigner(owner),
  })

  return zerodevProvider.getAccountSigner()
}

export const getWalletFromJSON = (keyfilePath: string, password: string): Wallet | HDNodeWallet => {
  const data = fs.readFileSync(keyfilePath).toString()
  return ethers.Wallet.fromEncryptedJsonSync(data, password)
}

const networkConfigTemplate = {
  nvm: {
    web3ProviderUri: process.env.WEB3_PROVIDER_URL || 'http://contracts.nevermined.localnet',
    marketplaceUri: process.env.MARKETPLACE_API_URL || 'http://marketplace.nevermined.localnet',
    graphHttpUri: '',
    neverminedNodeUri: process.env.NVM_NODE_URL || 'http://node.nevermined.localnet',
    neverminedNodeAddress: process.env.NODE_ADDRESS,
    verbose: process.env.VERBOSE || true,
  },
  networkId: process.env.NETWORK_ID || '421613',
  networkName: process.env.NETWORK_NAME || 'arbitrum-goerli',
  contractsVersion: process.env.CONTRACTS_VERSION || '3.5.2',
  tagName: process.env.CONTRACTS_TAG || 'public',
  erc20TokenAddress: process.env.TOKEN_ADDRESS || '0xfd064A18f3BF249cf1f87FC203E90D8f650f2d63',
  gasMultiplier: process.env.GAS_MULTIPLIER || 0,
  gasPriceMultiplier: process.env.GAS_PRICE_MULTIPLIER || 0,
  zerodevProjectId: process.env.ZERODEV_PROJECT_ID,
}

export const postgresConfigTemplate = {
  host: process.env.PG_HOST || 'localhost',
  port: process.env.PG_PORT || 5432,
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || '',
  database: process.env.PG_DB || 'nvm_one',
}
