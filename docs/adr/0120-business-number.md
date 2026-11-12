# ADR 0120: every business gets its own phone number inside Stack19 (ACCEPTED with limits, 5 Nov 2026)

Status: **ACCEPTED by the owner, 5 Nov 2026, with these limits** (job calls-like-a-pro, part 2):
- **Option A** (one Stack19 Exotel account, a number per workspace) for **INBOUND and testing** now.
- **Outbound AI calls to customers' leads stay OFF** until the lawyer answers question 7: who is the subscriber of record, and whether each business needs its own KYC and DLT registration as principal entity.
- **Movable later:** A must be built so that a workspace can move to B (a sub-account) or C (its own number) later **without data changes**.
- **Budget:** 1 number now (04045903154, Hyderabad, INR 499 a month) plus a small prepaid balance. **No more numbers without the owner's OK.**

## Amendment, 13 Nov 2026 (corrected): Plivo, the reseller model (option B), and what Plivo's written answers change (ticket #37858)
The telephony provider is **Plivo** (ADR 0122); the Exotel text below is the record of the 5 Nov decision. Plivo's answers on ticket #37858, relayed by the owner:
- **Numbers:** **080 / 022** landline numbers are for **non-BFSI service and transactional calls**, no DLT, usable once the business's KYC is approved. **140** is promotional only (PE and TM both on the Tata DLT platform, TM registered in Mumbai or Karnataka, a third-party TM allowed, we stay the PE and hold the consent). **160** is BFSI only. No startup credits. **Plivo has no DND/NCPR API**: our own DND source is needed before any 140 call (later track).
- **A2P (evidence kept):** an earlier answer said AI-voiced calls are A2P under the TRAI TCCCPR Third Amendment 2026 and need a prior declaration on the DLT platform, else UCC. **Plivo then CORRECTED that in writing: no declaration is needed from us; calls via Plivo are already handled as A2P; AI answering of inbound calls needs no declaration.** The brief change to "inbound only" was reverted. **The lawyer confirms the correction against the primary text of the Third Amendment** (`lawyer-questions-DRAFT.md` item 14).
- **Consequence for this ADR:** Customer Zero launches on an **080 number: inbound AND call-backs to people who enquired**. The limit above ("outbound AI calls stay OFF until the lawyer answers question 7") stands in its remaining part: outbound stays OFF until the owner and the lawyer say so and the proof-of-request rule is built (`docs/plans/outbound-proof-of-request.md`).
- **Contracting entity:** **Plivo Services India Private Limited** (processors list #500).
- **Decision (replaces "Option A now" for Plivo): Option B, the reseller model.** Stack19 registers as a **Plivo Reseller**. For each customer business: **a Plivo sub-account, that business's own KYC (GST / Udyam / Certificate of Incorporation), and its numbers rented under ITS sub-account.** Customer Zero's first number is the exception that proves the path (the owner's account, in the console). The code already holds a per-workspace sub-account token (`sme-ws-<workspace>-plivo-token`, ADR 0122 phase C); `phone_numbers` carries provider, account reference and the compliance application's status. The phone-number screen collects the business's KYC **for its sub-account, documents going straight to Plivo** (Stack19 keeps only the application id and its status; how the documents travel, Plivo's hosted form or a direct upload, is decided with Plivo's answer on reseller registration, because ADR 0122 says we never see a document). **Not built yet; no real number is rented without the owner's OK.**
- Still open with Plivo: reseller registration and fees, the DND source.

## The decision to make
The owner (5 Nov 2026): "Every business gets its OWN business number from inside Stack19 (no Exotel dashboard for the customer)." Today there is ONE Exotel account (stack19's) with a shared trial number, and the owner is buying one ExoPhone (Hyderabad) for Owner Test.

## Options

| | A. One Stack19 Exotel account, numbers per workspace | B. An Exotel sub-account per business (reseller / partner) | C. Bring your own number (the business's existing Exotel or SIP trunk) |
|---|---|---|---|
| Who is the customer of Exotel | Stack19 | each business (under Stack19's partner account) | the business |
| KYC with Exotel / DoT | Stack19's KYC once; **each business's own KYC is still needed for its own number and for calling as that business** (see KYC) | each business's KYC on its sub-account | the business's own |
| Who pays Exotel | Stack19 (resold in the plan's call minutes) | Stack19 (partner billing) or the business | the business |
| Setup inside Stack19 | number pool, assignment, routing by number (already built: `phone_numbers`, the line lookup) | sub-account create + number per sub-account: **no public API for sub-accounts** (Exotel: enterprise customers request them through their account manager) | paste the credentials (the Secret Manager pattern of ADR-B / #339) |
| Time to a working number | ~1 to 3 business days after KYC | days (account manager), then KYC | as fast as the business |
| Risk | Stack19 carries every business's calling compliance on one account; one complaint can affect all | cleanest separation; depends on Exotel's partner terms | least control over quality and rules |

**Decision: A now (inbound and testing), within the limits above; B or C per workspace later.** A works with what is built (`phone_numbers` per workspace, the line lookup by the called number, the sandbox list) and needs no new provider account: Stack19 rents numbers and assigns one to each workspace. The business's KYC documents are collected inside Stack19 (Settings -> Phone number, C2's screen) and sent to Exotel, never kept by us beyond what the law requires.

## KYC and the rules (verify with the lawyer, Dec/Jan; question 4)
- Exotel: KYC unlocks production numbers; typically 1 to 3 business days; documents depend on the business type (proprietorship, partnership, LLP, private limited: PAN, GST, incorporation, owner / director ID). Sources: Exotel developer docs, "KYC Verification", "Account Setup & KYC FAQs".
- TRAI / DoT (TCCCPR, amended 12 Feb 2025, per vendor summaries; **check the primary text**): commercial voice calls must come from the **140** series (promotional) or the **160** series (service / transactional), with the business registered on a **DLT** platform as a principal entity. Calls a business's AI makes to its own enquiring leads are most likely "service" (160) when they answer the customer's own request; any promotional campaign is 140. A plain landline / mobile ExoPhone is fine for **inbound** calls (customers ringing the business).
- So: inbound first (the business's own number, customers call it) is low risk; outbound AI calls need the 140/160 + DLT route per business before real calls.

## Costs (indicative; confirm with Exotel sales before any purchase)
- Number rental: INR 500 to 1,000 a month for a landline / mobile ExoPhone; INR 1,500 to 3,000 for toll-free (Exotel developer docs, "Number Types & Virtual Numbers FAQs"). Billed monthly on the activation date.
- Calls: billed per pulse (usually 60 s) from prepaid credit (Exotel docs, "Billing Overview", "Pricing Model"). Per-minute rates were not found on an official 2026 rate card; vendor pages say roughly INR 0.50 to 1.50 a minute (unverified).
- Plans: sources disagree on Exotel's starting plan (about INR 9,999 prepaid credit, or USD 70 to 100 tiers): ask sales.
- The owner's own number (04045903154, Hyderabad): about INR 499 to recharge, as the owner said.

## How others do it in ~5 minutes
A cloud-telephony SaaS that offers "your own number in 5 minutes" rents from its own number pool (option A), lets the customer pick a city, starts with inbound immediately, and holds outbound until KYC and DLT are done. That is the plan here: pick a city -> a number from Stack19's pool is assigned -> inbound works at once (the AI answers) -> KYC upload -> outbound unlocked after verification.

## Built so A can become B or C without data changes
A workspace's number is one row in `phone_numbers`, with the provider and the **account it belongs to as data**:
- **A:** Stack19's account.
- **B:** the business's sub-account.
- **C:** the business's own account, with its credentials in Secret Manager (the `sme-ws-*` pattern, ADR B / #339).

The call path reads the account from the number's row, never from one global setting. Moving a workspace from A to B or C changes that row's account reference; calls, leads and outcomes don't change.

## What would be built
1. `phone_numbers` gains `status` (requested, kyc_pending, active, released) and the KYC steps (documents go straight to the provider; we keep only their status).
2. Settings -> Phone number (C2): choose a city / number, the KYC steps, status, a test call to the owner's own phone (sandbox).
3. The number pool and assignment as an operator step until Exotel's API allows renting by API.

Nothing here buys a number or creates an account; the owner decides A or B (and the budget) first.
