#!/bin/bash
# Provisiona um novo cliente no stack PDV
# Uso: ./provision.sh <numero_cliente> <dominio> <senha_db>
# Ex:  ./provision.sh 6 cliente6.seudominio.com.br senha_segura_6

set -e

CLIENT_NUM=$1
DOMAIN=$2
DB_PASSWORD=$3

if [ -z "$CLIENT_NUM" ] || [ -z "$DOMAIN" ] || [ -z "$DB_PASSWORD" ]; then
  echo "Uso: $0 <numero_cliente> <dominio> <senha_db>"
  exit 1
fi

ENV_FILE="$(dirname "$0")/.env"

if [ ! -f "$ENV_FILE" ]; then
  cp "$(dirname "$0")/.env.example" "$ENV_FILE"
  echo "Arquivo .env criado a partir do exemplo."
fi

echo "" >> "$ENV_FILE"
echo "DB_PASSWORD_${CLIENT_NUM}=${DB_PASSWORD}" >> "$ENV_FILE"
echo "DOMAIN_${CLIENT_NUM}=${DOMAIN}" >> "$ENV_FILE"

echo ""
echo "Cliente $CLIENT_NUM adicionado ao .env!"
echo ""
echo "Próximos passos:"
echo "  1. Edite docker/docker-compose.yml e adicione os serviços:"
echo "     - postgres-${CLIENT_NUM} (copie o bloco postgres-5)"
echo "     - pdv-${CLIENT_NUM}      (copie o bloco pdv-5)"
echo "  2. Edite docker/nginx.conf e adicione o bloco do CLIENTE ${CLIENT_NUM}"
echo "     com o domínio: $DOMAIN"
echo "  3. Obtenha o certificado SSL:"
echo "     certbot certonly --standalone -d $DOMAIN"
echo "  4. Suba os containers:"
echo "     cd docker && docker compose up -d"
echo ""
