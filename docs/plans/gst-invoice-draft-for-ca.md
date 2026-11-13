# GST invoice format — DRAFT for the CA (13 Nov 2026)

Status: **draft, not tax advice, nothing here is approved.** Staging only (Razorpay TEST, no real money). The owner shows this page to the CA; the CA's answers decide the final format. Until then no production invoice is issued.

## What an invoice contains TODAY (built, `pricing.invoices`)

| Field | Today |
|---|---|
| Invoice number | `S19-<year>-<6 digits>`, e.g. `S19-2026-000001`. One database sequence for the whole company, never reset; the year is the **calendar** year in Asia/Kolkata at issue time. |
| Kind | `subscription` (a plan charge), `topup` (money added to the balance), `payg_fee` (the ₹499 pay-as-you-go fee) |
| Payment reference | the payment provider's id (opaque), unique per workspace and kind: the same payment twice makes one invoice |
| Taxable value (subtotal) | in paise, shown in ₹ |
| GST | **one amount**, 18% of the subtotal, rounded half-up to the paisa (a single `gst_bps` setting, 1800) |
| Total | subtotal + GST (checked by the database) |
| Issue date/time | `issued_at` |
| Customer | the workspace (tenant id); the app shows the business name |

The app lists these at `GET /billing/gst-invoices` (Owner, Admin): number, kind, subtotal, GST, total, date, all as ₹ text. There is **no PDF** yet.

## What it does NOT contain yet (needs the CA's answer first)

| Item the owner asked about | State | Question for the CA |
|---|---|---|
| Our GSTIN, legal name, address | not stored | Owner supplies; stored as a company setting, printed on every invoice. |
| Customer GSTIN (if given) | not stored | Collect optionally in Settings, with the customer's legal name and billing address? B2B customers need it to claim input credit. |
| SAC code | not stored | Which SAC applies to the software/online service and to the call minutes? One code for all three kinds, or different? |
| CGST + SGST vs IGST | **not split**: one GST line at 18% | Plan: if our state equals the place of supply, 9% CGST + 9% SGST; otherwise 18% IGST. Needs our state code and the customer's state. |
| Place of supply | not stored | Customer's billing state (from the GSTIN's first two digits when given, otherwise the address the customer enters). B2C and unregistered customers: rule to apply? |
| Invoice date vs time of supply | `issued_at` = payment time | For a **top-up** (prepaid balance used later): invoice at payment (advance) or when minutes are used? Today it is at payment. |
| Series | one global running series, calendar year in the text | GST wants consecutive numbers within a **financial year** (April–March), at most 16 characters. Switch the year part to the FY (`S19-2026-27-000001` is 18 characters, so `S19/2627/000001`)? |
| Credit notes | not built | A downgrade today moves the unused part of the old plan to the balance. Does that need a credit note and a fresh invoice? |
| Refunds, failed/cancelled payments | no invoice (nothing was settled) | Confirm. |
| Round-off / rate | 18% only | Any item at a different rate (WhatsApp at Meta's cost, passed on without markup)? Is that a pure-agent pass-through or a supply by us? |
| TDS / e-invoicing | not handled | Is e-invoicing (IRN) needed at our turnover? |

## Known defect to fix before production

The invoice number is taken from the sequence **before** the "same payment twice" check, so a repeated provider event can use up a number and leave a **gap** in the series. Harmless on staging (test mode); to be fixed in a small migration (look the invoice up first, take the number only when inserting) before any real invoice, and covered by a pgTAP test.

## Draft layout of the invoice (proposal, for the CA to mark up)

```
TAX INVOICE                                     No: S19/2627/000001   Date: 13-11-2026
From: <legal name>, <address>, GSTIN <ours>, State <name> (<code>)
To:   <business name>, <billing address>, GSTIN <customer's, if given>, State <name> (<code>)
Place of supply: <state>
Item                         SAC     Taxable value    CGST 9%   SGST 9%   IGST 18%
Sales Assistant, Nov 2026    <SAC>      ₹1,999.00      ₹179.91   ₹179.91      -
Total in words, amount payable ₹2,358.82
Paid by Razorpay payment <id>
```

Only one of (CGST+SGST) or IGST is filled. Amounts in ₹; the word "credits" never appears.
