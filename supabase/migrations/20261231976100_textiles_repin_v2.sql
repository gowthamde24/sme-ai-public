-- Campaigns for textiles (owner, 15 Nov 2026). The previous migration adds version 2 of the textiles pack: version 1 plus the `campaigns` module (nothing else changes). Textiles was the one pack
-- without it (version 1 was published before the module existed and the eleven lead packs got it in their version 2). This moves the textiles workspaces pinned to version 1 to version 2, so the
-- Campaigns screen is on for them. A shop keeps the pack it chose: only the version moves. What a textiles campaign may SEND is a separate, stricter rule (marketing consent + an approved marketing template).

update packs.workspace_pack w
   set pack_version = 2
 where w.pack_code = 'textiles'
   and w.pack_version = 1
   and exists (select 1 from packs.pack_versions v where v.code = 'textiles' and v.version = 2);
