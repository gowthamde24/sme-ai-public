-- Job DW: the menu word of the lead packs, "Find leads", is now "Leads" (to match "Catches every lead": nothing is searched for). The previous migration adds a NEW version (2) of each of these eleven packs (a synced
-- version is never edited); it differs from version 1 ONLY in that word (modules, fields, rules and every other word are the same). This moves the workspaces that were pinned to version 1 to version 2, so the word
-- changes for them too. A business keeps the pack it chose: only the version moves. Textiles and construction materials are not in this list: their "Find retailers" is a real search (Google Maps) and their words
-- are the web app's own dictionary.

update packs.workspace_pack w
   set pack_version = 2
 where w.pack_version = 1
   and w.pack_code in ('auto_dealer', 'clinic', 'coaching', 'education', 'general_business', 'gym', 'insurance_loans', 'interiors_solar', 'real_estate', 'travel', 'wholesale_b2b')
   and exists (select 1 from packs.pack_versions v where v.code = w.pack_code and v.version = 2);
