# Runbook: the saree catalogue on the local stack (job AY, ADR 0069)

> **Which local stack (job BG, [two-local-stacks.md](two-local-stacks.md)).** The make targets and scripts here default to the AGENT stack (`make agent-db-up`; your own API on 8001, web on 3001). The owner runs the same steps on the demo stack with `STACK=owner` (Supabase 54321/54322, API 8000, web 3000). Where this page names `make db-start`, `supabase_db_sme-ai` or port `54322`, that is the owner's stack; the agent stack is `make agent-db-up`, `supabase_db_sme-ai-agent` and `54422`.

Everything here is local and synthetic. **Nothing is ever sent to anyone** (the only channel is a stand-in inside the API process) and **no real product photo exists**: the demo pictures are drawn by a script.

## Turn Storage on (once)
The catalogue keeps photos in the LOCAL Supabase Storage service, which `supabase/config.toml` now enables. A stack that was started before this change needs one restart so the Storage container exists:
```
supabase stop        # keeps your data
supabase start       # pulls the Storage image once
```
(`make db-stop` / `make db-start` do the same.) Your demo data survives; a `make db-reset` wipes the database rows, not the files in the Storage volume.

## Try it
```
make dev-api-local API_PORT=8001     # ports 3000 and 8000 are the owner's demo
make seed-demo-manual                # once: the DEMO business (SEED_API_URL=http://localhost:8001 for your own API)
make seed-demo-catalogue             # twelve invented sarees with generated placeholder pictures
```
Then as the demo owner: `GET /v1/tenants/{id}/catalogue/items` (the list, with a cover photo and signed URLs), `GET .../catalogue/items/{item}`, `PUT .../catalogue/items/{item}`, `POST .../catalogue/items/{item}/photos` (raw body), `POST .../catalogue/photos/{photo}/remove`, `PUT .../catalogue/items/{item}/photos/order`.

## Upload a photo by hand
```
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: image/jpeg" --data-binary @photo.jpg \
  "http://localhost:8001/v1/tenants/$TENANT/catalogue/items/$ITEM/photos?photo_id=$(uuidgen | tr A-Z a-z)"
```
The server decodes it, applies the camera's orientation, **drops EXIF and GPS data**, resizes it (at most 1280 px) and makes a 320 px thumbnail. JPEG, PNG or WebP, at most 5 MB, not animated; a business holds at most 8 photos per item. Retrying with the same `photo_id` is safe.

## What the rules are
| | |
|---|---|
| Who reads | every member of the business (signed URLs, 10 minutes) |
| Who writes | Owner and Admin; the EXACT price: the Owner only, with a second factor |
| Active | an item is active only with a photo; the last photo of an active item cannot be removed |
| The agent | `find_catalogue_items` (reads) and `send_catalogue_items` (queues ONE WhatsApp message with up to 4 cover photos and a caption through the outbox). A price band or an amount in the caption waits for the Owner; photos without a price go by themselves only if automatic sending is on |
| The channel | the local fake records the photos by reference (bucket, path, type); nothing leaves this machine |

## When something looks wrong
| You see | Meaning |
|---|---|
| `POST …/photos` answers 503 or "storage refused the upload" | Storage is not running: `docker ps` shows no `supabase_storage_…`. Restart the stack as above. |
| `409 photo_files_missing` | the two files did not reach storage; upload again |
| `409 too_many_photos` | the item has 8 photos; remove one |
| `409 needs_photo` | an active item needs a photo, or you tried to remove its last one |
| `415`/`413`/`422 photo_*` | not a jpeg/png/webp, over 5 MB, unreadable, too many pixels, or animated |
| a photo URL stops working | it expired (10 minutes): read the item again |
| `make seed-demo-catalogue` fails at the upload | the API is older than the change, or Storage is off |
