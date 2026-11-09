FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY server.ts ./
RUN mkdir -p /home/node/.pi /home/node/sessions && chown -R node:node /home/node
USER node
ENV HOME=/home/node
EXPOSE 8080
CMD ["node", "--import", "tsx", "server.ts"]
