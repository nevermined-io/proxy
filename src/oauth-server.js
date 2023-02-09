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
    let a = Number(req.query.a)
    let b = Number(req.query.b)
    let result = `${a + b}`

    console.log(`Request --------`)
    console.log(` Headers: ${JSON.stringify(req.headers)}`)
    console.log(` Query  : ${JSON.stringify(req.query)}`)
    console.log(` Params : ${JSON.stringify(req.params)}`)
    console.log(` Body   : ${JSON.stringify(req.body)}`)    

    // validate authorization header
    let payload
    try {
      payload = await validateAuthorization(req.headers[NVM_AUTHORIZATION_HEADER])
    } catch (err) {
      console.error(err)
      res.writeHead(401)
      res.end()
      return
    }

    const requestedUrl = req.headers[NVM_REQUESTED_URL_HEADER]

    // validate origin url is valid
    const url = new URL(requestedUrl)
  
    if (!payload.endpoints.includes(url.origin)) {
      console.log(`${url.origin} not in ${payload.endpoints}`)
      res.writeHead(401)
      res.end()
      return
    }

    const response = {
      "active": true,
      "client_id": "l238j323ds-23ij4",
      "username": "jdoe",
      "service_token": "new_authorization_token",
      "scope": "read write dolphin",
      "sub": "Z5O3upPC88QrAjx00dis",
      "aud": "https://protected.example.net/resource",
      "iss": "https://server.example.com/",
      "exp": 1419356238,
      "iat": 1419350238,
      "extension_field": "twenty-seven"
    }
    res.send(response)
})

app.listen(SERVER_PORT, () => {
  console.log(`OAuth server listening on port ${SERVER_PORT}`)
})
