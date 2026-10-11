#!/usr/bin/env bash
# A logical backup of the HOSTED database to a file on THIS machine (job BG, docs/runbooks/hosting-owner-runbook.md, "Backups").
#
# Why: the Supabase FREE plan has no backups and its dashboard cannot download one. Pro keeps daily backups for 7 days, but a copy of your own, off the platform, is still a good habit
# (and the restore drill, docs/runbooks/backup-restore-drill.md, can restore from it into a throwaway project).
#
#   BACKUP_DB_HOST=<host from Supabase > Connect >   BACKUP_DB_USER=postgres.<ref>   [BACKUP_DB_PORT=5432]   [BACKUP_DIR=~/sme-backups] \
#   ./deploy/backup-db.sh [--execute]
#
# DRY RUN BY DEFAULT: it prints the command and runs nothing. With --execute it asks for the database password HIDDEN (nothing is echoed, written to a file, or put on a command line: it reaches
# pg_dump only through the PGPASSWORD of that one process), refuses a pg_dump older than the server (Postgres 17), writes <BACKUP_DIR>/sme-<UTC time>.dump readable by you alone, and prints its size.
# It reads the database only. Use the SESSION pooler address (port 5432, user postgres.<ref>) if your network has no IPv6; the direct address is IPv6 only.
# The file holds everything in the database, personal data included once the real-data gate is open: keep it encrypted at rest (FileVault) and never in the repository or a shared folder.
set -euo pipefail

execute=false
for arg in "$@"; do [ "$arg" = "--execute" ] && execute=true; done
: "${BACKUP_DB_HOST:?set BACKUP_DB_HOST (the host from Supabase > Connect)}" "${BACKUP_DB_USER:?set BACKUP_DB_USER (postgres.<project ref> for the pooler)}"
PORT="${BACKUP_DB_PORT:-5432}"
DIR="${BACKUP_DIR:-$HOME/sme-backups}"
case "$BACKUP_DB_HOST$BACKUP_DB_USER" in *[!A-Za-z0-9._-]*) echo "BACKUP_DB_HOST and BACKUP_DB_USER may only contain letters, digits, dot, dash, underscore" >&2; exit 2 ;; esac
case "$PORT" in *[!0-9]* | "") echo "BACKUP_DB_PORT must be a number" >&2; exit 2 ;; esac
case "$DIR" in "$(cd "$(dirname "$0")/.." && pwd)"/*) echo "BACKUP_DIR must be outside the repository (a backup holds personal data)" >&2; exit 2 ;; esac
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$DIR/sme-$stamp.dump"

printf '+ mkdir -p %q && chmod 700 %q\n' "$DIR" "$DIR"
printf '+ PGPASSWORD=<typed hidden> pg_dump -h %q -p %q -U %q -d postgres --format=custom --no-owner --no-privileges --schema=public --schema=app --schema=auth -f %q\n' "$BACKUP_DB_HOST" "$PORT" "$BACKUP_DB_USER" "$file"
if ! $execute; then echo "(dry run: nothing was run. Add --execute to run the commands above.)"; exit 0; fi

command -v pg_dump >/dev/null || { echo "pg_dump is not installed (brew install libpq)" >&2; exit 2; }
version="$(pg_dump --version | sed -n 's/.* \([0-9][0-9]*\)\..*/\1/p')"
[ "${version:-0}" -ge 17 ] || { echo "pg_dump $version is older than the server (Postgres 17): install a newer client" >&2; exit 2; }
read -rsp "Database password (typed hidden): " PGPASSWORD; echo
[ -n "$PGPASSWORD" ] || { echo "empty password: nothing was done" >&2; exit 2; }
export PGPASSWORD
umask 077
mkdir -p "$DIR" && chmod 700 "$DIR"
pg_dump -h "$BACKUP_DB_HOST" -p "$PORT" -U "$BACKUP_DB_USER" -d postgres --format=custom --no-owner --no-privileges --schema=public --schema=app --schema=auth -f "$file"
unset PGPASSWORD
chmod 600 "$file"
echo "wrote $file ($(wc -c < "$file" | tr -d ' ') bytes). Copy it off this machine only to somewhere encrypted that you control."
