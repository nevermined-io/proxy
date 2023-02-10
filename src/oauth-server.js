const express = require('express')
const jose = require('jose')
const app = express()

const SERVER_PORT = 4000

// The HTTP header name including the authorization token
const NVM_AUTHORIZATION_HEADER = 'nvm-authorization'

// The original full URL requested to the proxy will be included in a HTTP header with the following name
const NVM_REQUESTED_URL_HEADER = 'nvm-requested-url'

const JWT_SECRET = new Uint8Array(32)


const validateAuthorization = async (authorizationHeader) => {
  const token = authorizationHeader.split(' ')[1]
  const { _header, payload } = await jose.jwtDecrypt(token, JWT_SECRET)

  return payload
}


app.get('/', (req, res) => {
  res.send('Oauth server')
})

app.post('/introspect', async (req, res) => {

    console.log(`Request --------`)
    console.log(` Headers: ${JSON.stringify(req.headers)}`)
    console.log(` Query  : ${JSON.stringify(req.query)}`)
    console.log(` Params : ${JSON.stringify(req.params)}`)
    console.log(` Body   : ${JSON.stringify(req.body)}`)    

    // Validation Steps:
    // 1. The Authorization is there, can be decripted and is valid
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
    const url = new URL(req.headers[NVM_REQUESTED_URL_HEADER])
  
    if (!payload.endpoints.includes(url.origin)) {
      console.log(`${url.origin} not in ${payload.endpoints}`)
      res.writeHead(401)
      res.end()
      return
    }
    
    // 3. The JWT is not expired
    const now = Math.floor(Date.now() / 1000)
    const stillValid = now < payload.exp

    console.log(`IAT = ${payload.iat}`)
    console.log(`EXP = ${payload.exp}`)
    console.log(`NOW = ${now}`)
    console.log(`Seconds pending = ${payload.exp - now}`)
    console.log(`Is still valid? ${stillValid}`)

    if (!stillValid)  {
      console.log(`Token expired`)
      res.writeHead(401)
      res.end()
      return
    }

    // Getting the access token from the JWT message
    let serviceToken = ''
    for (let index = 0; index < payload.headers.length; index++) {
      if (payload.headers[index]['authorization']) {
        const tokens = payload.headers[index]['authorization'].split(' ')
        serviceToken = tokens.length > 1 ? tokens[1] : tokens[0]
      }
    }

    const response = {
      "active": true,
      "user_id": payload.userId,
      "service_token": serviceToken,      
      "scope": payload.did,
      "exp": payload.exp,
      "iat": payload.iat
    }
    console.log(`RESPONSE:\n${JSON.stringify(response)}`)
    res.send(response)
})

app.listen(SERVER_PORT, () => {
  console.log(`OAuth server listening on port ${SERVER_PORT}`)
})
