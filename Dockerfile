FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/node:16-alpine


RUN mkdir -p /app/user_config && chown -R node:node /app
WORKDIR /app


USER node


COPY --chown=node:node package.json package-lock.json* ./
RUN npm ci --registry=https://registry.npmmirror.com


COPY --chown=node:node . .


RUN npm run build


VOLUME /app/user_config

EXPOSE 8084


CMD ["npm", "run", "start"]
