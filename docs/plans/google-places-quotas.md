# Google Maps (Places API New): free caps, daily quotas, usage and alerts

Status: **PROPOSAL, numbers updated by the owner's decision of 14 Nov 2026 (Place Details 230 a day = 7,000 / 30, the Enterprise free cap; Text Search 1,000 a day; one Enterprise request per search; the app-side monthly gate stays the main protection). APPLIED 14 Nov 2026 10:54 UTC on the owner's OK: step A (enable) ran; B1 and B2 (both 230 a day) were first refused by Google's safety check (COMMON_QUOTA_UNSAFE_OVERRIDE: a cut of more than 10 percent) and then applied with the query parameter `?force=true` on the owner's OK. Result: GetPlaceRequest 1/d 230 override, SearchTextRequest 1/d 230 override. No API key exists yet (the owner says when).** Owner decision (14 Nov 2026): startup credits declined; we live on the free monthly caps (India billing: 70,000 Essentials, 35,000 Pro, 7,000 Enterprise requests per SKU per month); daily quotas start generous at **1,000 Place Details per day and 3,000 Text Search per day**; alert at 80 percent of a monthly cap; raise any time on request; "show me the exact quota change and its output before and after you apply it".

## 1. What is built in the code (staging, no Google Cloud change needed)

| Piece | Where |
|---|---|
| Every real Google request is a line in the usage ledger, per SKU (`search_ids`, `search_pro`, `search_enterprise`, `details_pro`, `details_enterprise`; one unit = one request) | `ops.provider_usage`, written by Lead Finder (`app/lead_finder/service.py`) |
| The free monthly cap and the alert percentage (80) of each SKU | `ops.google_caps` (operator data; one row to raise) |
| **Fail-closed monthly gate**: before each billed Google request the API asks `ops_google_budget`; at the cap, or if the check cannot be answered, the request is NOT made (a search finishes as failed with `monthly_cap`; details show "unavailable") | `app/ops/usage.py` `google_allowed` |
| Usage line per SKU in the staff console | `GET /v1/admin/usage/google` (owner, finance) and `GET /v1/admin/usage?from&to` (per provider and per business, margin) |
| Alert at 80 percent (and at 100) of a monthly cap: one per SKU per month, shown in the console and e-mailed to the owner account(s) | `GET /v1/admin/alerts`, `POST /v1/admin/alerts/{id}/ack`; worker pass `app/ops/alerts.py` |
| Only `place_id` (and coordinates) are stored; everything else is fetched fresh | unchanged (route 1, ADR 0119) |

The month is the calendar month in UTC (Google's free usage resets on the 1st).

## 2. State BEFORE (read-only, 14 Nov 2026, project `project-2757c07e-37d2-4167-88f`)

* `places.googleapis.com` is **not enabled** in the project and there is **no API key**: staging runs the mock source (no network, no cost).
* Default quotas of the service (queried with `serviceusage v1beta1 consumerQuotaMetrics`, no override set anywhere):

```
GetPlaceRequest     1/d/{project}  125000   default      (Place Details)
SearchTextRequest   1/d/{project}   75000   default
GetPlaceRequest     1/min/{project}   600   default
SearchTextRequest   1/min/{project}   600   default
```

## 3. The exact change I propose (NOT applied; needs your explicit OK on exactly this)

Three steps, each one command. `P=project-2757c07e-37d2-4167-88f`, `T=$(gcloud auth print-access-token)`.

**Step A, enable the API** (no cost by itself; billing account is already linked):
```
gcloud services enable places.googleapis.com --project $P
```
**Step B, set the two daily limits** (limit names as the API prints them: `%2Fd%2Fproject` is the per-day-per-project limit):
```
curl -sS -X POST -H "Authorization: Bearer $T" -H "x-goog-user-project: $P" -H "Content-Type: application/json" \
  -d '{"overrideValue":"230"}' \
  "https://serviceusage.googleapis.com/v1beta1/projects/$P/services/places.googleapis.com/consumerQuotaMetrics/places.googleapis.com%2FGetPlaceRequest/limits/%2Fd%2Fproject/consumerOverrides"

curl -sS -X POST -H "Authorization: Bearer $T" -H "x-goog-user-project: $P" -H "Content-Type: application/json" \
  -d '{"overrideValue":"1000"}' \
  "https://serviceusage.googleapis.com/v1beta1/projects/$P/services/places.googleapis.com/consumerQuotaMetrics/places.googleapis.com%2FSearchTextRequest/limits/%2Fd%2Fproject/consumerOverrides"
```
**Step C, key** (only when you want real Google data on staging): create an API key restricted to `places.googleapis.com` (and, after the first test, to the Cloud Run egress); it goes straight into Secret Manager as `google-places-api-key` and is never printed; then `LEAD_FINDER=places` with the real-data gate stays closed until you open it (ADR 0015).

**AFTER check** (same query as BEFORE; I show you the output):
```
curl -s -H "Authorization: Bearer $T" -H "x-goog-user-project: $P" \
  "https://serviceusage.googleapis.com/v1beta1/projects/$P/services/places.googleapis.com/consumerQuotaMetrics?view=BASIC"   # expect GetPlaceRequest 1/d/{project} 230 override, SearchTextRequest 1/d/{project} 1000 override
```
**Undo / raise** (any time): `DELETE` the override (name returned by the POST), or POST a new `overrideValue`.

## 4. Two things you need to know before you say yes

1. **A daily quota cannot hold a monthly cap.** 1,000 Details a day is up to 30,000 a month; the free Enterprise cap is 7,000 a month (Text Search 3,000 a day is up to 90,000 against 70,000 Essentials / 7,000 Enterprise). The daily limits are a backstop against a runaway loop, not the monthly guard. The monthly guard is the one in section 1 (counted by us, fail-closed, alert at 80 percent). If you want the daily limits to match the monthly caps, the numbers are about **230 a day** for each Enterprise SKU (7,000 / 30).
2. **IDs-only Text Search + Place Details per place multiplies Enterprise requests.** One Text Search with the fields we show today (phone, website) is ONE Enterprise request for up to 20 places. Discovery with IDs only (Essentials, 70,000 a month) returns only place IDs; to decide "call or not" we then need phone and website per place: 20 Place Details (Enterprise) per search, against a 7,000 a month cap, which is about **350 searches a month** (about 11 a day) before the cap stops us. Today's behaviour (one Enterprise Text Search per search, 7,000 searches a month, details fetched fresh only for the prospects shown) is far cheaper. I have kept today's field mask and metered it as `search_enterprise`; switching to IDs-only is a one-line change (`FIELD_MASK`) when you decide, and the ledger and the gate already know the Essentials unit.

## 5. Recommendation

Apply steps A and B as you chose (1,000 and 3,000), because the monthly gate and the 80 percent alert are what protect the free caps; do not do step C until you want to test with real Google data. If you prefer belt and braces, set the two daily limits to 250 instead of 1,000 and 3,000; raising them later is one command.
