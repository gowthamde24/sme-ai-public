# Expected figures, worked out by hand (SYNTHETIC)

Price list (seed): every item MOQ 4, tax 5% exclusive (500 bps), one break at 10 pieces.
Kanjivaram: 4,200 each, 4,000 from 10. Banarasi: 3,100 each, 2,950 from 10. Paithani: 2,800 each, 2,650 from 10.
Policy (seed): no discount (ceiling 0), no shipping, new customer advance 50%, repeat customer advance 25%, valid 15 days, delivery state required.
Amounts below are rupees; `expected.json` holds the same in paise.

| Quote | Lines | Subtotal | Tax 5% | Total | Advance | Who approves |
| --- | --- | --- | --- | --- | --- | --- |
| Q1 | 12 Kanjivaram red at 4,000 (break, 12 >= 10) | 48,000 | 2,400 | 50,400 | 50% = 25,200 | Owner or Admin |
| Q2 | 6 Banarasi red at 3,100 | 18,600 | 930 | 19,530 | 50% = 9,765 | Owner or Admin |
| Q3 | 5 Kanjivaram blue at 4,200 | 21,000 | 1,050 | 22,050 | 50% = 11,025 | Owner or Admin |
| Q4 | 20 Banarasi gold at 2,950 (break) | 59,000 | 2,950 | 61,950 | 50% = 30,975 | Owner or Admin |
| Q5 | 4 Kanjivaram red at 4,200 = 16,800; 10 Paithani green at 2,650 = 26,500 | 43,300 | 2,165 | 45,465 | 50% = 22,732.50 | Owner or Admin |
| Q6 | 8 Kanjivaram blue at 4,200 (repeat customer) | 33,600 | 1,680 | 35,280 | 25% = 8,820 | **Owner only** (a repeat-customer claim always needs the Owner) |

Enquiries E7 (no sarees asked) and E8 (quantity not decided) stop before a quote on purpose.

## Orders
Six orders and one new policy version. Money is the person's claim; payments are recorded by an Admin (or the Owner), refunds and cancellations that carry money by the Owner.
| Order | Quote | Path | Ends | Paid / balance (rupees) |
| --- | --- | --- | --- | --- |
| A | Q1 | sent, accepted, advance requested, advance 25,200, preparation, dispatch, delivered, balance 25,200 | closed_paid | 50,400 / 0 |
| B | Q2 | sent, customer declines (reason `price`) | declined (lost) | 0 / 19,530 |
| B2 | Q2b (Q2 again) | the same path as A, advance 9,765, balance 9,765 (needs B to be lost first) | closed_paid | 19,530 / 0 |
| C | Q3 | sent, then cancelled by an Admin (no money in it) | cancelled | 0 |
| D | Q4 | sent, accepted, advance requested, advance 30,975, preparation | in_preparation | 30,975 / 30,975 |
| E | Q5 | under a second policy (advance not required; dispatch needs it): accepted, preparation, dispatch refused for Sales and Admin (ADVANCE_NOT_PAID), the Owner dispatches with the override, delivered, paid 22,732.50 twice | closed_paid | 45,465 / 0 |
| F | Q6 | sent, accepted, advance requested, advance 8,820; an Admin's refund and cancellation refused (the Owner's); the Owner refunds 1,000 and cancels | cancelled | paid 8,820, refunded 1,000, net 7,820 |

## Import (leads.csv, header is line 1)
Worked out from the import rules (ADR 0010, `import_lead_rows`): a contact needs an e-mail on a reserved domain and a phone starting `+00`; a company is matched by website host, then by normalised name unless the cities differ; an open lead of the same company and contact is a duplicate; a contact is matched by e-mail, case-insensitive.
| Line | Company | What it tests | Expected |
| --- | --- | --- | --- |
| 5 | MEENAKSHI  WEAVES (line 4 again: case, spacing, same contact) | a duplicate | `skipped_duplicate` (`existing_open_lead`): no second company, contact or lead |
| 6 | Padma Textiles | a malformed e-mail | `rejected` (`contact_domain_not_reserved`): no company, contact or lead is left behind |
| 8 | (blank name) | a missing company | refused by the adapter (`company_name_missing`) before the API |
| 10, 11 | Godavari Silks, Krishna Sarees | one phone number shared by two people | both created; the number is a shared key |
| 13 | Sabarmati Cloth | a number already opted out (setup.json) | created, contact flagged `opted_out` |
| 14 | Yamuna Weavers | the number of an erased person, written another way | created, contact flagged `legal` |
| all others | | clean | created |
So: 20 lines, 1 refused by the adapter, 19 sent, 17 created (17 companies, 17 contacts), 1 duplicate, 1 rejected, 2 flagged.
