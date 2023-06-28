// initialize metrics before all else
import { initializeMetrics, OTEL_SERVICE_NAMESPACE } from './metrics'
initializeMetrics(process.env.OTEL_METRICS_DEBUG === 'true')

import { DDO, DID, ResourceAuthentication } from '@nevermined-io/sdk'
import express from 'express'
import { jwtDecrypt } from 'jose'
import { match } from 'path-to-regexp'
import fetch from 'node-fetch'
import { metrics } from '@opentelemetry/api'

const meter = metrics.getMeter('oauth-server')
const counter = meter.createCounter('oauth_server.webservice.counter', {
  description: 'The number of requests to web services',
})

const app = express()

// eslint-disable-next-line @typescript-eslint/no-var-requires
const logger = require('pino')({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
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

// Required because we are dealing with self signed certificates locally
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

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
  let urlMatching = undefined
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
      throw new Error(`Error parsing url ${(error as Error).message}`)
    }
  })
  return { matches, urlMatching }
}

const getJwtPayload = async (userJwt: string, urlRequested: URL) => {
  let payload

  try {
    payload = await validateAuthorization(userJwt)
  } catch (err) {
    throw new Error(`Invalid authorization token: ${(err as Error).message}`)
  }

  // 2. The URL requested is granted

  logger.debug(`JWT Validating endpoints ${JSON.stringify(payload.endpoints)}}`)
  const { matches, urlMatching } = urlMatches(payload.endpoints, urlRequested)
  if (!matches) {
    throw new Error(`${urlRequested.origin} not in ${payload.endpoints}`)
  }

  payload.hostname = urlMatching.hostname
  return payload
}

app.get('/', (req, res) => {
  res.send('Oauth server')
})

app.post('/introspect', async (req, res) => {
  logger.trace(` Headers: ${JSON.stringify(req.headers)}`)

  const urlRequested = new URL(req.headers[NVM_REQUESTED_URL_HEADER])
  logger.debug(`URL Requested: ${urlRequested}`)

  try {
    if (req.headers[NVM_AUTHORIZATION_HEADER]) {
      const userJwt = req.headers[NVM_AUTHORIZATION_HEADER]

      logger.debug(`JWT: ${userJwt}`)
      const payload = await getJwtPayload(userJwt, urlRequested)
      logger.debug(`Payload: ${JSON.stringify(payload)}`)
      
      // Compose authorized response
      // Getting the access token from the JWT message
      let serviceToken = ''
      let authHeader = ''
      try {
        if (payload.headers.authentication.type === 'bearer' || payload.headers.authentication.type === 'oauth') {
          serviceToken = payload.headers.authentication.token ?? ''
          authHeader = `Bearer ${serviceToken}`
        } else if (payload.headers.authentication.type === 'basic') {
          logger.debug(`Basic auth encoding ${payload.headers.authentication.username}:${payload.headers.authentication.password}`)
          serviceToken = Buffer.from(
            `${payload.headers.authentication.username}:${payload.headers.authentication.password}`)
            .toString('base64')
          authHeader = `Basic ${serviceToken}`
        }
      } catch (error) {
        logger.debug(`Authentication token not found, service_token will be empty`)
      }

      const response = {
        active: true,
        user_id: payload.userId,
        auth_type: payload.headers.authentication.type,
        auth_header: authHeader,
        service_token: serviceToken,
        upstream_host: payload.hostname,
        scope: payload.did,
        exp: payload.exp,
        iat: payload.iat,
      }

      counter.add(1, {
        did: payload.did,
        owner: payload.owner,
        consumer: payload.userId,
        endpoint: payload.hostname,
        namespace: OTEL_SERVICE_NAMESPACE,
      })

      logger.debug(`RESPONSE:\n${JSON.stringify(response)}`)
      res.send(response)
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
  let owner: string
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
      user_id: '',
      auth_type: 'none',
      auth_header: '',
      service_token: '',
      upstream_host: upstreamHost,
      scope: scope,
      exp: '',
      iat: '',
    }

    counter.add(1, {
      did: scope,
      owner: owner,
      endpoint: upstreamHost,
      namespace: OTEL_SERVICE_NAMESPACE,
    })

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
})
