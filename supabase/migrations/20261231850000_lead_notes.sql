-- A free-text Notes field on a lead (owner, 14 Nov 2026): the owner and the assistant add and edit it, the lead card shows it, and a call plan carries it as context.
--   * public.lead_profiles.notes: free text up to 2,000 characters, clean text; PII (a person's own words about the lead): erased with the workspace and swept when a person asks to be forgotten (registry rows),
--     listed in the audit trigger like the other profile fields.
--   * public.lead_profile_fix: `notes` is now one of the fields the owner may set (copied from the newest definition with two replaced lines); app.lead_desk_json: `profile.notes`.
alter table public.lead_profiles add column notes text check (notes is null or (char_length(notes) between 1 and 2000 and app.text_is_clean(notes)));
comment on column public.lead_profiles.notes is 'PII: free text the owner or the assistant wrote about the lead (what was agreed, what to remember). Erased with the workspace.';

insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('lead_profiles', 'notes', 'tenant', 'null', 'erased:1'),
  ('lead_profiles', 'notes', 'sweep', 'substring', 'erased:1');

drop trigger audit_lead_profiles on public.lead_profiles;
create trigger audit_lead_profiles after insert or update or delete on public.lead_profiles for each row execute function app.audit_row_change('lead_profile', 'need,quantity,area,city,budget,timeline,campaign,notes');

do $do$
declare
  v_fix   text := pg_get_functiondef('public.lead_profile_fix(uuid, uuid, jsonb)'::regprocedure);
  v_json  text := pg_get_functiondef('app.lead_desk_json(public.leads, public.lead_profiles, public.contacts, uuid, boolean)'::regprocedure);
  v_keys  text := '''campaign'', ''urgency'', ''language'', ''junk'')';
  v_set   text := 'campaign = case when p_fields ? ''campaign'' then p_fields ->> ''campaign'' else x.campaign end,';
  v_prof  text := '''source'', l.source, ''campaign'', p.campaign,';
begin
  if position(v_keys in v_fix) = 0 or position(v_set in v_fix) = 0 or position(v_prof in v_json) = 0 then
    raise exception 'lead notes: the profile functions are not the ones this migration expects';
  end if;
  execute replace(replace(v_fix, v_keys, '''campaign'', ''notes'', ''urgency'', ''language'', ''junk'')'), v_set, v_set || E'\n        notes = case when p_fields ? ''notes'' then p_fields ->> ''notes'' else x.notes end,');
  execute replace(v_json, v_prof, v_prof || ' ''notes'', p.notes,');
end
$do$;
