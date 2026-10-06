# Rehearsal click checklist (by hand, in the browser)

Purpose: count what it really costs a person to take an APPROVED quote to a closed order in the plain order screens, so the owner has a number to set against the family's current way. Nothing here is automated, and nothing here is real: every person, customer, price and amount is invented, on your own machine, and **this system sends nothing to anyone** (every order entry is a record of something that happened outside it).

## Before you start (once)

1. In a terminal, from the repository: `make db-reset` (a fresh local database), then `make rehearse-prepare-click`. It makes the workspace, the people, 17 leads, 9 enquiries and **7 approved quotes with no order** (one of them, Deccan Looms, is deliberately over its credit limit: leave it). It prints how to sign in as the Owner, an Admin, a Sales user and a Viewer.
2. Start the two servers the usual way: `make dev-api` and `make dev-web` (ports 8000 and 3000; see the README).
3. Open **one private window per person** (Owner, Admin, Sales). Sign in at `http://localhost:3000/login` with the printed e-mail and password. Add each person's printed *authenticator key* to an authenticator app (enter the key by hand: 6 digits, 30 seconds, SHA-1) and use the 6-digit code when the sign-in asks for it. Keep the app open: an Owner's or Admin's second factor is asked for again after an hour.
4. Stopwatch: start it when you read the step, stop it when the page shows the result. Write the **clicks** (every press of a button or link, every field you fill counts as one click, a page load by link counts as one) and the **seconds** in the two right-hand columns. Count a mistake and its correction too: that is the point.

Where things are: the workspace's home page lists the leads (tab *Leads*). A lead opens its enquiry; the enquiry page has the *Quote* section with the **Start order** button once the quote is approved; **Orders** (top navigation of the home page) lists every order.

Reading the order page: the state is in words (*Open*, *Won*, *Lost*, *Cancelled*, *Expired*), the money is a ledger, the **What to record next** forms are the entries the rules allow *now* for *your role* (guidance: the database decides again when you save), and **History** shows every entry with who recorded it and when.

---

## A. The happy path: Kaveri Silks to *Won, Closed, fully paid*

Quote: 12 Kanjivaram red. Total **₹50,400.00**, advance **₹25,200.00**.

| # | Who | Do | You should see | Clicks | Seconds |
| --- | --- | --- | --- | --- | --- |
| A1 | Owner | Home page → *Leads* → open **Kaveri Silks** → open its enquiry → scroll to *Quote* | the quote is *Approved*, total ₹50,400.00; an **Order** heading with **Start order** | | |
| A2 | Owner | Press **Start order** | the order page: *Open · Quote approved*, total ₹50,400.00, balance ₹50,400.00, banner "Nothing is sent by this system…" | | |
| A3 | Sales | Open **Orders** → **Order 1** (the newest; note its number) | the same order; forms offered: *I sent the quote*, *Cancel this order* is **not** offered to Sales | | |
| A4 | Sales | **Record: quote sent** | *Quote marked as sent* | | |
| A5 | Sales | **Record: customer accepted** | *Won · Accepted by the customer* | | |
| A6 | Sales | **Record: advance asked for** | *Advance asked for* | | |
| A7 | Admin | Open the order, **A payment was received**: amount `25,200`, today → **Record this payment** | *Advance received*, received ₹25,200.00, balance ₹25,200.00 | | |
| A8 | Sales | **Record: preparation started** | *In preparation* | | |
| A9 | Sales | **Record: dispatched** | *Dispatched* | | |
| A10 | Sales | **Record: delivered** | *Delivered* (balance still ₹25,200.00) | | |
| A11 | Admin | **A payment was received**: amount `25,200` → **Record this payment** | *Won · Closed, fully paid*, balance ₹0.00, "Nothing more can be recorded" | | |

Total for A: clicks ______ seconds ______ (and: how many times did you have to change person/window? ______)

## B. A decline, then a new quote and a new order: Lakshmi Sarees

Quote: 6 Banarasi red, total **₹19,530.00**, advance **₹9,765.00**.

