import express from 'express'

const app = express()
const SERVER_PORT = process.env.SERVER_PORT || 3000

const AUTH_TOKEN = 'new_authorization_token'

app.get('/', (req, res) => {

  console.log(`Request --------`)  
  console.log(` Headers: ${JSON.stringify(req.headers)}`)
  console.log(` Query  : ${JSON.stringify(req.query)}`)
  console.log(` Params : ${JSON.stringify(req.params)}`)
  console.log(` Body   : ${JSON.stringify(req.body)}`)

  if (req.headers['authorization'] != `Bearer ${AUTH_TOKEN}`) {
    console.log(`Invalid token: ${req.headers['authorization']}`)
    res.status(401).send('Unauthorized!!!!')
  } else {
    res.send('Hello World!')
  }
})

app.get('/sum', (req, res) => {
  
    const a = Number(req.query.a)
    const b = Number(req.query.b)
    const result = `${a + b}`
    res.send(result)
})

app.get('/openapi.json', (req, res) => {    
  res.send(`{ "openapi": "1.0.0" }}`)
})

app.get('/public', (req, res) => {    
  res.send(`This is a public endpoint`)
})

app.listen(SERVER_PORT, () => {
  console.log(`Example app listening on port ${SERVER_PORT}`)
})