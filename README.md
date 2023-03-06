[![banner](https://raw.githubusercontent.com/nevermined-io/assets/main/images/logo/banner_logo.png)](https://nevermined.io)

# Nevermined Proxy PoC

> Proxy for connecting tokenized web services
> [nevermined.io](https://nevermined.io)

Table of Contents
=================

- [Nevermined Proxy PoC](#nevermined-proxy-poc)
- [Table of Contents](#table-of-contents)
  - [Info](#info)
  - [Requirements](#requirements)
  - [How to run the proxy](#how-to-run-the-proxy)
    - [Environment variables](#environment-variables)
    - [Running the NGINX proxy via Docker](#running-the-nginx-proxy-via-docker)
  - [Demos](#demos)
    - [Demo with NGNIX Proxy](#demo-with-ngnix-proxy)
    - [OpenAI API demo](#openai-api-demo)

---


## Info

This project pretends to show how to build a HTTP Proxy component that allows
to gate-keep web services and make them available to external user via subscriptions.

The proxy will leverage Nevermined core product to provide that functionality.

This proxy will answer the following questions:

- How can we gate-keep internal and/or external web services?
- How can we provide access to these services using NFT susbcriptions?
- What are the flows that need to be supported?
- What is the architecture of the solution?
- What would be a high-level estimation to include this solution as part of the core product?

## Requirements

The solution proposed or designed must take into account the following requirements:

- The modifications required by the service provider must be as small as possible or ideally zero.
- The modifications required by user of the service must be as small as possible or ideally zero.
- If some changes need to be done, it is prefered these changes are service or client configuration over code modifications
- If some code modifications need to be done they must be as close to a recognized standard as possible.

The adoption of the end solution will be influenced by the requirements introduced to the users. The simpler and
friction-less is the solution the better.

## How to run the proxy

### Environment variables

The proxy uses the following environment variables:

* `SERVER_HOST` - The host used by the Oauth Server. By default and the recommended configuration is to use `127.0.0.1` so only the proxy process (NGINX) can connect to the local OAuth introspection server.
* `SERVER_PORT` - The port used by the OAuth server. By default is `4000`. This port in normal configurations will be **internal** so won't be exposed and only will be accesible by the proxy process.
* `JWT_SECRET_PHRASE` - Shared secret between a Node instance and the Proxy. This secret phrase will be used to encrypt JWT messages by the Node and decrypt by the Proxy.

### Running the NGINX proxy via Docker

The OAuth Server accepts the following environment variables:

* `SERVER_HOST` - The host or address the OAuth server will be listen. By default `127.0.0.1` but if you need to configure from out of the server/pod it can be `0.0.0.0`
* `SERVER_PORT` - Port the OAuth server will be listening. It is `4000` by default
* `JWT_SECRET_PHRASE` - Shared secret between a Node instance and the Proxy. This secret phrase will be used to encrypt JWT messages by the Node and decrypt by the Proxy

The NGINX container accepts the following environment variables:

* `INTROSPECTION_URL` - The url to call to perform the OAuth introspection. It is the URL to the OAuth server. By default `http://127.0.0.1:4000/introspect`

The project has 3 Docker containers:

* `nevermined-io/proxy:latest` - It bundles the NGINX and OAuth server in the same image
* `neverminedio/proxy:nginx-latest` - NGINX 
* `neverminedio/proxy:oauth-latest` - The OAuth server

You can build it locally too and run it:

```
docker build . -t nginx-proxy
docker run -v $(pwd)/conf/certs:/ssl/certs -p 443:443 -p 3128:3128  -e "INTROSPECTION_URL=http://127.0.0.1:4000" nginx-proxy
```

## Demos

### Demo with NGNIX Proxy

It requires a NGNIX proxy with `auth_request` and `njs` modules

```bash
apt install nginx-module-njs
```

Configure the NGINX conf files from the `conf/nginx` folder. And configure the SSL certificates. You have some info about how to do it in the `Dockerfile`.

```bash
# Install dependencies and compile
yarn
yarn build 

# Start the web service
yarn run start:web-service

# Start the Oauth introspection server
yarn run start:oauth-server

# Start NGINX
sudo service nginx restart

# NGINX logs are available here
sudo tail -f /var/log/nginx/*.log

# Go to the SDK-JS and run
yarn run integration:external

# If we want to see this working using curl, copyt the Access Token from the previous test and export as `NVM_TOKEN` env var
export NVM_TOKEN="eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..hI4CMYSs0tqFYdof4hFiUw.2jK41Lgpua6XKZtFvqwjQS3gJDbSs0DVDMNnSW55NVOKVqQqBA1RE2InYpUY3aVJsqdsQ1nT5KpNH-MfwCyk85paoMSTiuHOW1t0bN8dB7PwyMkM5Ubf-8bg3q3rIEpDT7QtQ2M7YbP1t3HL8jhJZDStJ_2AYnumUvCVmKDtPUe_FmVdPcW66ta-d3YWKXkwKN1Ajrdnlsav58f-u6wE-qck_UtzqMpOI1ePmK3I-FBTYtSnpyUZrQu3XOXV2TR23kKaUtclhSdtHSMQHug__5Oe2Ibo3QI0AauThAHD6q98BL3iZn9fH2aCsUP2uFifRc0kC2PrWCz1F1upmaKWg2oJ9Yh9YADA95mcOjH_KSM.7tYdcSQ-AS9zdROBRUOh1g"

# Make a HTTP request to the webservice using NGINX as proxy
curl -vvv -k --proxy-insecure -X GET http://127.0.0.1:3000 --proxy http://127.0.0.1:3128 -H "NVM-Authorization: Bearer $NVM_TOKEN"
Hello World!

# Making a request directly to the endpoint should fail
curl -X GET http://127.0.0.1:3000
Unauthorized!!!!

```

### OpenAI API demo

Assuming we have NGINX already running from the previous demo:

```bash
export OPENAI_API_KEY="YOUR OPENAI API KEY"
export SERVICE_ENDPOINT="https://api.openai.com/v1/completions"

## We need this 2 if we want to use the SDK test
export AUTHORIZATION_TOKEN=$OPENAI_API_KEY

export PROXY_URL="https://127.0.0.1:443"
export SERVICE_ENDPOINT="https://api.openai.com/v1/completions"
export REQUEST_DATA='{"model": "text-davinci-003", "prompt": "Say this is a test", "temperature": 0, "max_tokens": 7}'
```

We go to the `sdk-js` and run the integration test

```bash

cd sdk-js
yarn run integration:external

...
 200 - {"id":"cmpl-6kbaUQIZFe6iamppJLEHtx5j7r0xS","object":"text_completion","created":1676565594,"model":"text-davinci-003","choices":[{"text":"\n\nThis is indeed a test","index":0,"logprobs":null,"finish_reason":"length"}],"usage":{"prompt_tokens":5,"completion_tokens":7,"total_tokens":12}}
...

```
We can also see this working with curl, copy the "Access Token" from the previous test and run:

```bash
export NVM_TOKEN="eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..1LYqALYanLBQPmsMvPP0ug.For0wiUUMVUAxB6vvhhSjCjSucfb8dgf5pz3v-YJPxiDZ5QMr7oB5ShSUh9OErlDShmqumd-rWRcqfXuns7R6FvDMC457jTZe6P2YyFZ_rsU3TLBiv6cyF7Br3B-wshZIaG_MiKoCZqZQJXtIbZhIx4TXdtJc7yKLSRkMP_-kSMROLKlrKuwWuLow6_5G-aOyqJkU0CdZJ-iEY42eh4L0YYALZ3LZlDII-Wv45pPm6Yki3DcgCYfpZ7zSEHJpoSXm3wCB4FJ7enKPxQ02ViRMwwJldvQzrPO2XMbGAmg7OVxMN2iI6PaenUQSO76toX04cgsEnEimKUOifY0Gl_MBBFr4R0AAoCdCW7Jxxq0VBsy1H8qVRb29rR2Ql2IRmOX.1ZN258dHRBHZewKNDhwFbQ"


curl -k -v -H "Content-Type: application/json"  -H "NVM-Authorization: Bearer $NVM_TOKEN" -d "$REQUEST_DATA" -H "Host: api.openai.com" https://127.0.0.1:443/v1/completions

...
{"id":"cmpl-6kc2PI82Y2OzdvOoqNDH00m6DrXDn","object":"text_completion","created":1676567325,"model":"text-davinci-003","choices":[{"text":"\n\nThis is indeed a test","index":0,"logprobs":null,"finish_reason":"length"}],"usage":{"prompt_tokens":5,"completion_tokens":7,"total_tokens":12}}

...
```
