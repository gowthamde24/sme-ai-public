# Rehearsal data (SYNTHETIC)

**Every value in this folder is invented.** No person, business, e-mail address, phone number, price or tax rate here belongs to anyone real.

* E-mail addresses are on `example.com`, `example.org`, `example.net` or `example.test` (reserved names that cannot belong to anyone).
* Phone numbers use the invented prefix `+00 90000 1xxxx`; they are not taken from any real data and are not dialable.
* Names are one-letter initials with common surnames; company names are made up. A match to a real one is a coincidence.
* Prices and the tax rate are the SYNTHETIC seed values (`make seed-quote-data`), not the family's.

## Files
| File | What it is |
| --- | --- |
| `leads.csv` | 20 lead rows (header is line 1) with deliberate problems, see `expected.md` |
| `setup.json` | two contacts that exist BEFORE the import: one opted out, one erased, so two CSV rows meet a suppression |
| `enquiries.json` | 8 enquiry texts, the requirement lines a person would type, the product picks, the delivery state |
| `price_list.csv` | the seeded price list in the shape of the price-list CSV parser (used from rehearsal step 5) |
| `expected.md` | the expected import outcomes and every quote and order figure, **worked out by hand** (not computed by the engine) |

The driver reads `expected.md`'s figures from `expected.json` (the same numbers in machine form); the figures were written down by hand before the engine ever produced them.
