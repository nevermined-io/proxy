[![banner](https://raw.githubusercontent.com/nevermined-io/assets/main/images/logo/banner_logo.png)](https://nevermined.io)

# Nevermined Proxy PoC

> Proxy for connecting tokenized web services
> [nevermined.io](https://nevermined.io)

## Info

This Proxy Proof of Concept (PoC) pretends to show how to build a HTTP Proxy component that allows
to gate-keep web services and make them available to external user via subscriptions.

The proxy will leverage Nevermined core product to provide that functionality.

This PoC will ask the following questions:

- How can we gate-keep internal and/or external web services?
- How can we provide access to these services using NFT susbcriptions?
- What are the flows that need to be supported?
- What is the architecture of the solution?
- What would be a high-level estimation to include this solution as part of the core product?

## PoC Requirements

The solution proposed or designed must take into account the following requirements:

- The modifications required by the service provider must be as small as possible or ideally zero.
- The modifications required by user of the service must be as small as possible or ideally zero.
- If some changes need to be done, it is prefered these changes are service or client configuration over code modifications
- If some code modifications need to be done they must be as close to a recognized standard as possible.

The adoption of the end solution will be influenced by the requirements introduced to the users. The simpler and
friction-less is the solution the better.

## PoC Use Case

To facilitate the understanding of the PoC and how is implemented we are gonna use two use cases.
One of them using an internal web service (we operate and can control) and an external web service (running somewhere).

### Internal Web Service

```
As a Publisher I want to make available for free access to a service allowing to search accross all the assets published in my marketplace.
This service is a HTTP REST API exposed will running in the following URL:
HTTP POST http://marketplace.nevermined.localnet/api/v1/metadata/assets/ddo/query
I don't want to expose any of the other webservice endpoints like
HTTP GET http://marketplace.nevermined.localnet/api/v1/metadata/assets

As a Client I want to get access to the search API of the marketplace.
```

### External Web Service, tokenizing Twitter API

```
As a Publisher I want to make available my Twitter API allowing others to send messages under my account. I will make this available for 1 week
for a price of 1 MATIC.

As a Client I want to send messages throgh the Twitter API.
```

## Demo with js proxy implementation

```bash

# start an example web service (http://localhost:3000)
yarn start:web-service

# start the proxy (http://localhost:3001) - it will print out a valid access token
yarn start:proxy

# test endpoints
curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0YXJnZXQiOiJodHRwOi8vMTI3LjAuMC4xOjMwMDAiLCJpYXQiOjE2NzUyNTMxMTEsImV4cCI6MTY3NTI4MTkxMX0.zXYblmhQRDoTS-PnhImgDH8yFbjFoxjJVD46G0FdW1o" http://localhost:3000 --proxy http://localhost:3001

# test endpoint with query parameters
curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0YXJnZXQiOiJodHRwOi8vMTI3LjAuMC4xOjMwMDAiLCJpYXQiOjE2NzUyNTMxMTEsImV4cCI6MTY3NTI4MTkxMX0.zXYblmhQRDoTS-PnhImgDH8yFbjFoxjJVD46G0FdW1o" http://localhost:3000/sum?a=1&b=2 --proxy http://localhost:3001

# not setting the authorization header should return a 401
curl http://localhost:3000 --proxy http://localhost:3001
```

## Demo with NGNIX Proxy

It requires a NGNIX proxy with `auth_request` and `njs` modules

```bash
apt install nginx-module-njs
```

Configure the NGINX conf files from the `conf/nginx` folder.

```bash
# Start the web service
node src/web-service.js

# Start the Oauth instrospection server
node src/oauth-server.js

# Start NGINX
sudo service nginx restart

# NGINX logs are available here
sudo tail -f /var/log/nginx/*.log

# Make a HTTP request to the webservice using NGINX as proxy
curl -X GET http://127.0.0.1:3000 --proxy http://127.0.0.1:80 -H "Authorization: Bearer eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..TUhN0_EMCB2vDUF1cK1FAw.rFhU4azbNPeiWyhhrpICDmEbvjvYxMRoCR7b9Xbmx3V1e7Wv6HyfrMdJ37IBrxECBbUPeGZZUBa4IHOkwtvOlY9EkTh_OVyIVYA80VnWKB1LpwXUn6oMhxBetues_ToxEQKKi7RgGggAOdk9n9AASOD31rFb2ozbwvSpu7EqyRrexfjBtryzI1SfBkjQARlgw1NBoqMXWBFDiLL4pvR7GpHPPEasNbyOpr9avDtJ9-LXGVl__wYR4E2ksVhzw1QL3zO-l6cPWVzTV8MK_YEmaA.YuDjoCrPVjl19dzCDsn_iQ"
Hello World!

# Making a request directly to the endpoint should fail
curl -X GET http://127.0.0.1:3000
Unauthorized!!!!

```
