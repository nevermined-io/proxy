// initialize metrics before all else
import { initializeMetrics, OTEL_SERVICE_NAMESPACE } from './metrics'
initializeMetrics()

import express from 'express'
import { jwtDecrypt } from 'jose'
import { match } from 'path-to-regexp'
import { metrics } from '@opentelemetry/api'

const meter = metrics.getMeter('oauth-server')
const counter = meter.createCounter('oauth_server.webservice.counter', {
  description: 'The number of requests to web services',
})

const app = express()

// By default we only listen into localhost
// The proxy server will connect from the same host so we protect the oauth server
const SERVER_HOST = process.env.SERVER_HOST || '127.0.0.1'

const SERVER_PORT = Number(process.env.SERVER_PORT) || 4000

// The HTTP header name including the authorization token
const NVM_AUTHORIZATION_HEADER = 'authorization' // 'nvm-authorization'

// The original full URL requested to the proxy will be included in a HTTP header with the following name
const NVM_REQUESTED_URL_HEADER = 'nvm-requested-url'

// Shared secret between a Node instance and the Proxy. This secret phrase will be used to encrypt JWT messages by the Node and decrypt by the Proxy
const JWT_SECRET_PHRASE = process.env.JWT_SECRET_PHRASE || '12345678901234567890123456789012'
const JWT_SECRET = Uint8Array.from(JWT_SECRET_PHRASE.split('').map((x) => parseInt(x)))

const validateAuthorization = async (authorizationHeader) => {
  const tokens = authorizationHeader.split(' ')
  const accessToken = tokens.length > 1 ? tokens[1] : tokens[0]
  const { payload } = await jwtDecrypt(accessToken, JWT_SECRET)

  return payload
}

app.get('/', (req, res) => {
  counter.add(1, {
    did: 'did:nv:asdsadasd',
    owner: '0xasdasdasdsad',
    consumer: '0xasdasdasdsad',
    endpoint: 'https:/api.openai.com/ask',
    namespace: OTEL_SERVICE_NAMESPACE,
  })
  res.send('Oauth server')
})

app.post('/introspect', async (req, res) => {
  console.log(`Request --------`)
  console.log(` Headers: ${JSON.stringify(req.headers)}`)

  // Validation Steps:
  // 1. The Authorization is there, can be decripted and is valid
  if (!req.headers[NVM_AUTHORIZATION_HEADER]) {
    console.log(`${NVM_AUTHORIZATION_HEADER} header not found`)
    res.writeHead(401)
    res.end()
    return
  }

  let payload
  try {
    payload = await validateAuthorization(req.headers[NVM_AUTHORIZATION_HEADER])
  } catch (err) {
    console.error(err)
    res.writeHead(401)
    res.end()
    return
  }

  // 2. The URL requested is granted
  const urlRequested = new URL(req.headers[NVM_REQUESTED_URL_HEADER] as string)
  let endpoint

  let urlMatches = false
  payload.endpoints.map((e) => {
    try {
      endpoint = new URL(e)
      const fn = match(endpoint.pathname, { decode: decodeURIComponent })

      if (fn(urlRequested.pathname)) {
        urlMatches = true
      }
    } catch (error) {
      console.log(`Error parsing url ${(error as Error).message}`)
    }
  })

  if (!urlMatches) {
    console.log(`${urlRequested.origin} not in ${payload.endpoints}`)
    res.writeHead(401)
    res.end()
    return
  }

  // Getting the access token from the JWT message
  let serviceToken = ''
  try {
    serviceToken = payload.headers.authentication.token ?? ''
  } catch (error) {
    console.log(`Authentication token not found, service_token will be empty`)
  }

  const response = {
    active: true,
    user_id: payload.userId,
    service_token: serviceToken,
    upstream_host: endpoint.hostname,
    scope: payload.did,
    exp: payload.exp,
    iat: payload.iat,
  }

  // send metrics

  console.log(`RESPONSE:\n${JSON.stringify(response)}`)
  res.send(response)
})

app.listen(SERVER_PORT, SERVER_HOST, () => {
  console.log(`OAuth server listening on port ${SERVER_PORT}`)
})
