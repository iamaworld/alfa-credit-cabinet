# Контекст сборки — корень репозитория: docker build -f app/Dockerfile .
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/srv/data/cabinet.db \
    DOCS_DIR=/srv/app/docs
WORKDIR /srv/app
COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY app/src ./src
COPY app/public ./public
COPY docs/openapi.yaml ./docs/openapi.yaml
RUN mkdir -p /srv/data && chown -R node:node /srv/data /srv/app
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
