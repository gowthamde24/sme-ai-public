# Google Calendar 2-way sync: the contract for the web (C2)

Appointment booking slice 4 (`docs/plans/appointment-booking.md`). Built by C1 behind a **fake Google**: until the owner creates the OAuth client, staging answers `configured: false` and every other route `409 not_configured`. The code: `services/ai-api/app/google_calendar/`, migration `20261231800000_google_calendar.sql`, pgTAP 206, `tests/test_google_calendar.py`.

## What it does

- **Connect** (the Owner, with the second factor when they turned it on): the browser goes to Google's consent screen and comes back to the settings page. Two permissions only: `calendar.events` (write our appointments) and `calendar.freebusy` (see busy times; no titles). v1 uses the Owner's **primary** calendar (no calendar picker).
- **Write events** (`write_events`, on by default): every appointment is copied to that calendar as "Appointment: Priya S." (first name + last initial; "Appointment" once the person is erased), India time, with only the purpose and the party size in the description (never a phone number or an e-mail address). A reschedule moves the event; a cancel deletes it; a completed or no-show appointment stays as it is. Only events we made are ever changed.
- **Block busy** (`block_busy`, off by default): the busy times of that calendar for the next 60 days (refreshed every 30 minutes, and within about a minute after Google tells us something changed) stop customers from booking those times. Our own appointments do not count as busy.
- **Sync now**: the worker does both within about a minute.
- **Disconnect** (the Owner): the permission is withdrawn at Google, our copy of the token and every busy time are deleted. **Events already written stay in their calendar** (they are the Owner's).
- A workspace erasure disconnects it the same way (on the worker's next tick).

## Routes

All under `/v1/tenants/{tenant_id}/integrations/google-calendar`, signed in. Errors have the one error shape (`{"error": {"code", "message", ...}}`); the codes are in `docs/contracts/error-codes.md`.

| Method | Path | Who | Body | Answer |
|---|---|---|---|---|
| GET | `/status` | any member | | `Status` (below). Without the OAuth client: `configured: false`, `status: "not_connected"` |
| POST | `/connect` | Owner (second factor: `mfa_required` 403 when they turned it on and did not enter the code) | none | `{"authorize_url": "https://accounts.google.com/o/oauth2/v2/auth?...", "expires_at": "<ISO>"}`: send the browser there (a full-page navigation, not a fetch). It is good for 10 minutes and once |
| PUT | `/settings` | Owner | `{"write_events": bool, "block_busy": bool}` (both required, nothing else) | `Status` |
| POST | `/sync-now` | Owner, Admin | none | `Status` + `"requested": true` |
| POST | `/disconnect` | Owner | none | `Status` (now `not_connected`) + `"disconnected": true, "events_kept": true` |

`Status`:

```json
{
  "configured": true,
  "connected": true,
  "status": "connected",            // connected | needs_reconnect | not_connected
  "google_email": "owner@gmail.com", // null until the first appointment is written (Google names the organizer then)
  "calendar_id": "primary",          // always "primary" in v1; null when not connected
  "calendar_name": null,             // unused in v1 (show "Primary calendar")
  "write_events": true,
  "block_busy": false,
  "last_synced_at": "2026-11-14T10:00:00+00:00",   // the "last synced" indicator; null until the first sync
  "last_error_code": null            // a closed word, see below
}
```

`needs_reconnect`: Google no longer accepts the permission (the Owner removed access in their Google account, or changed the password). Nothing syncs until the Owner presses Connect again; the old busy times stay so no double booking happens meanwhile. Show "Connect again".

`last_error_code` (show a plain sentence; the sync keeps retrying on its own unless `needs_reconnect`): `revoked`, `secret_missing`, `unavailable` (Google did not answer), `rate_limited`, `forbidden`, `not_found`, `not_ours` (an event with our id was not made by us; we left it alone), `bad_response`, `bad_visit`, `no_public_address`, `conflict`.

### The browser's return

Google sends the browser to the API's public `GET /v1/integrations/google-calendar/callback`; the API answers `303` to:

`{web}/app/tenants/{tenant_id}/integrations/google-calendar?google_calendar=<result>`

| `result` | Meaning | Show |
|---|---|---|
| `connected` | done | "Google Calendar is connected." then read `/status` |
| `denied` | the Owner pressed Cancel on Google's screen | "Not connected. You can try again." |
| `missing_scope` | the Owner unticked one of the two permissions (nothing was kept) | "Both permissions are needed to sync appointments." |
| `expired` | the 10 minutes passed, the link was used twice, or the person is no longer the Owner | "That took too long. Press Connect again." |
| `error` | Google or our side failed | "Something went wrong. Try again in a moment." |
| `invalid` | a link that is not ours: lands on `{web}/app?google_calendar=invalid` (no workspace) | nothing, or a neutral notice |

The page `/app/tenants/{tenant_id}/integrations/google-calendar` is C2's to build (Settings > Integrations > Google Calendar): status, Connect / Connect again, the two switches, Sync now, Disconnect (with "Events already in your calendar stay there"), the last-synced line.

## Error codes

| Code | Status | When |
|---|---|---|
| `not_configured` | 409 | the OAuth client is not set on this system (every route but `/status`) |
| `google_calendar_not_connected` | 409 | settings, sync-now or disconnect without a connection |
| `google_calendar_try_later` | 429 | more than five connects in ten minutes (`Retry-After: 600`) |
| `google_calendar_needs_reconnect` | 409 | Google refused the permission while answering this request |
| `google_calendar_unavailable` | 502 | Google did not answer |
| `google_calendar_secret_unavailable` | 503 | the key store did not answer (disconnect: nothing was deleted, try again) |
| `mfa_required` | 403 | connect: enter the authenticator code first |

## For the slot function (the engine slice)

`app.calendar_busy_overlaps(p_tenant uuid, p_from timestamptz, p_to timestamptz) returns boolean`: true when a busy block of that business overlaps `[p_from, p_to)`. Stable, SECURITY DEFINER, search path empty, callable by definer functions only (not granted to any client role), an index range lookup on `public.calendar_busy (tenant_id, starts_at, ends_at)`. A business without "block busy" has no rows, so it is always false.

## Public doors (for completeness; not called by the web)

- `GET /v1/integrations/google-calendar/callback`: the OAuth redirect URI (`<PUBLIC_BASE_URL>/v1/integrations/google-calendar/callback`). The `state` is HMAC-signed (tenant, member, nonce, 10 minutes) and used once; PKCE (S256) with a verifier nobody stores.
- `POST /v1/integrations/google-calendar/push`: Google's push notification (`events.watch`, renewed a day before it expires, 7 days). Always `200`. The channel token (random per link, in Secret Manager with the refresh token) and the resource id are compared in constant time; `X-Goog-Resource-State: sync` is acknowledged and ignored; a verified one asks the worker for a busy-times refresh (at most once a minute).

## Tokens

The refresh token and the channel token are only in Secret Manager (`sme-ws-<workspace>-google_calendar`, the workspace-secrets mechanism, kind `google_calendar`). The database holds where the secret is and a fingerprint; no table, log line or answer ever holds a token.
