FROM nginx:1.23.3-alpine-perl
LABEL maintainer="Nevermined <root@nevermined.io>"

EXPOSE 3128 
EXPOSE 443

# OAuth Server environment variables
ENV SERVER_HOST "127.0.0.1"
ENV SERVER_PORT "4000"
ENV JWT_SECRET_PHRASE "12345678901234567890123456789012"

# Nginx environment variables
ENV INTROSPECTION_URL "http://127.0.0.1:4000/introspect"

RUN apk update && apk upgrade && \
    apk add --no-cache --virtual .build-deps \
    util-linux \
    openrc \
    nginx-mod-http-perl \
    curl \
    bash \
    nodejs-current \
    yarn \
    npm \
    rsyslog \
    rsyslog-pgsql

# Preparing NGINX
RUN rm -f /etc/nginx/conf.d/default.conf
COPY conf/nginx/nginx.conf /etc/nginx/nginx.conf
COPY conf/nginx/proxy.conf /etc/nginx/sites-enabled/proxy.conf
COPY conf/nginx/oauth2.js /etc/nginx/conf.d/oauth2.js

# Preparing Rsyslog
COPY conf/rsyslog/51-upstream.template.conf /etc/rsyslog.d/51-upstream.conf

RUN  rc-update add rsyslogd boot

# Preparing OAuth Server
COPY package.json ./
COPY tsconfig* ./
COPY src ./src

RUN yarn 
RUN yarn build

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

ENTRYPOINT [ "./docker-entrypoint.sh" ]
