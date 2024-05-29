#!/usr/bin/env bash

nginx &

# Preparing Rsyslog
sed -i "s|PG_HOST|$PG_HOST|g" /etc/rsyslog.d/51-upstream.conf
sed -i "s|PG_USER|$PG_USER|g" /etc/rsyslog.d/51-upstream.conf
sed -i "s|PG_PASSWORD|$PG_PASSWORD|g" /etc/rsyslog.d/51-upstream.conf
sed -i "s|PG_DB|$PG_DB|g" /etc/rsyslog.d/51-upstream.conf

rsyslogd

yarn start:oauth-server &
yarn start:syslog-server &

tail -f /dev/null