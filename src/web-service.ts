import express from 'express'

const app = express()
const SERVER_PORT = process.env.SERVER_PORT || 3005

const AUTH_BEARER_TOKEN = process.env.AUTH_BEARER_TOKEN || 'new_authorization_token'
const HEADER_CREDITS_CONSUMED = 'NVMCreditsConsumed'

app.get('/private/hello', (req, res) => {

  console.log(`Request --------`)  
  console.log(` Headers: ${JSON.stringify(req.headers)}`)
  console.log(` Query  : ${JSON.stringify(req.query)}`)
  console.log(` Params : ${JSON.stringify(req.params)}`)
  console.log(` Body   : ${JSON.stringify(req.body)}`)

  if (req.headers['authorization'] != `Bearer ${AUTH_BEARER_TOKEN}`) {
    console.log(`Invalid token: ${req.headers['authorization']}`)
    res.status(401).send('Unauthorized!!!!')
    return
  }

  res.setHeader(HEADER_CREDITS_CONSUMED, '3') // This is the number of credits consumed by the request
  res.send('Hello World!')
  console.log(`Request Success! - ${req.url}`)  
})

app.get('/private/index', (req, res) => {
  if (req.headers['authorization'] != `Bearer ${AUTH_BEARER_TOKEN}`) {
    console.log(`Invalid token: ${req.headers['authorization']}`)
    res.status(401).send('Unauthorized!!!!')
    return
  }
  
  res.setHeader(HEADER_CREDITS_CONSUMED, '3') // This is the number of credits consumed by the request
  res.send(`This should be private`)
  console.log(`Request Success! - ${req.url}`)
})


app.get('/sum', (req, res) => {
  
    const a = Number(req.query.a)
    const b = Number(req.query.b)
    const result = `${a + b}`

    res.setHeader(HEADER_CREDITS_CONSUMED, '5') // This is the number of credits consumed by the request
    res.send(result)
    console.log(`Request Success! - ${req.url}`)

})

app.get('/openapi.json', (req, res) => {
  res.setHeader(HEADER_CREDITS_CONSUMED, '2') // This is the number of credits consumed by the request
  res.send(`{ "openapi": "1.0.0" }}`)
  
  console.log(`Request Success! - ${req.url}`)
})

app.get('/public', (req, res) => {  
  res.send(`This is a public endpoint`)
  console.log(`Request Success! - ${req.url}`)
})

app.get('/', (req, res) => {  
  res.send(`Index`)
})

app.listen(SERVER_PORT, () => {
  console.log(`Example app listening on port: ${SERVER_PORT}`)
  console.log(`Using Bearer token "${AUTH_BEARER_TOKEN}" in private endpoints`)
})