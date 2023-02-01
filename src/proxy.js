var http = require('http'),
    httpProxy = require('http-proxy');
    jwt = require('jsonwebtoken')


// Issue access token
// This should be done by nevermined one after it validated that a user has a valid subscription
var token = jwt.sign(
    {
        target: 'http://127.0.0.1:3000'
    },
    'secret',
    { expiresIn: '8h' }
)
console.log('Access token:\n\n', token)
 
var proxy = httpProxy.createProxyServer({});
 
var server = http.createServer(function(req, res) {

  console.log('proxying request', req.headers)

  // validate authorization header
  var decoded
  try {
    var token = req.headers['authorization'].split(' ')[1]
    decoded = jwt.verify(token, 'secret')
    console.log(decoded)
  } catch (err) {
    console.error(err)
    res.writeHead(401)
    res.end()
    return
  }
  
  proxy.web(req, res, { target: decoded.target });
});
 
console.log("listening on port 3001")
server.listen(3001);