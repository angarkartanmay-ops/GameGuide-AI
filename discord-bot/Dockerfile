FROM node:20-alpine
WORKDIR /app

# Layer-cache deps before source
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Health check uses the bot's /health endpoint — host treats failed
# checks as restart signals (Docker, Fly.io machines, ECS).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/health" | grep -q '"ok":true' || exit 1

CMD ["node", "index.js"]
