# Моки внешних источников. Зависимостей нет: только стандартная библиотека Node.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /srv/mock
COPY mocks/package.json mocks/package-lock.json ./
COPY mocks/src ./src
USER node
HEALTHCHECK --interval=5s --timeout=3s --start-period=2s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "src/server.js"]
