# Runbook: exporting sales and payments to Tally, Vyapar, CSV or Excel (job BI, ADR 0073)

Who: an **Owner or an Admin with a second factor**. What: the **accepted orders** (sales) and the **payments and refunds** recorded in a date range (India dates, at most 366 days), for **your business only**. Every export is written to the audit trail (who, when, format, range, counts; no customer data).

API: `POST /v1/tenants/{id}/exports/accounting` with `{export_id, format, from_date, to_date}`; the answer is the file. Formats: `tally_zip`, `tally_masters_xml`, `tally_vouchers_xml`, `vyapar_xlsx`, `csv`, `xlsx` (`GET .../exports/accounting/formats` lists them).

## What is a sale, what is a payment
* **Sale**: an order the customer accepted that was not lost since (accepted, advance requested/paid, in preparation, dispatched, delivered, closed paid). Its date is the India day of the acceptance. Voucher number `SO-00012` (the order number). The amounts are the approved quote's: Sales (merchandise), Freight Charges, GST per rate, and `Round Off` for any paisa difference.
* **GST**: CGST + SGST (half each; an odd paisa to SGST) for an intra-state supply, IGST for inter-state, each at the quote's rate (ledger names like `Output CGST @ 2.5%`).
* **Payment**: a payment recorded on an order (a Receipt in Tally) or a refund (a Payment). Dated by the India day it happened.
* **GSTIN (job CA)**: a customer's GSTIN (set on the customer, `docs/runbooks/gstin.md`) fills the GSTIN column of the CSV and XLSX register and of the Vyapar Parties and Sales sheets; the shop's own is the last column of the CSV and XLSX register (`Seller GSTIN`). The **Tally files do not carry GSTINs**: the names of Tally's XML tags for a ledger's registration details could not be verified, and a wrong tag makes the import fail; set the GSTIN on the party ledger in Tally.
* **Not included**: HSN codes, stock items, customers' contact details, drafts, lost orders.

## Tally Prime: step by step
Source (read 2026-10-11): TallyPrime help, "How to Import Data from JSON or XML into TallyPrime" and "Import Data - FAQ" (help.tallysolutions.com), and Tally's sample XML pages (/sample-xml/, /xml-integration/).
1. Export the format **Tally Prime (zip)**. Unzip: `1-masters.xml`, `2-vouchers.xml`, `README.txt`.
2. Open the Tally company and **make a backup** (Tally offers one during the import: answer Yes). Try with a short date range first (one day) on a **copy** of the company.
3. **Alt+O (Import) > Masters**, give the path of `1-masters.xml`; for the Import Behaviour choose **Ignore duplicates**; Enter. This creates the customer ledgers (under Sundry Debtors), `Sales`, `Freight Charges`, `Round Off` and the GST ledgers (under Duties & Taxes).
4. **Alt+O (Import) > Transactions**, give the path of `2-vouchers.xml`; Enter.
5. Check **Day Book**, **Sales Register** and the party ledgers. Problems are in the **Exceptions report**; the details are in `Tally.imp` (Alt+O > Configuration > Enable detailed log).
6. Receipts and refunds use the ledger **Cash** (it exists in every company). If the money went to a bank, change it in Tally afterwards, or edit the file's ledger name before importing.
7. Importing a range **again**: every voucher carries a stable GUID (the same order or payment always has the same one; job BO). Set **Alt+O > Configuration > "Overwrite voucher when a voucher with same GUID exists" = Yes** first and the earlier vouchers are replaced; with the default (No) Tally creates them a second time. Voucher numbers (`SO-00012`...) never change.
* Release notes: XML works in every TallyPrime release (Excel needs 4.0+, JSON 7.0+). Names in Telugu, Hindi and other scripts need TallyPrime (Unicode); ERP 9 may show them wrongly. The company's F11 features must be the ones its vouchers use.
* The GST ledgers are plain ledgers: if you file GST from Tally, set each one's GST type and rate in Tally (F12).
* A sample of the files: `services/ai-api/tests/golden_bi/tally_masters.xml` and `tally_vouchers.xml` (invented names; the file is the test's golden, so it cannot drift).

## Vyapar: step by step
Sources (read 2026-10-11): Vyapar's own guide "How to Use Vyapar for Inventory Management of a General Store" (Utilities > Import Parties / Import Items), and Vyapar TaxOne help "Uploading Sales/Sales return data through an excel sheet" (Bulk Upload).
What Vyapar accepts: **Parties** and **Items** from an Excel template (the app shows the errors and imports only when there are none), and, in **Vyapar TaxOne**, a **Sales** sheet through Bulk Upload (headers without dots or dollar signs, dates DD/MM/YYYY, under 30 MB, then a mapping screen). The main Vyapar app publishes **no** sale-invoice import.
1. Export **Vyapar (Excel)**: one workbook with sheets `Parties`, `Items`, `Sales` (one row per invoice line, plus freight and round-off rows) and `Payments`.
2. In the Vyapar app: **Utilities > Import Parties > Download sample**. Compare its header names with the workbook's `Parties` sheet; if one differs, rename it in the workbook (the application keeps its names in one table, `app/integrations/vyapar.py`, so a rename there fixes it for everybody). Browse to the file; import only when there are zero errors. Do the same for **Import Items** with the `Items` sheet.
3. For the invoices: use the `Sales` sheet with **Vyapar TaxOne > Bulk Upload > Sales**, then map the columns on its mapping screen. Payments (`Payments` sheet) are for your own reference or for a manual entry: Vyapar documents no payment import.
* Honest limit: Vyapar publishes no list of its template's header names, so the names here are the common ones, not verified against a live Vyapar.

## Plain CSV and Excel
`csv`: UTF-8 with a byte-order mark (Excel reads Telugu and Hindi names), one register: `Record` (Sale / Payment received / Refund paid), India date `DD/MM/YYYY`, voucher number, order number, party, GSTIN (the customer's, empty when none is stored), place of supply, supply type, taxable value, CGST, SGST, IGST, freight, round off, total (all `(INR)`, two decimals, no thousands separators), reference. A text cell that starts with `=`, `+`, `-`, `@` is written with a leading apostrophe so a spreadsheet cannot run it. `xlsx`: the same register plus a sheet of sale lines and a sheet of payments.

## Safety
Everything is read for the business in the token (by the database, not by the API); another business's data cannot appear. A request without a second factor, from Sales or a Viewer, or from another business is refused before any data is read, and leaves no export record.
