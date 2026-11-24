#!/usr/bin/env bash
# Prints the addresses to paste into VoiceLink's "WebSocket bot" form on YOUR terminal only: they hold the secret token, so they are never written to a file, a log or a chat.
# Usage: deploy/voicelink-bot-url.sh staging|production
#   websocket_url   the bot's address (the field `websocket_url`)
#   webhook_url     where VoiceLink reports each call (the field `webhook_url`)
#   inbound API     only if VoiceLink is asked to route each call dynamically ("Dynamic WebSocket & Webhook for Incoming Call"); the static bot above is enough otherwise
# The token is the secret `sme-voicelink-ws-token` (the API's VOICELINK_WS_TOKEN); without it every one of these answers nothing.
set -euo pipefail
case "${1:-}" in
  staging) project="project-2757c07e-37d2-4167-88f" ;;
  production) project="stack19-production" ;;
  *) echo "usage: $0 staging|production" >&2; exit 2 ;;
esac
host=$(gcloud run services describe sme-api --region asia-south1 --project "$project" --format='value(status.url)' | sed 's#^https://##')
token=$(gcloud secrets versions access latest --secret=sme-voicelink-ws-token --project "$project" | tr -d '\r\n')
case "$token" in *[[:space:]]*) echo "the token holds a space: not usable" >&2; exit 1 ;; esac
[ "${#token}" -ge 32 ] || { echo "the token is shorter than 32 characters: not usable" >&2; exit 1; }
echo "VoiceLink addresses for $1 (keep them private, they contain the secret):"
echo "  websocket_url : wss://${host}/v1/telephony/voicelink/ws/${token}"
echo "  webhook_url   : https://${host}/v1/telephony/voicelink/webhook/${token}"
echo "  inbound API   : https://${host}/v1/telephony/voicelink/inbound_call/${token}   (only for dynamic routing)"
