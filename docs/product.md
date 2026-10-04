# Product scope

## Vision

An AI workforce / operating intelligence layer for SMEs that finds customers, converts enquiries into orders, coordinates work, gets businesses paid, and tells the owner what needs attention.

## First product: AI Revenue Engine

Flow: Lead Discovery/Import -> Research + Evidence -> ICP Score + Human Review -> Approved Outreach Draft -> Human Sends -> Reply/Enquiry Captured -> Requirement Agent (human confirms) -> Quote Service (AI explains, human approves) -> Follow-up Task/Draft -> WON/ORDER or LOST (reason captured) -> Owner Brief + Metrics + Audit.

| Stage | V1 does | Automation boundary |
| --- | --- | --- |
| Lead discovery | Candidates from permitted public/business sources or customer lists | No mass scraping of prohibited/private data |
| Lead research | Fit, relevance, geography, evidence | Every score keeps evidence/provenance |
| Lead scoring | Configurable ICP rules + AI reasoning | AI recommends; human can override |
| Outreach prep | Draft personalized email/message | Human approval required |
| Enquiry/RFQ capture | Parse email/forms/files into structured requirement | Low-confidence fields flagged |
| Quote draft | Draft from catalog/rules/approved history | Never invent price; human approval mandatory |
| Follow-up | Tasks/drafts from state and consent | Auto-send OFF in V1 |
| Order conversion | Won/lost, order record, source trail | Deterministic state transition |
| Owner brief | Daily/weekly actionable summary | Read-only recommendations first |

## Customer Zero

Family wholesale silk-saree business. Real access, fast feedback. Run for four weeks and measure against a baseline before claiming value. Real customer data is imported only after security controls pass.

## Non-goals (do not build now)

Full ERP, payroll, GST filing, HR suite; autonomous voice sales bot; unrestricted web scraper/contact harvester; automatic final manufacturing pricing; automatic supplier purchase orders; custom foundation model; computer-vision quality system; iOS/Android apps; a twenty-agent swarm; an investor dashboard of projected vanity metrics.

## Status labels

Blueprint claims are tagged VERIFIED (checked fact), DECISION (architecture choice) or HYPOTHESIS (unproven commercial claim). Pricing figures and revenue scenarios are experiments, not forecasts.

## Pilot sequence

1. Customer Zero: silk wholesale.
2. External pilot: building-material SME (same core, configured industry pack).
3. External pilot: precision/auto-component manufacturer (RFQ, drawing revisions, engineering approval).

## Stage gates

Security gate, agent gate, Customer Zero gate, horizontal-platform gate, manufacturing gate, commercial gate and fundraising gate must each pass before the next stage. See the blueprint (sections 36-41) for the full table.
