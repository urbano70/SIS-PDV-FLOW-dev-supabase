#!/bin/bash
# ================================================================
# SIS-PDV — Provisionar novo cliente
#
# Uso: ./provision.sh <numero> <nome> <subdominio>
# Ex:  ./provision.sh 6 "Pizzaria Nova" pizzaria-nova
#
# O script gera a senha do banco e mostra o que você precisa
# adicionar no docker-compose.yml, nginx.conf e .env
# ================================================================

set -e

NUM=$1
NOME=$2
SUBDOMINIO=$3

if [ -z "$NUM" ] || [ -z "$NOME" ] || [ -z "$SUBDOMINIO" ]; then
  echo "Uso: $0 <numero> <nome> <subdominio>"
  echo "Ex:  $0 6 'Pizzaria Nova' pizzaria-nova"
  exit 1
fi

DB_PASS=$(openssl rand -base64 20 | tr -d '/+=')
PORTA=$((3000 + NUM))

echo ""
echo "════════════════════════════════════════════════"
echo "  Provisionando Cliente $NUM: $NOME"
echo "  URL: $SUBDOMINIO.seupdv.com.br → porta $PORTA"
echo "════════════════════════════════════════════════"
echo ""

echo "── 1. Adicione ao arquivo .env ─────────────────"
cat <<EOF
CLIENTE${NUM}_DB_PASS=$DB_PASS
CLIENTE${NUM}_SUPABASE_URL=https://SEU_PROJETO.supabase.co
CLIENTE${NUM}_SUPABASE_ANON_KEY=eyJ...
CLIENTE${NUM}_SUPABASE_SERVICE_ROLE_KEY=eyJ...
EOF

echo ""
echo "── 2. Adicione ao docker-compose.yml ───────────"
cat <<EOF
  pdv-cliente-$NUM:
    image: sis-pdv:latest
    container_name: pdv-cliente-$NUM
    restart: unless-stopped
    ports:
      - "$PORTA:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - DATABASE_URL=postgresql://pdv:\${CLIENTE${NUM}_DB_PASS}@postgres-cliente-$NUM:5432/pdv
      - SUPABASE_URL=\${CLIENTE${NUM}_SUPABASE_URL}
      - SUPABASE_SERVICE_ROLE_KEY=\${CLIENTE${NUM}_SUPABASE_SERVICE_ROLE_KEY}
      - VITE_SUPABASE_URL=\${CLIENTE${NUM}_SUPABASE_URL}
      - VITE_SUPABASE_ANON_KEY=\${CLIENTE${NUM}_SUPABASE_ANON_KEY}
      - GEMINI_API_KEY=\${GEMINI_API_KEY}
    depends_on:
      postgres-cliente-$NUM:
        condition: service_healthy
    networks:
      - pdv-network

  postgres-cliente-$NUM:
    image: postgres:16-alpine
    container_name: postgres-cliente-$NUM
    restart: unless-stopped
    environment:
      - POSTGRES_DB=pdv
      - POSTGRES_USER=pdv
      - POSTGRES_PASSWORD=\${CLIENTE${NUM}_DB_PASS}
    volumes:
      - postgres-cliente-${NUM}-data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pdv -d pdv"]
      interval: 5s
      timeout: 5s
      retries: 10
    networks:
      - pdv-network
EOF

echo ""
echo "── 3. Adicione ao nginx.conf ───────────────────"
cat <<EOF
    upstream cliente$NUM { server pdv-cliente-$NUM:3000; }

    server {
        listen 80;
        server_name $SUBDOMINIO.seupdv.com.br;
        location / {
            proxy_pass         http://cliente$NUM;
            proxy_http_version 1.1;
            proxy_set_header   Upgrade \$http_upgrade;
            proxy_set_header   Connection \$connection_upgrade;
            proxy_set_header   Host \$host;
            proxy_set_header   X-Real-IP \$remote_addr;
            proxy_cache_bypass \$http_upgrade;
        }
    }
EOF

echo ""
echo "── 4. Adicione ao volumes: no docker-compose.yml"
echo "  postgres-cliente-${NUM}-data:"

echo ""
echo "── 5. Suba o novo cliente ──────────────────────"
echo "  docker compose up -d pdv-cliente-$NUM postgres-cliente-$NUM"
echo "  docker exec pdv-nginx nginx -s reload"
echo ""
echo "✅ Senha do banco: $DB_PASS (salve em local seguro!)"
echo ""
