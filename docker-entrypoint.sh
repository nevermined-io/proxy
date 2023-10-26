#!/usr/bin/env bash

nginx &

service rsyslog restart

yarn start:oauth-server 

tail -f /dev/null