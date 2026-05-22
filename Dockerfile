# ──────────────────────────────────────────────────────────────────
# Stage 1: Builder — compila server.ts e faz o vite build do frontend
# ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# GEMINI_API_KEY é embutida pelo Vite no bundle do frontend durante o build.
# Passe via: docker build --build-arg GEMINI_API_KEY=xxx
# ou defina no .env e use docker-compose (que lê .env automaticamente).
ARG GEMINI_API_KEY=""
ENV GEMINI_API_KEY=$GEMINI_API_KEY

RUN npm run build

# ──────────────────────────────────────────────────────────────────
# Stage 2: Runner — imagem mínima de produção
# ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Instala somente dependências de produção (sem devDependencies)
COPY package*.json ./
RUN npm ci --omit=dev

# Artefatos do build
COPY --from=builder /app/server.js ./
COPY --from=builder /app/dist     ./dist

# Configuração Firebase (lida pelo servidor no startup)
COPY firebase-applet-config.json ./

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
