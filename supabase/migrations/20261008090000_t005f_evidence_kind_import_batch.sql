-- T005 fix round F / group C (1 of 2): a new evidence kind for the provenance of imported claims.
-- Kept in its own migration because PostgreSQL cannot USE an enum value in the transaction that adds it; the next
-- migration (import_lead_rows + the CHECK that only the import path may write this kind) uses it.
alter type public.evidence_kind add value if not exists 'import_batch';
