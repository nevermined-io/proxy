FROM nginx:1.23.3-alpine
LABEL maintainer="Nevermined <root@nevermined.io>"

EXPOSE 3128 
EXPOSE 443

RUN apk update && apk upgrade && \
    apk add --no-cache --virtual .build-deps \
    curl \
    bash \
    nodejs-current \
    yarn \
    npm

# Preparing NGINX
RUN rm -f /etc/nginx/conf.d/default.conf
COPY conf/nginx/nginx.conf /etc/nginx/nginx.conf
COPY conf/nginx/proxy.conf /etc/nginx/sites-enabled/proxy.conf
COPY conf/nginx/oauth2.js /etc/nginx/conf.d/oauth2.js

# Preparing OAuth Server
COPY package.json ./
COPY tsconfig* ./
COPY src ./src

RUN yarn 
RUN yarn build

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

ENTRYPOINT [ "./docker-entrypoint.sh" ]
