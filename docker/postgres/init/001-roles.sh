#!/bin/sh
set -eu

psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set db_name="$POSTGRES_DB" \
  --set migration_password="$VETOROS_MIGRATION_PASSWORD" \
  --set runtime_password="$VETOROS_RUNTIME_PASSWORD" \
  --set auth_password="$VETOROS_AUTH_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE vetoros_migration LOGIN PASSWORD %L NOINHERIT NOBYPASSRLS', :'migration_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vetoros_migration')\gexec
SELECT format('CREATE ROLE vetoros_runtime LOGIN PASSWORD %L NOINHERIT NOBYPASSRLS', :'runtime_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vetoros_runtime')\gexec
SELECT format('CREATE ROLE vetoros_auth LOGIN PASSWORD %L NOINHERIT NOBYPASSRLS', :'auth_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vetoros_auth')\gexec
SELECT 'CREATE ROLE vetoros_worker NOLOGIN NOINHERIT NOBYPASSRLS'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vetoros_worker')\gexec
SELECT 'CREATE ROLE vetoros_control_plane NOLOGIN NOINHERIT NOBYPASSRLS'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vetoros_control_plane')\gexec
GRANT CONNECT ON DATABASE :"db_name" TO vetoros_migration, vetoros_runtime, vetoros_auth;
GRANT CREATE ON DATABASE :"db_name" TO vetoros_migration;
GRANT CREATE, USAGE ON SCHEMA public TO vetoros_migration WITH GRANT OPTION;
SQL
