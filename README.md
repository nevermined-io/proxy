[![banner](https://raw.githubusercontent.com/nevermined-io/assets/main/images/logo/banner_logo.png)](https://nevermined.io)

# Nevermined Proxy PoC

> Proxy for connecting tokenized web services
> [nevermined.io](https://nevermined.io)

## Info

This Proxy Proof of Concept (PoC) pretends to show how to build a HTTP Proxy component that allows
to gate-keep web services and make them available to external user via subscriptions.

The proxy will leverage Nevermined core product to provide that functionality.

This PoC will ask the following questions:

* How can we gate-keep internal and/or external web services?
* How can we provide access to these services using NFT susbcriptions?
* What are the flows that need to be supported?
* What is the architecture of the solution?
* What would be a high-level estimation to include this solution as part of the core product?

## PoC Requirements

The solution proposed or designed must take into account the following requirements:

* The modifications required by the service provider must be as small as possible or ideally zero.
* The modifications required by user of the service must be as small as possible or ideally zero.
* If some changes need to be done, it is prefered these changes are service or client configuration over code modifications
* If some code modifications need to be done they must be as close to a recognized standard as possible.

The adoption of the end solution will be influenced by the requirements introduced to the users. The simpler and
friction-less is the solution the better.

## PoC Use Case

To facilitate the understanding of the PoC and how is implemented we are gonna use two use cases. 
One of them using an internal web service (we operate and can control) and an external web service (running somewhere).

We use the following actors in the PoC:

* The Service Owner or **Publisher**. This actors owns/control a web service and wants to make it available under some 
  conditions (payment) to the rest of the world.
* The Service Consumer or **Client**. This actor wants to get access to the web service to integrate the data provided in 
  his/her application.

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
