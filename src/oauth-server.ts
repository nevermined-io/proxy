import { DDO, DID, didPrefixed, ServiceNFTAccess, SubscriptionType, ZeroAddress, zeroX } from '@nevermined-io/sdk'
import express from 'express'
import { jwtDecrypt, JWTPayload } from 'jose'
import { match } from 'path-to-regexp'
import fetch from 'node-fetch'
import { ethers } from 'ethers'

const verbose = process.env.VERBOSE === 'true'

const app = express()

// eslint-disable-next-line @typescript-eslint/no-var-requires
const logger = require('pino')({  
  level: verbose ? 'debug' : 'info',
})

// By default we only listen into localhost
// The proxy server will connect from the same host so we protect the oauth server
const SERVER_HOST = process.env.SERVER_HOST || '127.0.0.1'

const SERVER_PORT = process.env.SERVER_PORT || 4000

// The HTTP header name including the authorization token
const NVM_AUTHORIZATION_HEADER = 'authorization' // 'nvm-authorization'

// The original full URL requested to the proxy will be included in a HTTP header with the following name
const NVM_REQUESTED_URL_HEADER = 'nvm-requested-url'

// Shared secret between a Node instance and the Proxy. This secret phrase will be used to encrypt JWT messages by the Node and decrypt by the Proxy
const JWT_SECRET_PHRASE = process.env.JWT_SECRET_PHRASE || '12345678901234567890123456789012'
const JWT_SECRET = Uint8Array.from(JWT_SECRET_PHRASE.split('').map((x) => parseInt(x)))

const MARKETPLACE_API_URI =
  process.env.MARKETPLACE_API_URI || 'https://marketplace.nevermined.localnet'

const WEB3_PROVIDER_URL = process.env.WEB3_PROVIDER_URL || 'http://contracts.nevermined.localnet'

// Required because we are dealing with self signed certificates locally
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const nft1155ShortABI = [
  "function balanceOf(address account, uint256 id) view returns (uint256)",  
]

const web3Provider = new ethers.JsonRpcProvider(WEB3_PROVIDER_URL)

const validateAuthorization = async (authorizationHeader) => {
  const tokens = authorizationHeader.split(' ')
  const accessToken = tokens.length > 1 ? tokens[1] : tokens[0]
  const { payload } = await jwtDecrypt(accessToken, JWT_SECRET)
  
  return payload
}

const urlMatches = (
  endpoints: string[],
  urlRequested: URL,
): { matches: boolean; urlMatching: URL | undefined } => {
  let matches = false
  let urlMatching: URL | undefined
  endpoints.forEach((e) => {
    try {      
      const endpoint = new URL(e)
      logger.trace(
        `Matching endpoint ${endpoint.pathname} with requestedUrl ${urlRequested.pathname} `,
      )
      const fn = match(endpoint.pathname, { decode: decodeURIComponent })

      if (fn(urlRequested.pathname)) {
        logger.trace(`Match found`)
        matches = true
        urlMatching = endpoint
      }
    } catch (error) {
      throw new Error(`Error parsing url ${urlRequested} with endpoint ${e}: ${(error as Error).message}`)
    }
  })
  return { matches, urlMatching }
}

const getJwtPayload = async (userJwt: string, urlRequested: URL) => {
  let payload: JWTPayload & { [prop: string]: any }

  try {
    payload = (await validateAuthorization(userJwt)) as JWTPayload & { [prop: string]: unknown }
  } catch (err) {
    throw new Error(`Invalid authorization token: ${(err as Error).message}`)
  }

  // 2. The URL requested is granted

  logger.debug(`JWT Validating endpoints ${JSON.stringify(payload.endpoints)} with url requested: ${urlRequested}`)
  const { matches, urlMatching } = urlMatches(payload.endpoints, urlRequested)
  if (!matches) {
    throw new Error(`${urlRequested.origin} not in ${payload.endpoints}`)
  }

  payload.hostname = urlMatching?.host
  return payload
}

