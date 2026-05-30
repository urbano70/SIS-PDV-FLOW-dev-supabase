# ──────────────────────────────────────────────────────────────────
# Stage 1: Builder — compila server.ts e faz o vite build do frontend
# ──────────────────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Variáveis embutidas pelo Vite no bundle durante o build.
# Passe como build-args no EasyPanel ou via --build-arg no docker build.
ARG GEMINI_API_KEY=""
ARG FIREBASE_CONFIG=""
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_ANON_KEY=""

ENV GEMINI_API_KEY=$GEMINI_API_KEY
ENV FIREBASE_CONFIG=$FIREBASE_CONFIG
# VITE_* não precisam de ENV — o .env.production é lido pelo Vite durante o build

RUN npm run build

# ──────────────────────────────────────────────────────────────────
# Stage 2: Runner — imagem mínima de produção
# ──────────────────────────────────────────────────────────────────
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production

# Instala somente dependências de produção (sem devDependencies)
COPY package*.json ./
RUN npm ci --omit=dev

# Artefatos do build
COPY --from=builder /app/server.js ./
COPY --from=builder /app/dist     ./dist

EXPOSE 3001

CMD ["node", "server.js"]
