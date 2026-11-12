# Sourced by deploy/staging.sh and deploy/production.sh (not run on its own). The API is deployed WITHOUT traffic, checked, and only then given the traffic (12 Nov 2026; owner's rule).
#
#   guard_before PROJECT REGION     the settings of the revision that serves traffic are saved in FLAGS_BEFORE (empty when the service does not exist yet: its first revision has no earlier one to compare with,
#                                   and Cloud Run does not allow --no-traffic for it; cloudrun.sh then deploys it the normal way). Stops with exit 1 when the service exists but cannot be read.
#   guard_after PROJECT REGION      compares the NEWEST revision with FLAGS_BEFORE (every difference not named in ALLOW_FLAG_CHANGE stops the script with exit 3 and the new revision gets NO traffic: the old one keeps
#                                   serving) and then moves 100 % of the traffic to it.
#
# Why: `gcloud run deploy --set-env-vars` replaces the WHOLE environment, and the old check ran after the new revision already had all the traffic (staging, 12 Nov 2026: 22 telephony settings and the warm instance
# were lost for five minutes). cloudrun.sh now only ever UPDATES settings; this is the second fence.
guard_before() {
  FLAGS_BEFORE=""
  if gcloud run services describe sme-api --project "$1" --region "$2" >/dev/null 2>&1; then
    FLAGS_BEFORE="$(mktemp)"
    python3 deploy/flag_guard.py snapshot "$1" "$2" sme-api "$FLAGS_BEFORE" 2>/dev/null || { echo "could not read the live API settings (gcloud); the flag check needs them" >&2; exit 1; }
  fi
}

guard_after() {
  [ -n "${FLAGS_BEFORE:-}" ] || return 0
  local new
  new="$(python3 deploy/flag_guard.py created "$1" "$2" sme-api)" || { echo "could not read the new revision" >&2; exit 1; }
  python3 deploy/flag_guard.py compare "$1" "$2" sme-api "$FLAGS_BEFORE" --revision "$new" --allow "${ALLOW_FLAG_CHANGE:-}" || {
    echo "STOP: revision $new was created WITHOUT traffic and gets none; the old revision keeps serving. Fix the cause (a setting the script did not carry over: set it with gcloud run services update sme-api --update-env-vars NAME=VALUE --no-traffic, or name the change in ALLOW_FLAG_CHANGE if it was meant) and deploy again." >&2
    exit 3
  }
  gcloud run services update-traffic sme-api --project "$1" --region "$2" --to-revisions "$new=100"
}
