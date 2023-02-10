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

# start the proxy (http://localhost:3128) - it will print out a valid access token
yarn start:proxy

# test endpoints
curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0YXJnZXQiOiJodHRwOi8vMTI3LjAuMC4xOjMwMDAiLCJpYXQiOjE2NzUyNTMxMTEsImV4cCI6MTY3NTI4MTkxMX0.zXYblmhQRDoTS-PnhImgDH8yFbjFoxjJVD46G0FdW1o" http://localhost:3000 --proxy http://localhost:3128

# test endpoint with query parameters
curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0YXJnZXQiOiJodHRwOi8vMTI3LjAuMC4xOjMwMDAiLCJpYXQiOjE2NzUyNTMxMTEsImV4cCI6MTY3NTI4MTkxMX0.zXYblmhQRDoTS-PnhImgDH8yFbjFoxjJVD46G0FdW1o" http://localhost:3000/sum?a=1&b=2 --proxy http://localhost:3128

# not setting the authorization header should return a 401
curl http://localhost:3000 --proxy http://localhost:3128
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
curl -X GET http://127.0.0.1:3000 --proxy http://127.0.0.1:3128 -H "NVM-Authorization: Bearer eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..6UxkNXw3frD76QY-DToX-w.PnJHXcF4P8m50MNIOjbz33WDHsLCDrk-8C3pMprJVpKOYQurlmup6dXtRgCVRQ6hXbSTnLEcyqbuqWk2rHnAHsgkODapiT0APlZhL5y6E5WEDSjmQEPjDkhahy5_VuOfnx5iAhOLgy_Vd-9wsWgZ-_S3w2DJ-RMV41rm12s6cd2XOFex_HcNaBBdG_OQQEBVttpGpnsiiFf9o__TnaVzxKPYwjck1EXQmEUKqWtosWKr8a6s5nVvqavksdz7d-EKVOEPbJR0Dt__AyJeacgoPYWGZjwhbqY_nybD2-xUITRxWXmBfDFY8dCcDk9o1c9QkT36DMWSFZQyZEqIhmv9FmFkRJYp8amvX1N9qPMesHo.UwuspOTtQDc12LVkLFc1gg"
Hello World!

# Making a request directly to the endpoint should fail
curl -X GET http://127.0.0.1:3000
Unauthorized!!!!

```

Also you can go to the sdk-js and use the integration test:

```bash
cd sdk-js
yarn run integration:external
```
