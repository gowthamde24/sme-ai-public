#!/usr/bin/env bash
# Prints the address to paste into VoiceLink's "WebSocket bot" form (their field `websocket_url`) on YOUR terminal only: it holds the secret token, so it is never written to a file,
# a log or a chat. Usage: deploy/voicelink-bot-url.sh staging|production
# The token is the secret `sme-voicelink-ws-token` (the API's VOICELINK_WS_TOKEN); without it the route answers nothing.
set -euo pipefail
case "${1:-}" in
  staging) project="project-2757c07e-37d2-4167-88f" ;;
  production) project="stack19-production" ;;
  *) echo "usage: $0 staging|production" >&2; exit 2 ;;
esac
host=$(gcloud run services describe sme-api --region asia-south1 --project "$project" --format='value(status.url)' | sed 's#^https://##')
token=$(gcloud secrets versions access latest --secret=sme-voicelink-ws-token --project "$project")
[ "${#token}" -ge 32 ] || { echo "the token is shorter than 32 characters: not usable" >&2; exit 1; }
echo "VoiceLink websocket_url for $1 (keep it private, it contains the secret):"
echo "wss://${host}/v1/telephony/voicelink/ws/${token}"
