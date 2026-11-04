-- The Lead Finder for a school, organisations only (owner decision 4 Nov 2026; ADR 0119 "Schools"). The previous migration adds version 3 of the education pack: version 2 plus the `lead_finder`
-- module (nothing else changes). This moves the school workspaces pinned to version 2 to version 3, so the module is on for them. A school keeps the pack it chose: only the version moves.
-- What the module allows is narrower than for a shop: the search finds ORGANISATIONS (associations, companies and their HR, coaching centres, transport and event vendors, institutions), a request
-- for individuals or families is refused politely by the API, and families are reached only from the school's own enquiry list (the existing school rules stay). The plan's switch still applies:
-- the Lead Finder is part of AI Workforce.

update packs.workspace_pack w
   set pack_version = 3
 where w.pack_code = 'education'
   and w.pack_version = 2
   and exists (select 1 from packs.pack_versions v where v.code = 'education' and v.version = 3);
