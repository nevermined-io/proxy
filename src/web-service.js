const express = require('express')
const app = express()
const port = 3000

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
    let a = Number(req.query.a)
    let b = Number(req.query.b)
    let result = `${a + b}`
    res.send(result)
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})