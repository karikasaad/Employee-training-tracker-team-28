# EN: small Node 20 image; runs as the non-root user "node" (least privilege).
# Franco: image so8ayyara Node 20; beteshta8al b user "node" mesh root (adna sala7eyat).
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
USER node
EXPOSE 5003
CMD ["node", "src/server.js"]
