# Multi-stage Dockerfile para VPS (DLM WhatsApp Backend)
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runner Stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Diretório para persistência de sessões Baileys
RUN mkdir -p /app/auth_sessions
#VOLUME /app/auth_sessions

EXPOSE 3001

CMD ["node", "dist/server.js"]
