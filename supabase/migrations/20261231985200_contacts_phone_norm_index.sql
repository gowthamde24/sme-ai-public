-- Today's slowest read (planner, 19 Nov 2026, Server-Timing): public.lead_desk_page took 665 ms for 50 leads, and the Today summary waits for it. Cause: for every lead on the page, lead_desk_json looks for an
-- older lead with the same normalised phone number (`duplicate_of`): `app.phone_norm(c2.phone) = app.phone_norm(c.phone)` over EVERY contact of the workspace, so each page scanned the contacts 50 times.
-- app.phone_norm is immutable: an expression index lets that comparison find the same-number contacts directly.
create index contacts_phone_norm_idx on public.contacts (tenant_id, (app.phone_norm(phone))) where phone is not null;
