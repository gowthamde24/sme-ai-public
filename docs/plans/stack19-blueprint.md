# Stack19 product blueprint v1: three businesses, one platform

Owner: Gowtham (CEO). Written 14 Oct 2026. Status: APPROVED DIRECTION. Agents build from this document.
Where this blueprint and an ADR disagree, the ADR's safety rules win and the agent reports the conflict.
Related: ADR 0084 (packs, custom fields, campaigns, voice, children's data), ADR 0066 (outbox and money rule),
ADR 0061 (sign-up), decision-three-verticals, decision-pricing-fair-use, decision-auto-send-policy.

---

## 0. What we are building, in one paragraph

Stack19 is an **AI revenue engine for Indian small businesses**: a team of seven plush owl helpers that answer
WhatsApp enquiries, prepare quotes, chase follow-ups and payments, and tell the owner each morning what needs
them. The owner only approves money, promises and complaints. We serve **three kinds of business**, each with its
own layout, words and modules on one platform:

| Pack | Who | Their money problem we solve |
|---|---|---|
| **Textiles** | saree/fabric wholesalers and retailers (Customer Zero: family silk-saree shop, Dharmavaram) | slow replies lose orders; quotes by hand; retailers forget to reorder |
| **Construction materials** | paver blocks, bricks, kerb stones, tiles, cement, sand/aggregate sellers | enquiries need area-to-quantity maths and transport pricing; deliveries in trips; contractors pay late |
| **Education** | schools, colleges, universities, coaching and training institutes | fee collection chasing; admission enquiries lost; parents not informed |

**North-star metric per pack** (what the owner feels):
- Textiles: enquiries answered within 5 minutes; quotes sent per week; repeat orders.
- Construction: quote-to-order rate; outstanding dues (₹) going down; trucks dispatched on time.
- Education: fee collected on time (% of due); admission enquiries converted to campus visits / applications.

---

## 1. Design principles (non-negotiable)

1. **Phone first.** Design at 390 px first, desktop second. Owners run the business from a phone.
2. **One job per screen.** Every screen answers "what do I do next?" with one primary button.
3. **The owl does the work, the owner approves money.** Nothing about prices, amounts, discounts, refunds,
   complaints or new promises goes out without the owner's OK (ADR 0066). Campaigns: one approval per campaign.
4. **Their words, their language.** Each pack has its own labels (Customers vs Parents & students; Catalogue vs
   Products; Visits vs Site visits vs Campus visits). en, te, hi, kn now; ta next. Indian number format (lakh, crore),
   ₹, dd Mon dates.
5. **Ask only when needed.** Sign-up asks only the business type. Every other detail is asked in context the
   first time it is needed (progressive profiling).
6. **Fast on cheap phones.** Route JS budgets stay green; images via srcset; no 3D engines; works on slow 4G.
7. **Trust is visible.** Every automatic message is logged and reversible to a STOP; quiet hours; AI disclosure;
   privacy page per pack; children's data minimal (education).
8. **Default deny.** A module that is off for a pack is hidden in the UI AND refused in the database.
9. **No student information system, no ERP.** We do revenue: enquiries, quotes, orders, dues, reminders. We do not do
   attendance, marks, timetables, payroll, inventory accounting or full GST invoicing (we export to Tally/Vyapar).

---

## 2. Information architecture

```
Public website (marketing, no sign-in)            App (signed in, per workspace, layout by pack)
/                    home, pack switcher            Today            (all packs: owl hero + Needs you + team)
/textiles            vertical landing               Inbox            (WhatsApp chats; all packs)
/construction        vertical landing + calculator  <Pack core>      (see section 4)
/education           vertical landing               Contacts         (Customers | Customers & sites | Parents & students)
/pricing             plans, fair use, FAQ           Campaigns        (construction + education; textiles later)
/how-it-works        the owl team, safety           Reports          (pack-specific)
/security            privacy, DPDP, data location   Office           (2D plush team room)
/help                help centre (public articles)  Settings         (business, fields, team, integrations, plan, privacy)
/contact             WhatsApp us, demo request      Help
/signup  /login      2-step sign-up (section 3)
/terms /privacy      legal (per language)
```

**Phone navigation:** bottom tab bar with 4 tabs + More: `Today · Inbox · <pack core tab> · Contacts · More`.
Pack core tab: Textiles = **Quotes**, Construction = **Orders & deliveries**, Education = **Fees**.
**Desktop:** left sidebar with the same order; the Ask box (talk to Agent OWL) is on Today and as a floating button.

---

## 3. Sign-up and activation (all packs)

### 3.1 Sign-up: two steps, nothing else
1. **"What kind of business do you run?"** Three large cards with a plush owl wearing a pack prop
   (fabric roll / paver block / graduation cap), one line each, language switcher at the top.
2. **Continue with Google · Continue with Facebook · Continue with e-mail** and the line
   "By continuing you agree to the Terms and Privacy policy" (terms acceptance recorded, job CF).
Then straight to **Today**, laid out for their pack. Owner second factor (TOTP) is set up from the checklist
before the first real money action or WhatsApp connect (not at sign-up), and is required for approvals.
Later (after DLT): phone number + SMS code sign-in.

### 3.2 First run: "Try with example data"
Today opens with a banner: **See how it works with example data** (one tap loads a clearly-labelled sample
workspace for the pack; a button removes it). Empty states always show the owl + one action.

### 3.3 Activation checklist (top of Today until done; each step asks only what it needs)
| Step | Textiles | Construction | Education |
|---|---|---|---|
| 1 | Business name + city | Business name + city | Institution name, type (school/college/university/coaching), city |
| 2 | Add 5 sarees or import price list | Add products with unit + price (or import) | Import students & guardians (CSV/Excel) |
| 3 | Set quote rules (margin, GST rate per item from accountant) | Set delivery charge rule + advance % | Set fee plan (fee heads, instalments, due dates) |
| 4 | Connect WhatsApp (business name confirmed here) | Connect WhatsApp | Connect WhatsApp |
| 5 | Send first quote | Send first quote with calculator | Approve first fee-reminder campaign |
| Done = **activated** | first quote sent | first quote sent | first campaign approved |

GSTIN is asked on the first quote/receipt that needs it. Team invites are suggested after activation.

---

## 4. Module matrix (what each pack gets)

| Module | Textiles | Construction | Education | Notes |
|---|---|---|---|---|
| Today + Agent OWL + Ask box | ON | ON | ON | |
| Inbox (WhatsApp chats) | ON | ON | ON | |
| Contacts | ON (customers, retailers) | ON (customers + sites) | ON (guardians, adult students) | |
| Companies | ON | ON (contractors, builders) | OFF | |
| Enquiries + Requirement capture | ON | ON (area, application) | ON (admission enquiries) | |
| Catalogue | ON (sarees, photos) | ON (products, units, specs) | OFF (programmes instead) | |
| Quotes (deterministic engine) | ON | ON (calculator, transport) | OFF | |
| Orders | ON | ON (with deliveries/trips) | OFF | |
| Deliveries / dispatch | OFF | ON | OFF | new |
| Sites | OFF | ON | OFF | new |
| Programmes, classes, students | OFF | OFF | ON | new, children's-data rules |
| Fee plans + fee ledger + receipts | OFF | OFF | ON | new |
| Dues (receivables) | later | ON | ON (fees) | shared ledger engine |
| Follow-ups | ON | ON | ON (admission enquiries) | |
| Visits | ON (store visits) | ON (site/measurement visits) | ON (campus visits) | label per pack |
| Campaigns (reminders) | later | ON (payment due, delivery) | ON (fee due, events, exams, holidays) | reminders only, no promotions |
| Call list | ON | ON | ON | human calls via bridge |
| Retailer/lead finder | ON | ON (contractors, builders nearby) | OFF | |
| Research agent | ON | ON | OFF | |
| Voice notes (WhatsApp audio) | later | later | ON first | after campaigns |
| AI outbound calls | OFF | OFF | OFF (later, legal-gated) | |
| Reports | ON | ON | ON | pack-specific |
| Office (2D plush team) | ON | ON | ON | |
| Integrations: Tally/Vyapar/Excel, calendar | ON | ON | ON (fee export) | |
| UPI payment links | later | later | later | after company + provider |

---

## 5. Pack designs

### 5.1 Textiles (exists; polish only)
**Flow:** WhatsApp enquiry → Requirement (type, colour, budget, quantity) → catalogue items sent (photos) →
quote (deterministic) → owner OK → order → dispatch → payment recorded → reorder reminder.
**Screens:** keep current ones. Gaps to add later: reorder reminders for retailers (campaign), catalogue share link.
**Owl team labels:** Lead Finder (finds retailers), Researcher, Requirement Analyst, Quote Writer, Follow-up Desk, Order Desk.

### 5.2 Construction materials (paver blocks etc.)
**Customers:** contractors, builders, homeowners, architects, dealers. Many are repeat B2B buyers on credit.

**Catalogue: Product** fields (pack fields + custom fields):
product type (paver block, kerb stone, brick, tile, cement, sand, aggregate, other) · size (e.g. 200x100 mm) ·
thickness (mm: 60/80/100) · shape/pattern · colour · finish · grade/strength (e.g. M30, M35, M40, owner-entered) ·
**selling unit** (sq ft, sq m, piece, bag, tonne, cft, truckload) · price per unit · **pieces per sq ft** (or per sq m) ·
pieces per pallet · minimum order · stock note (in stock / made to order + lead days) · photos ·
GST rate and HSN code (entered by owner/accountant; we never assume a rate).

**Enquiry / requirement:** application (driveway, footpath, parking, industrial yard, garden, road) · area
(sq ft or sq m, or length × width) · product/thickness wanted · site location (pin/city) · needed-by date ·
laying needed (yes/no) · photos of the site. The Requirement Analyst extracts these from WhatsApp text/photos;
the owner confirms anything uncertain.

**Quote engine (deterministic, no model maths):**
- quantity = area × pieces-per-area × (1 + wastage %, default 5, owner-set), rounded up to whole pallets if the owner chooses;
- material = quantity × unit price (or area × rate when sold per sq ft);
- **transport**: owner's rule, one of: per trip (truck capacity in pieces/sq ft), per km slab (0–10, 10–25, 25–50 km), or free above ₹X;
  loading/unloading charge optional; trips = ceil(quantity / truck capacity);
- laying charge per sq ft (optional line);
- GST per item from the item's rate; totals in ₹ with lakh format;
- payment terms: advance % before dispatch (default 50, owner-set), balance on delivery or credit days (contractor);
- validity date (default 7 days, prices of cement/aggregates move).
Quote PDF/WhatsApp message with a clear table. Owner approval always (money).

**Public calculator** (marketing site /construction and a share link per business): area + product → pieces,
pallets, trips, estimated price range → "Get exact quote on WhatsApp" (lead capture with consent).

**Orders & deliveries:** order → delivery schedule of one or more **trips** (date, vehicle, driver phone, quantity,
site contact) → status per trip (planned, loaded, on the way, delivered, problem) → delivery note/challan
(printable, no GST invoice: invoices stay in Tally/Vyapar) → proof of delivery (photo + site contact name).
WhatsApp updates to the site contact: "Truck left, arriving about 3 pm" (no amounts → may send automatically).

**Sites:** a customer can have many sites (address, pin, map pin, site contact, truck access notes: lane width,
night delivery allowed, unloading help).

**Dues (receivables):** per customer: invoiced (entered/imported from Tally), paid, balance, ageing buckets
(0–30, 31–60, 61–90, 90+ days), credit limit warning before a new order. **Payment-due campaign**: reminder
3 days before due, on the day, 7 days after → then call list. Owner approves the campaign once.

**Visits:** measurement/site visits and yard visits (see samples).

**Reports:** quotes sent vs won, revenue by product, trips per day, outstanding dues by ageing, top customers.

**Owl team labels:** Lead Finder (contractors, builders, new projects nearby), Researcher, Requirement Analyst
("Site Measurer"), Quote Writer, Follow-up Desk, Order Desk ("Dispatch Desk").

**Not in scope:** stock/inventory accounting, production planning, GST invoicing, fleet GPS tracking, laying-crew payroll.

### 5.3 Education (schools, colleges, universities, coaching)
**Institution profile:** type (school / junior college / degree college / university / coaching / training),
academic year start month, terms, languages for parents.

**Structure:** **Programmes** (school: classes 1–12 with sections; college/university: courses e.g. B.Com, B.Tech CSE,
with year/semester; coaching: courses with batches and timings).

**People (children's-data rules, ADR 0084 part 5):**
- **Guardian** (contact, adult): name, phone (WhatsApp), relation, preferred language, consent per channel.
- **Student**: minimal record only: label (first name or initials, ≤30 chars), programme + class/section or
  course/year/batch, institution admission number (optional). Never: date of birth, photo, address, Aadhaar,
  health, religion, caste, income, marks, attendance, behaviour.
- **Adult student** (college/university, 18+ as declared by the institution): is the contact themselves; may also
  have a guardian contact.
- Child fields never reach a model, a log, an export (off by default) or a search index.

**Fees:**
- **Fee plan** per programme/class/course: fee heads (tuition, admission, transport, hostel, exam, books, other),
  amounts, **instalments** with due dates (term-wise, monthly, semester), late fee rule (fixed or per day, owner-set,
  optional), concession per student (amount or %, with a reason code, owner/admin only).
- **Fee ledger** per student: due, paid, balance per instalment; payments **recorded** (cash, UPI, bank, cheque) by
  staff with receipt number; **receipt** (printable/WhatsApp PDF, institution's format). Online payment links later.
- **Fee reminders** (campaign): before due, on due, after due → guardian WhatsApp (template, amount from the ledger,
  never computed by a model) → call list for no reply/no payment. Owner/Principal approves each campaign once.
- **Collection reports:** collected vs due by programme/class, today's collection, pending list (worded "pending",
  never "defaulter"), export to Excel/Tally.

**Admissions (enquiries):** source (WhatsApp, walk-in, website form, ad), programme interested, guardian/student
contact, stage (enquiry → campus visit → application → admitted / lost), follow-ups, campus visit booking with
reminders. Admitted → creates student + guardian + fee plan. This is the main revenue driver for colleges/coaching.

**Announcements (service only, no promotions):** event, holiday, exam notice, PTM invitation, transport change:
to a class/section, programme or whole institution; approved templates; quiet hours; STOP respected.

**Voice notes (first voice feature):** the same reminder as a short WhatsApp audio in the guardian's language
(text-to-speech of the approved text; the AI disclosure line spoken). AI phone calls stay off until the lawyer and
the telephony provider answer the TRAI/DLT questions (ADR 0084 part 4).

**Reports:** fee collection %, collection by day, pending by class, admissions funnel by source and programme.

**Owl team labels:** Admissions Desk (Lead Finder slot, but no web prospecting of minors), Researcher OFF,
Enquiry Analyst (Requirement Analyst), Fee Desk (Quote Writer slot → fee plans/receipts helper), Follow-up Desk,
Notice Desk (Order Desk slot → announcements/campaigns). Agent OWL as always.

**Not in scope:** attendance, marks/grades, timetable, LMS, transport GPS, hostel management, staff payroll,
student photos/ID cards. If asked: "We focus on admissions, fees and messages to parents."

**Real data gate:** synthetic students only until the DPDP children's review and the processing agreement are done.

---

## 6. Shared platform features (all packs)

- **Today**: Agent OWL hero with the morning summary; Needs you (approvals: quotes, campaigns, money messages,
  complaints); pack cards (Textiles: quotes waiting, visits; Construction: today's trips, dues due this week;
  Education: today's collection, fee reminders running, admission visits today); the team row.
- **Inbox**: WhatsApp chats, suggested replies, "send" respects the outbox policy, assign to staff.
- **Contacts**: list with search, filters by custom fields, import/export (5,000 rows, mapping incl. custom fields),
  consent per channel, privacy rights (export/erase).
- **Campaigns**: list → new (pick kind: payment due / fee due / event / exam / holiday / delivery update) →
  pick audience (import or filter) → template preview with real samples → schedule steps → **owner approves once
  (2FA)** → running → results (sent, delivered, read, replied, paid, blocked by STOP/quiet hours/limits) → call list.
- **Call list**: one-tap call via the bridge, outcome buttons (paid / promised date / call later / wrong number / stop).
- **Payments recorded**: one shared ledger engine for dues (construction) and fees (education); UPI links later.
- **Reports**: weekly owner report on WhatsApp (exists: "This week").
- **Team & roles**: Owner, Admin, Staff (sales/front office), Accountant (read reports, record payments), Viewer.
- **Settings**: business profile, pack fields (custom fields), quote/fee rules, quiet hours, languages, integrations,
  team, plan & usage, privacy, security (2FA).
- **Help**: per-pack help articles and the "What can Agent OWL do?" chips per pack.
- **Office**: 2D plush team room (exists).

---

## 7. Public website (marketing) design

**Goal:** sign-ups that activate. Every page has one CTA: **Start free, choose your business** → /signup.

- **Home (/)**: hero "Your AI team for WhatsApp sales and payments" with the plush owl team; three business cards
  (Textiles / Construction materials / Education) → vertical pages; "How it works in 3 steps" (connect WhatsApp →
  owls answer and prepare → you approve money); trust strip (your data in India, you approve every rupee, STOP
  respected); pricing teaser; FAQ; footer with languages.
- **/textiles, /construction, /education**: problem → day-in-the-life with the owls → features specific to the pack
  (section 5) → screenshots/phone mockups with example data → pack FAQ → CTA. /construction includes the **live
  paver calculator**. /education includes a **fee reminder preview** (WhatsApp mock) and the children's-data promise.
- **/pricing**: plans from decision-pricing-fair-use (Free trial 30 days no card / Starter ₹499 / Growth ₹1,499 /
  Business ₹3,999 per month; founding offer; done-for-you setup ₹2,999), "AI included, fair use", GST inclusive,
  cancel anytime, 7-day refund; per-pack examples of what each plan fits. Billing stays OFF until the owner enables it.
- **/how-it-works**: the seven owls, what they do per pack, what always waits for you.
- **/security**: data location, DPDP rights, children's data (education), who sees what, AI disclosure.
- **/help** public articles, **/contact** (WhatsApp click-to-chat + form with consent), legal pages.
- SEO: server-rendered, per-language URLs (/te, /hi, /kn), meta + Open Graph images with the owls, schema.org
  SoftwareApplication + FAQ; Core Web Vitals green on slow 4G; images ≤ 60 KB above the fold.

---

## 8. Visual and interaction design

- Existing v2 tokens: accent #ff773c, ink #1e1e24, paper #f9f8f6, dark #17161a; Bricolage Grotesque headings,
  Plus Jakarta Sans text; Indic fonts already subset.
- Pack accent (small touches only, not a new theme): Textiles = rose silk, Construction = terracotta/stone,
  Education = sky blue. Used in the pack badge, empty-state props, landing hero.
- Owl props per pack (later art job): fabric roll, hard hat + paver block, graduation cap.
- Numbers: ₹ with Indian grouping; quantities with units always visible (sq ft, pcs, trips).
- Every list: search, filter chips, sticky primary action; every money action: confirmation sheet with the amount in words.
- Accessibility: 44 px targets, WCAG AA contrast both themes, screen-reader labels from i18n.

---

## 9. Service design (beyond the screens)

- **Done-for-you setup (₹2,999)**: we import their price list / student list, set rules, connect WhatsApp, in one call.
- **Support**: WhatsApp support number (our own Stack19 workspace runs on Stack19), help centre, in-app "Ask OWL how".
- **Onboarding success**: activation checklist; day-3 and day-7 nudges if not activated; weekly owner report.
- **Health signals (admin console later)**: activated?, messages handled/week, approvals waiting > 24 h, AI usage vs fair use.
- **Feedback**: thumbs on owl suggestions; monthly 2-question survey; feature requests tagged by pack.
- **Real reviewers before opening a pack**: one real paver-block seller and one real school/college review their
  pack (words, fields, rules) before the pack is opened to outside sign-ups.

---

## 10. Security, privacy, compliance gates

| Gate | Blocks |
|---|---|
| DPDP review (general) | real data for any outside business |
| DPDP children's review + processing agreement | real student data (education) |
| Lawyer view on campaign money rule | real campaigns with amounts |
| TRAI/DLT + provider answers | AI calls, SMS sign-in, SMS reminders |
| Meta verification + templates | WhatsApp at scale, Facebook login public |
| Google OAuth verification (domain + privacy page) | Google login public |
| Accountant | GST on our own invoices, billing |

---

## 11. Delivery plan (jobs)

Two lanes: **C1** = API/DB (~/Desktop/sme-ai-public), **C2** = web (~/Desktop/sme-ai-polish). Each job: own branch,
tests, report in ~/Desktop/v2-overnight/job-<id>-report.md ending with the full merge line. One heavy test job at a
time. Synthetic data only.

| Wave | C1 (API/DB) | C2 (web) |
|---|---|---|
| 1 | **CK** packs + modules + business type + custom fields + units + import 5,000 + social sign-up (Google/Facebook) | **CL** pack-aware shell: 2-step sign-up, pack labels/nav, module guards, fields UI, activation checklist + example-data toggle |
| 2 | **CN** construction core: product specs, sites, area→quantity calculator, transport rules, quote lines, orders → trips, delivery notes | **CM** public website: home, 3 vertical pages, pricing, how-it-works, security, contact, public paver calculator (uses CN's pure calculator logic or a shared package) |
| 3 | **CP** shared ledger + dues/receivables (payments recorded, ageing, credit limit) + campaigns engine (reminders only, campaign approval, call list, results) | **CO** construction screens: products, quote builder with calculator, sites, deliveries/trips, dues |
| 4 | **CR** education core: institution profile, programmes, students (minimal) + guardians, fee plans, instalments, fee ledger, receipts, admissions pipeline, announcements | **CQ** campaigns + call list + results screens (all packs) |
| 5 | **CV** voice notes (WhatsApp audio reminders) + per-pack reports API | **CS** education screens: students/guardians import, fee plans, ledger, receipts, collection dashboard, admissions board, announcements |
| 6 | review fixes, pgTAP matrix, evals for child-field absence | **CU** reports per pack + Today pack cards + polish, i18n completeness, perf budgets |

Owner work in parallel: proprietorship → domain → privacy page; Google OAuth client; Meta app; lawyer; accountant;
one paver-block seller + one school/college reviewer; native readers.

---

## 12. Definition of done (every job)

- Works at 390 px and desktop, light and dark; en/te/hi/kn strings present (native review flagged).
- Module guard in DB + UI; pgTAP for every new function; pytest/vitest; e2e for the main flow.
- No model computes money; children's fields never reach a model/log/export.
- Route JS budgets green (Today ≤ 201,000 B, landing ≤ 153,000 B unless the owner approves a raise).
- Screenshots in ~/Desktop/v2-overnight/shots-<job>/; report lists anything not done and why.
