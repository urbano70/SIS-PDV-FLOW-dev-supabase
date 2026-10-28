FROM node:20-alpine

WORKDIR /app

# Instalar dependências
COPY package*.json ./
RUN npm ci

# Copiar código fonte
COPY . .

# Build: compilar server.ts → server.js e frontend com Vite
RUN npm run build

EXPOSE 3000

CMD ["node", "server.js"]
