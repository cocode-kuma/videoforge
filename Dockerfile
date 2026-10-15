FROM node:22-bookworm-slim
LABEL org.opencontainers.image.title="cocode 酷码工作室 · Cocode Studio VideoForge"
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg chromium fonts-noto-cjk fonts-liberation ca-certificates tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
COPY .npmrc ./
COPY plugins/cocode-data-store/package.json ./plugins/cocode-data-store/
COPY plugins/cocode-director/package.json ./plugins/cocode-director/
COPY plugins/cocode-studio-ui/package.json ./plugins/cocode-studio-ui/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && mkdir -p video_projects logs .dsh-videoforge && chown -R node:node /app
USER node
RUN node node_modules/hyperframes/bin/hyperframes.mjs browser ensure
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3088
EXPOSE 3088
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "start"]
