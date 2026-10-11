#!/usr/bin/env sh
# Source this (`. scripts/stack.sh`): it sets SME_STACK, SME_PROJECT_ID, SME_WORKDIR, SME_API_PORT, SME_DB_PORT and SME_DB_CONTAINER for the local Supabase stack in use (job BG).
# The shell twin of scripts/stack_env.py (tests/test_stacks.py checks they agree). Order: SME_STACK; else the port of SUPABASE_URL; else the AGENT stack.
#   owner = the owner's demo stack (supabase/config.toml, project sme-ai, API 54321)   agent = the agent test stack (stacks/sme-ai-agent, project sme-ai-agent, API 54421)
if [ -z "${SME_STACK:-}" ]; then
  case "${SUPABASE_URL:-}" in
    *:54321 | *:54321/*) SME_STACK=owner ;;
    *) SME_STACK=agent ;;
  esac
fi
case "$SME_STACK" in
  owner) SME_PROJECT_ID=sme-ai; SME_WORKDIR=.; SME_API_PORT=54321; SME_DB_PORT=54322 ;;
  agent) SME_PROJECT_ID=sme-ai-agent; SME_WORKDIR=stacks/sme-ai-agent; SME_API_PORT=54421; SME_DB_PORT=54422 ;;
  *) echo "SME_STACK must be 'agent' or 'owner', not '$SME_STACK'." >&2; return 2 2>/dev/null || exit 2 ;;
esac
SME_DB_CONTAINER="${SME_DB_CONTAINER:-supabase_db_$SME_PROJECT_ID}"
export SME_STACK SME_PROJECT_ID SME_WORKDIR SME_API_PORT SME_DB_PORT SME_DB_CONTAINER

# sme_require_owner_ok <what>: on the owner's stack, refuse unless OWNER_OK=1.
sme_require_owner_ok() {
  if [ "$SME_STACK" = owner ] && [ "${OWNER_OK:-}" != 1 ]; then
    echo "Refusing to $1 on the OWNER's stack (project sme-ai, port 54321): it belongs to the owner's demo. Agents use the agent stack (the default: make agent-db-up). The owner may set OWNER_OK=1 on purpose." >&2
    return 3
  fi
  return 0
}