const validateSubscriptionByType = async (payload: JWTPayload): Promise<boolean> => {
  try {
    const serviceDid = payload.did
    const tokenId = zeroX(payload.subscriptionDid as string)
    const subscriptionDID = didPrefixed(payload.subscriptionDid as string)

    logger.debug(`Fetching subscription: ${subscriptionDID}`)
    const subscriptionDDOResponse = await fetch(`${MARKETPLACE_API_URI}/api/v1/metadata/assets/ddo/${subscriptionDID}`)
    logger.debug(`Subscription resolve Status: ${subscriptionDDOResponse.status}`)
    const subscriptionDDO = DDO.deserialize(await subscriptionDDOResponse.text())
    const subscriptionMetadata = subscriptionDDO.findServiceByReference('metadata')

    const subscriptionType = subscriptionMetadata.attributes.main.subscription?.subscriptionType ? subscriptionMetadata.attributes.main.subscription?.subscriptionType : SubscriptionType.Credits
    logger.debug(`Subscription Type: ${subscriptionType}`)
    if (subscriptionType === SubscriptionType.Time)
      return true

    const serviceDDOResponse = await fetch(`${MARKETPLACE_API_URI}/api/v1/metadata/assets/ddo/${serviceDid}`)
    logger.debug(`Service resolve Status: ${serviceDDOResponse.status}`)
    const serviceDDO = DDO.deserialize(await serviceDDOResponse.text())
    
    logger.debug(`Checking if the owner of the service (${payload.owner}) is making the request`)
    if (payload.owner === serviceDDO.proof.creator || payload.owner === serviceDDO.publicKey[0].owner) {
      logger.debug(`Owner of the service making a request, letting it pass`)
      return true  
    }

    const serviceAccess = serviceDDO.findServiceByReference('nft-access')
    const nftContractAddress = DDO.getNftContractAddressFromService(serviceAccess as ServiceNFTAccess)

    logger.debug(JSON.stringify(serviceAccess.attributes.main.nftAttributes))
    
    const minCreditsRequired = serviceAccess.attributes.main.nftAttributes?.minCreditsRequired ? BigInt(serviceAccess.attributes.main.nftAttributes?.minCreditsRequired as string) : 1n
    let userBalance = 0n
    
    logger.debug(`Checking user balance for ${payload.userId} in contract ${nftContractAddress} for DID ${subscriptionDID}`)
    const nft1155Contract = new ethers.Contract(nftContractAddress, nft1155ShortABI, web3Provider)    
    userBalance = await nft1155Contract.balanceOf(payload.userId, tokenId)

    logger.debug(`User balance: ${userBalance} minCreditsRequired: ${minCreditsRequired}`)
    return (userBalance >= minCreditsRequired)


  } catch (err) {
    throw new Error(`Problem validating subscription type: ${(err as Error).message}`)
  }
  
}

app.get('/', (req, res) => {
  res.send('Oauth server')
})


