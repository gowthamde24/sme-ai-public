# Extra lines: more "calls at once" for a workspace (26 Nov 2026)

Switch: API `EXTRA_LINES` (off) and the database switch `ops.line_settings.enabled` (off; `app.operator_set_extra_lines`); web `EXTRA_LINES` (off, `mock` on staging). Migration `20261231992500_extra_lines.sql`.

## The rule
- A workspace's lines = **2 for each phone number** it has + the **extra lines** it bought that are working. "Calls at once" is that number: the gate refuses a new call beyond it (see `calls.md`, "Calls at once").
- An extra line costs **Rs 149 a month** (`ops.line_settings.price_paise`, 14900), taken from the credits wallet when it is bought and again every month. Our cost at VoiceLink is about Rs 99 a channel. GST was already added when the credits were bought: nothing more is taken.
- At most **20 lines** in a workspace (`ops.line_settings.default_cap`); Stack19 changes one workspace's limit with `app.operator_set_line_cap(tenant, max)`. The included lines of a number (1 for a number bought from 26 Nov 2026, `phone_numbers.included_lines`; 2 for an older one) are not rows: they cannot be cancelled.
- Only the **Owner** adds or cancels (with the second factor when the Owner has turned it on). Owner and Admin read.
- A workspace that is not billed (`tenants.billing_exempt`: Customer Zero, demos) pays nothing.

## Routes (404 when `EXTRA_LINES` is off)
| | | |
|---|---|---|
| `GET /v1/tenants/{t}/extra-lines` | Owner, Admin | `{enabled, price_rupees, cap, numbers, included, total, can_add, extra: [{id, status, working, paid_until, cancel_at_period_end, grace_until}]}` |
| `POST /v1/tenants/{t}/extra-lines` | Owner | `{key}` (one per press; the same key twice is the same line) -> `201` the line, paid and working |
| `POST /v1/tenants/{t}/extra-lines/{id}/cancel` | Owner | works to the end of the paid month; `keep` takes it back |

Refusals are `409 lines_unavailable` with `reason`: `paused` (the platform switch), `at_limit`, `no_number`, `not_enough_credits` ("There are not enough credits for a line. Add credits first."), `unavailable` (the channel could not be bought: the credits were given back); `404 not_found` for a line that is not there.

## How it works
1. `extra_line_buy` (one database transaction): every rule, the wallet charge (`pricing.spend`; a `usage` row of kind `line`, shown in the statement as "Extra calls at once line"), the row. Not enough credits rolls everything back.
2. The API then asks the **channel port** to buy the channel. Providers: `FakeChannels` (staging and tests: nothing bought, nobody called) and `VoicelinkChannels`, a SKELETON behind `VOICELINK_CHANNEL_BUY` (off): it does the read-only wallet check and stops at `not_built`. In production with the fake provider the team gets a Needs-you item to buy the channel by hand.
3. `extra_line_channel_result`: bought -> the line counts; failed -> the line ends and the first month goes back to the credits.
4. The worker pass `extra_lines_renew` (every tick, idempotent): a line due is renewed (one charge per line per month); with too few credits it gets **3 days of grace** (still works, the Owner has a "Needs you" item that opens Credits), then **pauses** (does not count), and resumes by itself when credits are added; paused for 30 days it ends. A cancelled line ends at the end of the paid month. The pass also retries a paid line whose channel was not bought and gives back the channel of an ended line.

## Not built (say so)
VoiceLink's real channel purchase and give-back (no endpoint in the API text we hold); an admin-console screen for the price and a workspace's limit (the two operator functions are the way); the Plivo and Exotel inbound paths do not read the workspace's lines (VoiceLink is the provider).
