#!/usr/bin/env bash
# Prueba de respaldo y restauración (specs/02 §Otros controles, F10-T3).
#
# 1. Respalda SOURCE_URL con pg_dump (formato custom) en BACKUP_FILE.
# 2. Lo restaura en una base nueva (TARGET_DB) del servidor de ADMIN_URL.
# 3. Verifica que la copia sea equivalente y segura: filas por tabla, migraciones, RLS y políticas,
#    permisos de pv_app y pv_service, dueño de las colas y aislamiento real con el rol pv_app.
#
# Uso:
#   SOURCE_URL=postgres://dueño@host/pv_iot \
#   ADMIN_URL=postgres://dueño@host/postgres \
#   TARGET_DB=pv_iot_restore_check \
#   [BACKUP_FILE=/ruta/respaldo.dump] [KEEP_TARGET=1] \
#   packages/db/scripts/verify-restore.sh
#
# Requisitos: pg_dump/pg_restore/psql de la misma versión mayor que el servidor y una conexión que
# no esté sujeta a RLS (superusuario o BYPASSRLS): las tablas de empresa tienen FORCE ROW LEVEL
# SECURITY y pg_dump se niega a respaldarlas con un rol sujeto a RLS.
set -euo pipefail

: "${SOURCE_URL:?Falta SOURCE_URL}"
: "${ADMIN_URL:?Falta ADMIN_URL}"
: "${TARGET_DB:?Falta TARGET_DB}"
BACKUP_FILE="${BACKUP_FILE:-$(mktemp -t pv-iot-XXXXXX.dump)}"

if [[ ! "$TARGET_DB" =~ ^[a-z0-9_]*restore[a-z0-9_]*$ ]]; then
  echo "TARGET_DB debe contener 'restore' (protección contra borrar una base real)" >&2
  exit 2
fi

target_url() {
  # Misma conexión que ADMIN_URL, con la base de destino.
  local base="${ADMIN_URL%%\?*}" query=""
  [[ "$ADMIN_URL" == *\?* ]] && query="?${ADMIN_URL#*\?}"
  echo "${base%/*}/${TARGET_DB}${query}"
}
TARGET_URL="$(target_url)"
q() { psql -X -v ON_ERROR_STOP=1 -qAt "$@"; }
fail() { echo "FALLA: $*" >&2; exit 1; }
ok() { echo "OK    $*"; }

bypass=$(q "$SOURCE_URL" -c "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user")
[[ "$bypass" == "t" ]] || fail "la conexión de SOURCE_URL está sujeta a RLS; usa un rol con BYPASSRLS"

started=$(date +%s)
echo "Respaldando en $BACKUP_FILE…"
pg_dump --format=custom --no-owner --file="$BACKUP_FILE" "$SOURCE_URL"
ok "respaldo: $(du -h "$BACKUP_FILE" | cut -f1)"

echo "Restaurando en $TARGET_DB…"
q "$ADMIN_URL" -c "DROP DATABASE IF EXISTS \"$TARGET_DB\"" -c "CREATE DATABASE \"$TARGET_DB\""
# Los roles son del servidor, no de la base: si el destino es otro servidor se crean igual que en la
# migración rls (sin LOGIN; los usuarios de conexión se crean aparte, ver packages/db/README.md).
q "$TARGET_URL" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pv_app') THEN
    CREATE ROLE pv_app NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pv_service') THEN
    CREATE ROLE pv_service NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
SQL
pg_restore --no-owner --exit-on-error --dbname="$TARGET_URL" "$BACKUP_FILE"
# pg-boss instala sus tablas a nombre de pv_service (packages/db/README.md §Colas).
q "$TARGET_URL" <<'SQL'
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'pgboss' LOOP
    EXECUTE format('ALTER TABLE pgboss.%I OWNER TO pv_service', r.tablename);
  END LOOP;
END
$$;
SQL
ok "restaurado en $(( $(date +%s) - started )) s"

# --- Verificaciones -------------------------------------------------------------------------
# Filas por tabla (como dueño sin RLS: el rol tiene BYPASSRLS o es superusuario).
COUNTS_SQL="
SELECT string_agg(format('%s.%s=%s', schemaname, tablename,
         (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', schemaname, tablename), false, true, '')))[1]::text),
       E'\n' ORDER BY schemaname, tablename)
FROM pg_tables WHERE schemaname IN ('public', 'pgboss')"
src_counts=$(q "$SOURCE_URL" -c "$COUNTS_SQL")
dst_counts=$(q "$TARGET_URL" -c "$COUNTS_SQL")
[[ "$src_counts" == "$dst_counts" ]] || {
  diff <(echo "$src_counts") <(echo "$dst_counts") >&2 || true
  fail "las filas por tabla no coinciden"
}
ok "filas por tabla idénticas ($(echo "$dst_counts" | wc -l) tablas, $(echo "$dst_counts" | awk -F= '{s+=$2} END {print s}') filas)"

same() {
  local name="$1" sql="$2" a b
  a=$(q "$SOURCE_URL" -c "$sql"); b=$(q "$TARGET_URL" -c "$sql")
  [[ "$a" == "$b" ]] || fail "$name: origen=[$a] copia=[$b]"
  ok "$name: $b"
}
same "migraciones aplicadas" \
  "SELECT count(*) || ' (última ' || max(migration_name) || ')' FROM _prisma_migrations WHERE finished_at IS NOT NULL"
same "tablas con RLS forzado" \
  "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relrowsecurity AND c.relforcerowsecurity"
same "políticas de RLS" "SELECT count(*) FROM pg_policies WHERE schemaname = 'public'"
same "permisos de pv_app y pv_service" \
  "SELECT grantee || ':' || count(*) FROM information_schema.role_table_grants WHERE grantee IN ('pv_app', 'pv_service') GROUP BY grantee ORDER BY grantee"
same "tablas de pg-boss de pv_service" \
  "SELECT count(*) FROM pg_tables WHERE schemaname = 'pgboss' AND tableowner = 'pv_service'"

# Aislamiento real en la copia: como pv_app, sin empresa no ve nada; con una empresa solo lo suyo.
company=$(q "$TARGET_URL" -c "SELECT id FROM companies ORDER BY created_at LIMIT 1")
if [[ -n "$company" ]]; then
  expected=$(q "$TARGET_URL" -c "SELECT count(*) FROM solar_plants WHERE company_id = '$company'")
  result=$(q "$TARGET_URL" <<SQL
BEGIN;
SET LOCAL ROLE pv_app;
SELECT count(*) FROM solar_plants;
SELECT set_config('app.company_id', '$company', true);
SELECT count(*) FROM solar_plants;
SELECT count(*) FROM solar_plants WHERE company_id <> '$company';
ROLLBACK;
SQL
)
  # Salida: sin empresa, el valor de set_config, propias, ajenas.
  mapfile -t lines <<<"$result"
  none="${lines[0]:-}" mine="${lines[2]:-}" others="${lines[3]:-}"
  [[ "$none" == "0" && "$mine" == "$expected" && "$others" == "0" ]] ||
    fail "aislamiento con pv_app: sin empresa=$none, propias=$mine (esperadas $expected), ajenas=$others"
  ok "aislamiento con pv_app: 0 filas sin empresa; $mine plantas propias y 0 ajenas con empresa"
fi

if [[ "${KEEP_TARGET:-0}" != "1" ]]; then
  q "$ADMIN_URL" -c "DROP DATABASE \"$TARGET_DB\""
  echo "Base de prueba $TARGET_DB eliminada (KEEP_TARGET=1 para conservarla)."
fi
echo "Prueba de restauración correcta en $(( $(date +%s) - started )) s."
