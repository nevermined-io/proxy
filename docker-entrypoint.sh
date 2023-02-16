#!/usr/bin/env bash

nginx &

yarn start:oauth-server 

tail -f /dev/null