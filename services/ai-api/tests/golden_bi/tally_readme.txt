HOW TO IMPORT THESE FILES INTO TALLY PRIME
==========================================
Window: 2026-10-01 to 2026-10-31   Sales: 3   Payments and refunds: 2

Before you start
  1. Open the Tally company you keep these books in. Take a BACKUP first (Tally offers one when you import: say Yes).
  2. Use the same company features (F11) the company already has. The GST features need not be on for this import.
  3. These files are plain accounting vouchers. They have no GSTIN, HSN or stock items: add those in Tally if you file GST from Tally.
  4. The ledger "Cash" must exist (Tally creates Cash in every company). Receipts and refunds use it; change it in Tally afterwards if the money went to a bank.

Import, in this order (TallyPrime Release 4.0 or later: XML works in every release)
  1. 1-masters.xml     press Alt+O (Import) > Masters, enter the file path, choose "Ignore duplicates" for Import Behaviour, answer Yes to the backup, press Enter.
  2. 2-vouchers.xml    press Alt+O (Import) > Transactions, enter the file path, answer Yes to the backup, press Enter.
  3. Check: Day Book, Sales Register and the party ledgers. Anything Tally could not import is in the Exceptions report; the details are in Tally.imp
     (Alt+O > Configuration > Enable detailed log).

Notes
  * Every voucher carries a STABLE GUID (the same order or payment always has the same one). To import a range again without doubling it, set Alt+O > Configuration > "Overwrite voucher when
    a voucher with same GUID exists" to Yes first: the earlier vouchers are replaced. With the default (No) Tally creates them again. The voucher numbers (SO-00012 ...) never change either.
  * A voucher is Sales (the party is debited the order total; Sales, Freight Charges and the GST ledgers are credited), Receipt (money in) or Payment (a refund). Round Off holds
    any paisa difference between an order total and its parts.
  * Names in Telugu, Hindi or other scripts need TallyPrime (Unicode); Tally ERP 9 may show them wrongly.
  * Amounts are in rupees; dates are the India dates.
