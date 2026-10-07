-- T010 part 2, commit 4d: a retry of "ask for a draft" replays whatever the clock says.
--
-- Found by the follow-up rehearsal driver (commit 4c): public.create_followup_draft replayed a retry only when the stored request_text and result_text were byte-identical to the retry's. The
-- request carries the API's clock (`as_of`, whole seconds), so a retry of the same draft id a second or more later (a timeout, a double click, a flaky network) was the constant `conflict`
-- instead of a replay. No duplicate was ever made; the screen said the form was out of date. The retry rule of this application (a retry must be accepted) now holds here too.
--
-- THE ONE CHANGE (everything else is the function as it was, line for line: the role proof, the argument checks, the lock order lead -> contact -> key, the gate, the stops, the policy, the
-- as_of window, the rebuilt request, the database's own decision, the engine's result, the one-open-draft rule, the closed template, and every SQLSTATE and reason):
--   the replay rule. A draft that already exists under p_draft_id is REPLAYED (the stored draft, `replayed: true`, nothing created) when it is of the same tenant, the same lead and the same
--   channel as the call. Whatever as_of, history, engine version or result the retry carries is ignored: the caller says "the draft I asked for", and the answer is that draft. The same id
--   under another tenant, lead or channel stays the constant conflict: the same answer for another lead, another channel or another tenant, and it carries nothing of the other draft.
-- A draft that has since been approved, recorded as sent or discarded is replayed with the status it has reached: the retry asks "did my request succeed?", the truthful answer is that the draft
-- exists and what became of it; creating a new draft for a discarded one would be a duplicate, and refusing would turn a harmless retry into an error. A replay changes nothing.
--
-- The grants and the owner of the function are kept (create or replace); the function is security definer with an empty search_path, as before.

create or replace function public.create_followup_draft(p_draft_id uuid, p_lead_id uuid, p_channel text, p_engine_version text, p_request_text text, p_result_text text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  l        public.leads;
  v_exist  public.followup_drafts;
  g        jsonb;
  v_stop   text;
  v_pver   uuid;
  pv       public.followup_policy_versions;
  v_req    jsonb;
  v_res    jsonb;
  v_built  jsonb;
  v_as     text;
  v_as_ts  timestamptz;
  v_hash   text;
  v_block  text;
  v_n      integer;
  v_code   text;
  v_body   text;
begin
  if v_uid is null or p_draft_id is null or p_lead_id is null then
    perform app.followup_deny();
  end if;
  select * into l from public.leads x where x.id = p_lead_id;
  if not found or not app.has_tenant_role(l.tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.followup_deny();
  end if;
  if p_channel is null or p_channel not in ('email', 'whatsapp') or p_engine_version is null or p_request_text is null or p_result_text is null
     or char_length(p_request_text) > 100000 or char_length(p_result_text) > 200000 or not app.text_is_clean(p_request_text) or not app.text_is_clean(p_result_text) then
    perform app.followup_error('invalid');
  end if;
  l := app.followup_lock(p_lead_id);

  -- a RETRY replays: the same draft id for the same tenant, lead and channel returns the stored draft (with the status it has reached since) and creates nothing, whatever `as_of`, history or result
  -- the retry carries (the request holds the API's clock in whole seconds, so a byte-for-byte comparison turned a retry a second later into a conflict). The same id under another tenant, lead or
  -- channel is still the constant conflict: one answer for all three, and it carries nothing of the other draft.
  select * into v_exist from public.followup_drafts d where d.id = p_draft_id;
  if found then
    if v_exist.tenant_id = l.tenant_id and v_exist.lead_id = l.id and v_exist.channel::text = p_channel then
      return jsonb_build_object('draft_id', v_exist.id, 'lead_id', l.id, 'touch_number', v_exist.touch_number, 'status', v_exist.status, 'replayed', true);
    end if;
    perform app.followup_error('conflict');
  end if;

  -- 1. the gate (suppression, erasure, keys, consent), then the stop (orders, a withdrawn quote, an archived lead), then the policy
  g := app.followup_gate(l.id, p_channel::public.consent_channel, true);
  if g ->> 'code' is not null then
    perform app.followup_error(g ->> 'code', g ->> 'detail');
  end if;
  v_stop := app.followup_stopped(l.id);
  if v_stop is not null then
    perform app.followup_error('SM227', v_stop);
  end if;
  v_pver := app.followup_active_policy_version(l.tenant_id, app.quote_today());
  if v_pver is null then
    perform app.followup_error('SM222');
  end if;
  select * into pv from public.followup_policy_versions x where x.id = v_pver;
  if not exists (select 1 from public.followup_engine_versions v where v.version = p_engine_version) then
    perform app.followup_error('value');
  end if;
  begin
    v_req := p_request_text::jsonb;
    v_res := p_result_text::jsonb;
  exception when others then
    perform app.followup_error('invalid');
  end;
  if jsonb_typeof(v_req) <> 'object' or jsonb_typeof(v_res) <> 'object' then
    perform app.followup_error('invalid');
  end if;

  -- 2. the request is the one the database builds from its own rows, as of the database's own clock
  v_as := v_req ->> 'as_of';
  if v_as is null or v_as !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' then
    perform app.followup_error('SM226');
  end if;
  begin
    v_as_ts := v_as::timestamptz;
  exception when others then
    perform app.followup_error('SM226');
  end;
  if v_as_ts < now() - interval '3 minutes' or v_as_ts > now() + interval '2 minutes' then
    perform app.followup_error('SM226');
  end if;
  v_built := app.followup_build(l.id, v_as, v_pver);
  if v_req is distinct from v_built then
    perform app.followup_error('SM226');
  end if;
  v_hash := app.followup_request_hash(p_engine_version, p_request_text);

  -- 3. the decision is the database's own: nothing is created unless the engine would answer draft_followup
  v_block := app.followup_blocker(v_req);
  if v_block is not null then
    perform app.followup_error('SM225', v_block);
  end if;
  select count(*) into v_n from public.lead_touches t where t.tenant_id = l.tenant_id and t.lead_id = l.id and t.direction = 'out';
  -- 4. the engine's result is exactly that decision
  if not app.followup_result_ok(v_req, v_res, p_engine_version, v_hash, v_n + 1) then
    perform app.followup_error('SM226');
  end if;
  if exists (select 1 from public.followup_drafts d where d.tenant_id = l.tenant_id and d.lead_id = l.id and d.touch_number = v_n + 1 and d.status in ('draft', 'approved')) then
    perform app.followup_error('SM223', 'exists');
  end if;

  v_code := app.followup_template_code(v_n + 1, pv.max_touches);
  select t.body into v_body from public.followup_templates t where t.code = v_code;
  insert into public.followup_drafts (id, tenant_id, lead_id, contact_id, touch_number, channel, template_code, body, policy_version_id, engine_version, request_text, result_text,
                                      canonical_hash, state_hash, as_of)
  values (p_draft_id, l.tenant_id, l.id, l.contact_id, v_n + 1, p_channel::public.consent_channel, v_code, v_body, v_pver, p_engine_version, p_request_text, p_result_text,
          v_hash, app.followup_state_hash(l.id, l.contact_id, p_channel, v_pver), v_as_ts);
  return jsonb_build_object('draft_id', p_draft_id, 'lead_id', l.id, 'touch_number', v_n + 1, 'status', 'draft', 'replayed', false);
end;
$$;
