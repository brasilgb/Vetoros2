#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: $0 BACKUP_FILE NEW_DATABASE" >&2
  exit 2
fi

backup_file=$1
restore_database=$2
env_file=${ENV_FILE:-.env.production}
compose_file=${COMPOSE_FILE:-compose.production.yaml}

case "$restore_database" in
  ''|*[!A-Za-z0-9_]*) echo "NEW_DATABASE must contain only letters, numbers and underscore" >&2; exit 2 ;;
esac
test -s "$backup_file"
docker compose --env-file "$env_file" -f "$compose_file" exec -T -e RESTORE_DATABASE="$restore_database" postgres \
  sh -c 'createdb --username "$POSTGRES_USER" "$RESTORE_DATABASE"'
docker compose --env-file "$env_file" -f "$compose_file" exec -T -e RESTORE_DATABASE="$restore_database" postgres \
  sh -c 'psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 --command "GRANT CONNECT, CREATE ON DATABASE \"$RESTORE_DATABASE\" TO vetoros_migration; GRANT CONNECT ON DATABASE \"$RESTORE_DATABASE\" TO vetoros_runtime, vetoros_auth;"'
docker compose --env-file "$env_file" -f "$compose_file" exec -T -e RESTORE_DATABASE="$restore_database" postgres \
  sh -c 'pg_restore --username "$POSTGRES_USER" --dbname "$RESTORE_DATABASE" --exit-on-error' < "$backup_file"
