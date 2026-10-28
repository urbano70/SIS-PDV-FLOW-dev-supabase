#!/bin/bash
# ================================================================
# SIS-PDV — Backup automático dos bancos PostgreSQL
#
# Configurar no cron da VPS (backup às 3h da manhã):
#   crontab -e
#   0 3 * * * /opt/pdv/docker/backup.sh >> /var/log/pdv-backup.log 2>&1
# ================================================================

set -e

BACKUP_DIR="/opt/pdv-backups/$(date +%Y-%m-%d)"
CLIENTES=5
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"

mkdir -p "$BACKUP_DIR"

echo "$LOG_PREFIX Iniciando backup de $CLIENTES clientes..."

for i in $(seq 1 $CLIENTES); do
  CONTAINER="postgres-cliente-$i"

  # Verificar se o container está rodando
  if ! docker inspect "$CONTAINER" > /dev/null 2>&1; then
    echo "$LOG_PREFIX ⚠️  Cliente $i: container $CONTAINER não encontrado — pulando"
    continue
  fi

  echo "$LOG_PREFIX Backup cliente $i..."
  docker exec "$CONTAINER" pg_dump -U pdv pdv | gzip > "$BACKUP_DIR/cliente-$i.sql.gz"

  SIZE=$(du -sh "$BACKUP_DIR/cliente-$i.sql.gz" | cut -f1)
  echo "$LOG_PREFIX ✅ Cliente $i: $BACKUP_DIR/cliente-$i.sql.gz ($SIZE)"
done

# Manter apenas os últimos 7 dias
find /opt/pdv-backups -maxdepth 1 -type d -mtime +7 -exec rm -rf {} + 2>/dev/null || true

echo "$LOG_PREFIX Backup concluído. Arquivos em: $BACKUP_DIR"
