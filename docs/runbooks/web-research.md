# Runbook: web research tools (job BP, ADR 0078)

All four tools are **off** unless you switch a provider on. Nothing here opens an account, spends money by itself or stores a web result.

## Try the plumbing for free (no key, no network)
Development only, in the terminal that starts the API:

```
WEB_SEARCH_PROVIDER=fake PLACES_PROVIDER=fake METALS_PROVIDER=fake make dev-api-local API_PORT=8001
```
Then ask Agent OWL, for example: "search the web for silk saree demand", "find saree wholesalers in Guntur", "what is the gold rate today". The fakes return invented articles, invented shops and an invented price. For `read_page` with fixture pages add `WEB_FETCH=fake RESEARCH_FIXTURE_DIR=<a folder of fixture sites>`.

## Switch a real provider on (when you decide to)
Enter the key hidden, in the terminal that starts the API, never in a file. A provider named without its key stops the API at start.

| Tool | Environment | Notes |
|---|---|---|
| Search | `WEB_SEARCH_PROVIDER=tavily` + `TAVILY_API_KEY`, or `WEB_SEARCH_PROVIDER=brave` + `BRAVE_SEARCH_API_KEY` | Tavily: a free plan of 1,000 credits a month exists; one basic search is one credit. Brave: check that the plan you pick lets you use results the way this app does before switching it on. |
| Read a page | `WEB_FETCH=real` | The guarded fetcher of T007: robots.txt, no private addresses, size and time limits. Needs no key. |
| Find retailers | `PLACES_PROVIDER=google` + `GOOGLE_PLACES_API_KEY`, optional `PLACES_FIELD_TIER=pro` (default: names, addresses, map links) or `ids` (place ids only; the free tier; no names) | Google bills Pro-tier searches after a free monthly allowance. Set a budget alert on the Google project. |
| Gold and silver price | `METALS_PROVIDER=metals_dev` + `METALS_DEV_API_KEY` | Reference only. Cached 15 minutes in memory. |

## What the owner sees and what is limited
* Per question: 3 searches, 2 pages, 1 places search, 1 metal price.
* Per business per day: 30 searches, 60 pages, 10 places searches, 20 metal prices. Change them (operator only) with `update research.web_caps set per_day = ... where model = 'web-search'`.
* Every call is on the AI usage ledger (`agent_cost_reservations`, models `web-search`, `web-page`, `places-search`, `metal-price`), so the usual caps and the usage screen count it.
* `GET /v1/tenants/<tenant>/research/status` (Owner, Admin) shows what is switched on and today's use.

## What is never stored
* No web result is saved. The answer's text keeps one line "From the web: title (address)".
* From Google Places nothing is saved but the place ID, and only when the owner confirms a shop (`POST /places/confirm` with the name and city the owner typed).

## If something goes wrong
* "not available" in an answer: the provider is not switched on. "daily limit": see the table above. A provider error is shown as a closed note (`search_unauthorized`, `search_rate_limited`, `search_quota`, `search_timeout`, `search_unavailable`) and, when nothing was billed, the reservation is released.
* Switch a tool off by removing its environment variable and restarting the API.
