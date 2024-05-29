#!/usr/bin/env bash

nginx &

yarn start:oauth-server &
yarn start:syslog-server &

tail -f /dev/null