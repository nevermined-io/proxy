import http from 'http'
import httpProxy from 'http-proxy'

// const PROXY_HOST = process.env.PROXY_HOST || `0.0.0.0`
const PROXY_PORT = process.env.PROXY_PORT || 3128

// Create a proxy server with custom application logic
const proxy = httpProxy.createProxyServer({})
    // .listen(PROXY_PORT)

//
// Create your custom server and just call `proxy.web()` to proxy
// a web request to the target passed in the options
// also you can use `proxy.ws()` to proxy a websockets request
//
const server = http.createServer(function(req, res) {
  // You can define here your custom logic to handle the request
  // and then proxy the request.
  console.log(`HEADERS: ${JSON.stringify(req.headers)}`)
  console.log(`URL: ${req.url}`)
  proxy.web(req, res, { 
    target: req.url,     
  })
})

console.log(`Listening on port ${PROXY_PORT}`)
server.listen(PROXY_PORT)