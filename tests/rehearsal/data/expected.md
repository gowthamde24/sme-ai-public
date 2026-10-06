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
* Q1 -> order A: the happy path to `closed_paid`: advance 25,200 then balance 25,200.
* Q2 -> order B: declined (reason `price`); then a new quote for the same requirement and a new order (declined then re-quoted).
* Q3 -> order C: cancelled with no money in it (Admin).
* Q4 -> order D: in preparation (advance 30,975 paid); an Owner dispatch override on an order whose advance is unpaid is rehearsed on Q5 -> order E.
* Q5 -> order E: advance unpaid, an Owner dispatch with the override; then paid in full.
* Q6 -> order F: advance 8,820 paid, then a refund of 1,000 by the Owner (Admin refused).

## Import (leads.csv, header is line 1)
| Line | Company | What it tests | Expected |
| --- | --- | --- | --- |
| 4, 5 | Meenakshi Weaves twice (case, spacing, same number) | a duplicate | the second is merged or flagged as a duplicate, not a second lead |
| 6 | Padma Textiles | a malformed e-mail | arrives without an e-mail, flagged for the reason |
| 8 | (blank name) | a missing company | rejected by the adapter (`company_name_missing`) before the API |
| 10, 11 | Godavari Silks, Krishna Sarees | one phone number shared by two people | both imported; the number is a shared key |
| 13 | Sabarmati Cloth | a number already opted out (setup.json) | imported, flagged `opted_out` |
| 14 | Yamuna Weavers | a number of an erased person, written in another format | imported, flagged `legal` |
| all others | | clean | imported |
