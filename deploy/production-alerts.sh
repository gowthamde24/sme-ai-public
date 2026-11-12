#!/usr/bin/env bash
# Monitoring and alerts for the PRODUCTION project (Cloud Logging log-based metrics + Cloud Monitoring alert policies + one e-mail channel). 11 Nov 2026.
# DRY RUN BY DEFAULT: prints the gcloud commands; --execute runs them (owner present; it creates metrics and policies, which are free at this size).
#   ALERT_EMAIL=<where alerts go; the owner's choice>  deploy/production-alerts.sh [--execute]
# What it watches (each has a runbook line in docs/runbooks/production-bringup.md, "Alerts"):
#   errors      any ERROR log line from the API in 5 minutes
#   call_fail   calls that did not start or did not finish cleanly: plivo_signature_failed, plivo_outbound place_failed, phone_call_finish_failed, phone_call_row_failed, phone_call_heartbeat_failed
#   latency     the caller waits: p95 of `to_first_sound_ms` (the log line `phone_turn`, ms from the end of the caller's turn to the first sound) above 3000 ms over 10 minutes
#   datalayer   more than 5 data-layer timeouts (ReadTimeout) in a minute; breaker = the page breaker opened (Phase 1 of docs/plans/call-capacity-and-instances.md); concurrency = more than 30 requests at once for 2 minutes
#   instance    the API has no running instance (min-instances 1 must always show one)
# SPEND is not here: budgets are separate (deploy/budget-alerts.sh, per month, 50/90/100 %), and the model/voice providers have their own caps (see the runbook).
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE="${PROD_ENV_FILE:-deploy/.env.production}"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 2; }
set -a; . "$ENV_FILE"; set +a
: "${PROD_PROJECT_ID:?}" "${ALERT_EMAIL:?set ALERT_EMAIL}"
[ "$PROD_PROJECT_ID" != "project-2757c07e-37d2-4167-88f" ] || { echo "REFUSED: that is the STAGING project" >&2; exit 2; }
P="$PROD_PROJECT_ID"; execute=false; [ "${1:-}" = "--execute" ] && execute=true
run() { printf '+'; printf ' %q' "$@"; printf '\n'; if $execute; then "$@"; fi; }
SVC='resource.type="cloud_run_revision" AND resource.labels.service_name="sme-api"'

run gcloud logging metrics create sme_api_errors --project "$P" --description "ERROR lines of the API" --log-filter "$SVC AND severity>=ERROR"
run gcloud logging metrics create sme_call_failures --project "$P" --description "calls that did not start or finish cleanly" \
  --log-filter "$SVC AND (jsonPayload.msg:\"plivo_signature_failed\" OR jsonPayload.msg:\"plivo_outbound place_failed\" OR jsonPayload.msg:\"phone_call_finish_failed\" OR jsonPayload.msg:\"phone_call_row_failed\" OR jsonPayload.msg:\"phone_call_heartbeat_failed\")"
cat > /tmp/sme_turn_latency.yaml <<'YAML'
name: sme_turn_latency_ms
description: ms from the end of the caller's turn to the first sound (phone_turn log line)
filter: resource.type="cloud_run_revision" AND resource.labels.service_name="sme-api" AND jsonPayload.msg:"phone_turn n="
valueExtractor: REGEXP_EXTRACT(jsonPayload.msg, "to_first_sound_ms=(\\d+)")
metricDescriptor:
  metricKind: DELTA
  valueType: DISTRIBUTION
  unit: ms
bucketOptions:
  explicitBuckets:
    bounds: [250, 500, 750, 1000, 1500, 2000, 3000, 5000, 8000]
YAML
run gcloud logging metrics create sme_turn_latency_ms --project "$P" --config-from-file /tmp/sme_turn_latency.yaml

run gcloud logging metrics create sme_data_layer_timeouts --project "$P" --description "the data layer (Supabase) did not answer in time" \
  --log-filter "$SVC AND (jsonPayload.msg:\"unreachable: ReadTimeout\" OR jsonPayload.msg:\"unreachable: ConnectTimeout\")"
run gcloud logging metrics create sme_admission_breaker --project "$P" --description "page reads were refused because the data layer failed (docs/plans/call-capacity-and-instances.md)" \
  --log-filter "$SVC AND jsonPayload.msg:\"admission breaker open\""
