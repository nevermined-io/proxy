import SyslogServer, { SyslogOptions } from 'syslog-server-ts'
import fetch from 'node-fetch'

const verbose = process.env.VERBOSE === 'true'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const logger = require('pino')({  
  level: verbose ? 'debug' : 'info',
})

const SYSLOG_SERVER_PORT = Number(process.env.SYSLOG_SERVER_PORT) || 1514
const SYSLOG_SERVER_HOST = process.env.SYSLOG_SERVER_HOST || '0.0.0.0'

const BACKEND_API_URI =
  process.env.BACKEND_API_URI || 'http://localhost:3001'

const BACKEND_AUTH_TOKEN = process.env.BACKEND_AUTH_TOKEN || ''
const NGINX_TAG = process.env.NGINX_TAG || 'nginx'

// Required because we are dealing with self signed certificates locally
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'


const registerServiceAccess = async (did, owner, consumer, endpoint, upstreamStatus, nvmCredits) => {
  
  const requestBody = {
    did,
    owner,
    consumer,
    assetType: 'Service',
    endpoint,
    accessResult: upstreamStatus,
    nvmCredits: Number(nvmCredits) || undefined
  }
  logger.info(`/access_tx :: registerServiceAccess ${JSON.stringify(requestBody)}`)
  const result = await fetch(`${BACKEND_API_URI}/api/v1/metrics/asset/access`, {
    method: 'post',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${BACKEND_AUTH_TOKEN}`
    },
    body: JSON.stringify(requestBody)
  })
  logger.info(`/access_tx :: registerServiceAccess ${result.status} - ${await result.text()}`)
}

const options: SyslogOptions = {
  ports: [SYSLOG_SERVER_PORT], // Specify the ports you want the server to listen on
  address: SYSLOG_SERVER_HOST,
  exclusive: true,
  formatHints: new Map([[SYSLOG_SERVER_PORT, 'RFC3164']]),
  // formatHints: new Map([514, 'rfc5424'], [515, 'LEEF'], [516, 'ELF']),
}

const server = new SyslogServer()

server.onMessage(async (message) => {
  try {
    // console.log(message)
    const messageString = message.parsedMessage['msg'].replace(`${NGINX_TAG}: `,'')
    logger.info(`Received syslog message: ${messageString}`)
    
    const _obj = JSON.parse(messageString)
    if (_obj.status.startsWith('2')) {
      logger.info(`Registering successful access (${_obj.status}) for ${_obj.scope}`)
      await registerServiceAccess(_obj.scope, _obj.owner, _obj.user_id, _obj.endpoint, _obj.upstreamStatus, _obj.upstream_http_NVMCreditsConsumed)
    } else {
      logger.info(`Skipping not successful access (${_obj.status}) for ${_obj.did}`)
    }
  } catch (error) {
    logger.error(`Error parsing syslog message: ${error}`)
  }    
})

server.onError((error) => {
  logger.error('Error occurred:', error)
})

server.onClose(() => {
  logger.info('Server closed')
})

server.start(options).then(
  () => {
    logger.info(`Server started ${SYSLOG_SERVER_HOST}:${SYSLOG_SERVER_PORT}`)
  }
).catch((error) => { // If you don't specify any option and leave it as black, the server will listen on 514, 0.0.0.0 and exclusice
  console.log(error)
  logger.error('Failed to start server:', error)
})
