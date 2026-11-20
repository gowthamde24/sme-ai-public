#!/usr/bin/env bash
# Which Supabase project is THIS checkout linked to? Run before ANY `supabase db push / reset / query --linked` (owner's `supabase link` of 21 Nov 2026 pointed the MAIN checkout at PRODUCTION).
#   deploy/db_target.sh staging      exit 0 only when supabase/.temp/project-ref is the STAGING project (uiallwgywitryxatcqxf)
#   deploy/db_target.sh production   exit 0 only when it is the PRODUCTION project (ijmsusgyilwskpjxfauu)
#   deploy/db_target.sh              prints which one it is
# Staging pushes come from a c1wt-* worktree only; production pushes only at the owner's go (docs/runbooks/production-bringup-all-in-order.md).
set -euo pipefail
cd "$(dirname "$0")/.."
STAGING="uiallwgywitryxatcqxf"; PRODUCTION="ijmsusgyilwskpjxfauu"
ref="$(cat supabase/.temp/project-ref 2>/dev/null || true)"
name="unlinked"; [ "$ref" = "$STAGING" ] && name="staging"; [ "$ref" = "$PRODUCTION" ] && name="PRODUCTION"
echo "this checkout ($(pwd)) is linked to: $name ${ref:+($ref)}"
want="${1:-}"
[ -z "$want" ] && exit 0
case "$want" in staging) ok="$STAGING" ;; production) ok="$PRODUCTION" ;; *) echo "usage: $0 [staging|production]" >&2; exit 2 ;; esac
[ "$ref" = "$ok" ] || { echo "REFUSED: expected $want, this checkout is $name. Do not push from here." >&2; exit 1; }