app.post('/introspect', async (req, res) => {
  logger.trace(` Headers: ${JSON.stringify(req.headers)}`)

  let urlRequested
  try {
    urlRequested = new URL(req.headers[NVM_REQUESTED_URL_HEADER])
    logger.debug(`URL Requested: ${urlRequested}`)
  } catch (error) {
    logger.warn(`Invalid URL requested: ${(error as Error).message}`)
    res.writeHead(401)
    res.end()
    return
  }
  

  try {
    if (req.headers[NVM_AUTHORIZATION_HEADER]) {
      const userJwt = req.headers[NVM_AUTHORIZATION_HEADER]

      // Validate the JWT and check if it's not expired
      const payload = await getJwtPayload(userJwt, urlRequested)

      // If the subscription associated to the service is credits based, we check if the user has enough credits
      // Service DID: payload.did
      const isRequestValid = await validateSubscriptionByType(payload)
      if (!isRequestValid) {
        logger.info(`Request not valid for subscription type`)
        res.writeHead(401)
        res.end()
        return
      }

      // Compose authorized response
      // Getting the access token from the JWT message
      let serviceToken = ''
      let authHeader = ''
      try {
        if (
          payload.headers.authentication.type === 'bearer' ||
          payload.headers.authentication.type === 'oauth'
        ) {
          serviceToken = payload.headers.authentication.token ?? ''
          authHeader = `Bearer ${serviceToken}`
        } else if (payload.headers.authentication.type === 'basic') {
          serviceToken = Buffer.from(
            `${payload.headers.authentication.username}:${payload.headers.authentication.password}`,
          ).toString('base64')
          authHeader = `Basic ${serviceToken}`
        }
      } catch (error) {
        logger.debug(`Authentication token not found, service_token will be empty`)
      }

      const response = {
        active: true,
        user_id: payload.userId,
        owner: payload.owner,
        auth_type: payload.headers.authentication.type,
        upstream_host: payload.hostname,
        scope: payload.did,
        exp: payload.exp,
        iat: payload.iat,
        ercType: payload.ercType,
      }

      // await registerServiceAccess(payload.did, payload.owner, payload.userId, payload.hostname, 1)
      logger.info(`Response: ${response.active} for ${response.scope}`)

      res.send({
        ...response,
        // We add the service token and auth header to the response
        service_token: serviceToken,
        auth_header: authHeader 
      })
      return
    } else {
      logger.debug(`No ${NVM_AUTHORIZATION_HEADER} header found`)
    }
  } catch (error) {
    logger.warn(`${error as Error}`)
  }

  // If the user didn't provide a JWT or the request was not approved
  // we check if the asset DID is provided as a subdomain.
  // If so we resolve the NVM Asset via the DID and check:
  // 1. The DID is valid and resolves into a DDO
  // 2. The DDO is related to a web-service
  // 3. The web service includes open urls
  // 4. The URL requested is part of the open urls list
  // If any of this steps fail we return an error response (401)

  let matches = false
  let scope = ''
  let upstreamHost = ''
  let owner: string = ZeroAddress
  try {
    const subdomain = urlRequested.hostname.split('.')[0]
    logger.debug(`Subdomain: ${subdomain}`)

    const did = DID.fromEncoded(subdomain)
    logger.debug(`DID: ${did.getDid()}`)

    if (did.getId().length === 64) {
      const assetUrl = `${MARKETPLACE_API_URI}/api/v1/metadata/assets/ddo/${did.getDid()}`
      logger.debug(`Asset URL: ${assetUrl}`)

      const response = await fetch(assetUrl)
      logger.trace(`Response Status: ${response.status}`)

      const ddo = DDO.deserialize(await response.text())
      ;[{ owner }] = ddo.publicKey

      const metadata = ddo.findServiceByType('metadata')
      logger.trace(JSON.stringify(metadata.attributes.main.webService))

      if (metadata.attributes.main.webService?.openEndpoints) {
        logger.trace(`Trying to match endpoints with ${urlRequested}`)
        scope = ddo.id
        const { urlMatching } = urlMatches(
          metadata.attributes.main.webService?.openEndpoints,
          urlRequested,
        )
        if (urlMatching) {
          matches = true
          upstreamHost = urlMatching.hostname
        }
      }
    } else {
      logger.debug(`Not a valid decoded DID ${did.getId()}}`)
    }
  } catch (error) {
    logger.warn(`${error as Error}`)
  }

  if (matches) {
    const response = {
      active: true,
      owner,
      user_id: '',
      auth_type: 'none',
      auth_header: '',
      service_token: '',
      upstream_host: upstreamHost,
      scope: scope,
      exp: '',
      iat: '',
    }

    // await registerServiceAccess(scope, owner, ZeroAddress, upstreamHost, 0)

    logger.debug(`OPEN URL RESPONSE:\n${JSON.stringify(response)}`)
    res.send(response)
    return
  }

  // Error response
  res.writeHead(401)
  res.end()
  return
})



app.listen(SERVER_PORT, SERVER_HOST, () => {
  logger.info(`OAuth server listening on port ${SERVER_PORT}`)
  logger.debug(`Debug mode enabled`)
})
