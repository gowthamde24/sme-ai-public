"""Job BI (ADR 0073): files in and out of the application. Accounting exports (Tally, Vyapar, CSV, XLSX), spreadsheet imports (customers, catalogue stock), the visits calendar feed and the
policy-acceptance record. Pure builders and parsers live here (no database, no clock, no network); the routes and the repository are the only parts that touch the data layer."""
