#!/bin/bash
# Backup diário de todos os bancos PostgreSQL dos clientes
# Agendar via cron: 0 3 * * * /opt/pdv/docker/backup.sh

BACKUP_DIR="/opt/pdv/backups/$(date +%Y-%m-%d)"
mkdir -p "$BACKUP_DIR"

for i in 1 2 3 4 5; do
  CONTAINER="pdv-db-${i}"
  FILE="${BACKUP_DIR}/cliente${i}.sql.gz"

  if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    docker exec "$CONTAINER" pg_dump -U pdv pdv | gzip > "$FILE"
    echo "[$(date)] Backup cliente $i: $FILE"
  else
    echo "[$(date)] AVISO: container $CONTAINER não está rodando"
  fi
done

# Remove backups com mais de 30 dias
find /opt/pdv/backups -type d -mtime +30 -exec rm -rf {} + 2>/dev/null

echo "[$(date)] Backup concluído"
