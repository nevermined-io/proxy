#!/usr/bin/env bash

nginx &

# Preparing Rsyslog
conf/rsyslog/51-upstream.template.conf /etc/rsyslog.d/51-upstream.conf

sed -i "s|PG_HOST|$PG_HOST|g" /etc/rsyslog.d/51-upstream.conf
sed -i "s|PG_USER|$PG_USER|g" /etc/rsyslog.d/51-upstream.conf
sed -i "s|PG_PASSWORD|$PG_PASSWORD|g" /etc/rsyslog.d/51-upstream.conf
sed -i "s|PG_DB|$PG_DB|g" /etc/rsyslog.d/51-upstream.conf

service rsyslog restart

yarn start:oauth-server 

tail -f /dev/null