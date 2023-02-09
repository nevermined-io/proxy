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

// Oauth Server request
// curl -v -X POST http://127.0.0.1:4000/introspect

// Proxied request
// curl -X GET http://127.0.0.1:3000 --proxy http://127.0.0.1:80 -H "Authorization: Bearer eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..TUhN0_EMCB2vDUF1cK1FAw.rFhU4azbNPeiWyhhrpICDmEbvjvYxMRoCR7b9Xbmx3V1e7Wv6HyfrMdJ37IBrxECBbUPeGZZUBa4IHOkwtvOlY9EkTh_OVyIVYA80VnWKB1LpwXUn6oMhxBetues_ToxEQKKi7RgGggAOdk9n9AASOD31rFb2ozbwvSpu7EqyRrexfjBtryzI1SfBkjQARlgw1NBoqMXWBFDiLL4pvR7GpHPPEasNbyOpr9avDtJ9-LXGVl__wYR4E2ksVhzw1QL3zO-l6cPWVzTV8MK_YEmaA.YuDjoCrPVjl19dzCDsn_iQ"