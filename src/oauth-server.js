const express = require('express')
const app = express()
const port = 4000

app.get('/', (req, res) => {
  res.send('Oauth server')
})

app.post('/introspect', (req, res) => {
    let a = Number(req.query.a)
    let b = Number(req.query.b)
    let result = `${a + b}`

    console.log(`Request --------`)
    console.log(` Headers: ${JSON.stringify(req.headers)}`)
    console.log(` Query  : ${JSON.stringify(req.query)}`)
    console.log(` Params : ${JSON.stringify(req.params)}`)
    console.log(` Body   : ${JSON.stringify(req.body)}`)

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

app.listen(port, () => {
  console.log(`OAuth server listening on port ${port}`)
})

// Oauth Server request
// curl -v -X POST http://127.0.0.1:4000/introspect

// Proxied request
// curl -X GET http://127.0.0.1:3000 --proxy http://127.0.0.1:80 -H "Authorization: Bearer eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..TUhN0_EMCB2vDUF1cK1FAw.rFhU4azbNPeiWyhhrpICDmEbvjvYxMRoCR7b9Xbmx3V1e7Wv6HyfrMdJ37IBrxECBbUPeGZZUBa4IHOkwtvOlY9EkTh_OVyIVYA80VnWKB1LpwXUn6oMhxBetues_ToxEQKKi7RgGggAOdk9n9AASOD31rFb2ozbwvSpu7EqyRrexfjBtryzI1SfBkjQARlgw1NBoqMXWBFDiLL4pvR7GpHPPEasNbyOpr9avDtJ9-LXGVl__wYR4E2ksVhzw1QL3zO-l6cPWVzTV8MK_YEmaA.YuDjoCrPVjl19dzCDsn_iQ"