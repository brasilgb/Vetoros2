#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: $0 BACKUP_FILE" >&2
  exit 2
fi

backup_file=$1
env_file=${ENV_FILE:-.env.production}
compose_file=${COMPOSE_FILE:-compose.production.yaml}
retention_days=${BACKUP_RETENTION_DAYS:-}

if [ -n "$retention_days" ] && ! printf '%s' "$retention_days" | grep -Eq '^[0-9]+$'; then
  echo "BACKUP_RETENTION_DAYS must be a non-negative integer" >&2
  exit 2
fi

umask 077
docker compose --env-file "$env_file" -f "$compose_file" exec -T postgres \
  sh -c 'pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format=custom' > "$backup_file"
test -s "$backup_file"

if [ -n "$retention_days" ]; then
  backup_dir=$(dirname -- "$backup_file")
  find "$backup_dir" -maxdepth 1 -type f -name 'vetoros-*.dump' -mtime "+$retention_days" -delete
fi
