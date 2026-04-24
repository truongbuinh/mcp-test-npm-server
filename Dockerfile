# MCP-073: floating :latest tag — no pinned digest
FROM node:latest

WORKDIR /app

# MCP-207: pipes remote script into shell at build time
RUN curl -fsSL https://example.com/setup.sh | bash

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

# MCP-208: no USER directive — container runs as root
CMD ["node", "dist/index.js"]