| # | Who | Do | You should see | Clicks | Seconds |
| --- | --- | --- | --- | --- | --- |
| B1 | Admin | **Lakshmi Sarees** → its enquiry → *Quote* → **Start order** (this needs your authenticator code if the session is older than an hour) | the order, *Open · Quote approved* | | |
| B2 | Sales | **Record: quote sent**, then **Record: customer declined** with the reason *The price* | *Lost · Declined by the customer · The price*; "Not owed: the order is closed" | | |
| B3 | Sales | Back on the enquiry, *Quote*: choose **the same product** (the pick is kept) → **Make draft quote** (new customer, delivery state *Tamil Nadu*) | a new draft quote, total ₹19,530.00 | | |
| B4 | Admin | **Approve this quote** | *Approved*; the old quote is *Replaced* in the list of earlier quotes | | |
| B5 | Admin | **Start order**, then (Sales) quote sent, accepted, advance asked for; (Admin) payment `9,765`; (Sales) preparation, dispatched, delivered; (Admin) payment `9,765` | *Won · Closed, fully paid* | | |

Total for B: clicks ______ seconds ______

## C. A cancellation with no money in it: Meenakshi Weaves

| # | Who | Do | You should see | Clicks | Seconds |
| --- | --- | --- | --- | --- | --- |
| C1 | Admin | **Meenakshi Weaves** → enquiry → **Start order** | the order | | |
| C2 | Sales | **Record: quote sent** | *Quote marked as sent* | | |
| C3 | Admin | **Cancel this order** | *Cancelled*; "Not owed: the order is closed" | | |

Total for C: clicks ______ seconds ______

## D. A refund and a cancellation that carries money (the Owner's): Cauvery Silks (a repeat customer)

Quote: 8 Kanjivaram blue, repeat customer: total **₹35,280.00**, advance **₹8,820.00** (an Owner-only quote: it was approved by the Owner).

| # | Who | Do | You should see | Clicks | Seconds |
| --- | --- | --- | --- | --- | --- |
| D1 | Owner | **Cauvery Silks** → enquiry → **Start order** | the order | | |
| D2 | Sales | quote sent, customer accepted, advance asked for | *Advance asked for* | | |
| D3 | Admin | payment `8,820` | *Advance received*, received ₹8,820.00 | | |
| D4 | Admin | open the order and look at **What to record next** | **no** *A refund was given* and **no** *Cancel this order* (they are the Owner's: the order carries money) | | |
| D5 | Owner | **A refund was given**: amount `1,000` → **Record this refund** | the message says the rules flagged it for the owner; *Advance asked for* (the refund took it back under the advance); refunded ₹1,000.00 | | |
| D6 | Owner | **Cancel this order** | *Cancelled*; the message says the order had money in it and a refund may be owed; the order page and the list now carry the permanent line **Money still held: ₹7,820.00. A refund may be owed to the customer.** | | |

Total for D: clicks ______ seconds ______

## E. Things to try on purpose (not counted; write what you saw)

| # | Who | Do | You should see | What you saw |
| --- | --- | --- | --- | --- |
| E1 | Viewer | Open **Orders** | "Orders are shown to owners, admins and sales users." and no amount anywhere | |
| E2 | Owner | On an order in *Accepted*, press **Record this payment** with amount `0` or `abc` | a plain sentence asking for an amount in rupees; nothing is saved | |
| E3 | Admin | Sign out of the second factor (a window with only the password) and open an order that offers a payment | the payment form is a notice about the authenticator app, with a link, not a raw error | |
| E4 | Admin | Start an order for **Narmada Fabrics**, record *quote sent* and *customer accepted*, and look at **What to record next** | *Preparation started* is **not** offered until the advance is in; after a payment of `30,975` it is | |
| E5 | Sales | Open any order and look for the money forms | none (no payment, refund or cancellation) | |

Not in the browser (no page for it yet): the dispatch **override** (the Owner dispatching without the advance under a policy that allows preparation first) and publishing an order policy. The script covers both (`make rehearse-thin-slice`).

## F. Summary

| Path | Clicks | Seconds | Window changes | Your current way (stopwatch, no data shared) |
| --- | --- | --- | --- | --- |
| A happy path | | | | |
| B decline and re-quote | | | | |
| C cancellation | | | | |
| D refund and cancellation | | | | |

Notes: where did you stop and wonder what to do? Which word was unclear? Which entry did you want and not find?