run gcloud beta monitoring channels create --project "$P" --display-name "Stack19 alerts" --type email --channel-labels "email_address=$ALERT_EMAIL"
CH='$(gcloud beta monitoring channels list --project '"$P"' --filter="displayName=\"Stack19 alerts\"" --format="value(name)" | head -1)'
policy() {  # name, display, condition json file body
  printf '%s\n' "$3" > "/tmp/policy_$1.json"
  run gcloud alpha monitoring policies create --project "$P" --policy-from-file "/tmp/policy_$1.json" --notification-channels "$(eval echo "$CH")"
}
policy errors errors '{"displayName":"API errors","combiner":"OR","conditions":[{"displayName":"ERROR lines in 5 minutes","conditionThreshold":{"filter":"metric.type=\"logging.googleapis.com/user/sme_api_errors\" AND resource.type=\"cloud_run_revision\"","comparison":"COMPARISON_GT","thresholdValue":0,"duration":"0s","aggregations":[{"alignmentPeriod":"300s","perSeriesAligner":"ALIGN_SUM"}]}}]}'
policy call_fail call_fail '{"displayName":"Call failures","combiner":"OR","conditions":[{"displayName":"a call failed to start or finish","conditionThreshold":{"filter":"metric.type=\"logging.googleapis.com/user/sme_call_failures\" AND resource.type=\"cloud_run_revision\"","comparison":"COMPARISON_GT","thresholdValue":0,"duration":"0s","aggregations":[{"alignmentPeriod":"300s","perSeriesAligner":"ALIGN_SUM"}]}}]}'
policy latency latency '{"displayName":"Callers wait too long","combiner":"OR","conditions":[{"displayName":"p95 first sound above 3 s for 10 min","conditionThreshold":{"filter":"metric.type=\"logging.googleapis.com/user/sme_turn_latency_ms\" AND resource.type=\"cloud_run_revision\"","comparison":"COMPARISON_GT","thresholdValue":3000,"duration":"600s","aggregations":[{"alignmentPeriod":"600s","perSeriesAligner":"ALIGN_PERCENTILE_95"}]}}]}'
policy instance instance '{"displayName":"API has no running instance","combiner":"OR","conditions":[{"displayName":"instance count 0","conditionAbsent":{"filter":"metric.type=\"run.googleapis.com/container/instance_count\" AND resource.type=\"cloud_run_revision\" AND resource.label.service_name=\"sme-api\"","duration":"300s","aggregations":[{"alignmentPeriod":"60s","perSeriesAligner":"ALIGN_MAX"}]}}]}'
policy datalayer datalayer '{"displayName":"Data layer timeouts","combiner":"OR","conditions":[{"displayName":"more than 5 data-layer timeouts in a minute","conditionThreshold":{"filter":"metric.type=\"logging.googleapis.com/user/sme_data_layer_timeouts\" AND resource.type=\"cloud_run_revision\"","comparison":"COMPARISON_GT","thresholdValue":5,"duration":"0s","aggregations":[{"alignmentPeriod":"60s","perSeriesAligner":"ALIGN_SUM"}]}}]}'
policy breaker breaker '{"displayName":"Page reads refused (breaker open)","combiner":"OR","conditions":[{"displayName":"the page breaker opened","conditionThreshold":{"filter":"metric.type=\"logging.googleapis.com/user/sme_admission_breaker\" AND resource.type=\"cloud_run_revision\"","comparison":"COMPARISON_GT","thresholdValue":0,"duration":"0s","aggregations":[{"alignmentPeriod":"300s","perSeriesAligner":"ALIGN_SUM"}]}}]}'
policy concurrency concurrency '{"displayName":"API near its request limit","combiner":"OR","conditions":[{"displayName":"more than 30 requests at once for 2 minutes (the limit is 80)","conditionThreshold":{"filter":"metric.type=\"run.googleapis.com/container/max_request_concurrencies\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"sme-api\"","comparison":"COMPARISON_GT","thresholdValue":30,"duration":"120s","aggregations":[{"alignmentPeriod":"60s","perSeriesAligner":"ALIGN_PERCENTILE_99"}]}}]}'
echo "$($execute && echo EXECUTED || echo 'DRY RUN: nothing was created')"
