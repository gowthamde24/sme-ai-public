-- Job CN (wave 2, C1, ADR 0085), migration 7 of 7: the company-scope erasure reaches the new places a customer's data lives. `app.erase_company` is REPLACED as a FULL COPY of job CA's definition plus the lines
-- that anonymise the customer's SITES (name, address, city, map pin, access notes) and the names of the people who received goods on its orders' trips (services/ai-api/tests/test_migration_copies_cn.py pins the
-- difference: exactly the lines named there). The tenant-wide erasure and the identifier sweep need no copy: they read the registry (migrations 2 and 6). Money tables hold no personal data and stay.

create or replace function app.erase_company(r public.erasure_requests) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  co public.companies;
  v_counts jsonb := '{}'::jsonb;
  v_patterns text[];
  v_name text;
  v_leads text;
  v_claims text;
  v_evidence text;
  v_enq text;
  v_fields text;
  v_sites text;
  v_pods text;
  v_keys constant text[] := array['name', 'website', 'city', 'region'];
  sw record;
  d record;
  n bigint;
begin
  select * into co from public.companies where id = r.subject_id and tenant_id = r.tenant_id for update;
  if not found then
    perform app.erasure_state_error('reference');
  end if;
  if co.erased_at is not null then
    return jsonb_build_object('counts', v_counts, 'review', '[]'::jsonb, 'review_truncated', false);
  end if;

  v_patterns := array_remove(array[app.erasure_host_pattern(co.website)], null);
  v_name := app.erasure_name(co.name);

  -- row selectors, over the alias t of the table being changed
  v_leads := format('t.company_id = %L', co.id);
  v_claims := format('(t.company_id = %1$L or t.lead_id in (select l.id from public.leads l where l.tenant_id = t.tenant_id and l.company_id = %1$L))', co.id);
  v_evidence := format($f$t.id in (select k.evidence_id from public.evidence_links k where k.tenant_id = t.tenant_id and (
      k.company_id = %1$L
      or k.lead_id in (select l.id from public.leads l where l.tenant_id = t.tenant_id and l.company_id = %1$L)
      or k.claim_id in (select c.id from public.claims c where c.tenant_id = t.tenant_id and (
           c.company_id = %1$L or c.lead_id in (select l.id from public.leads l where l.tenant_id = t.tenant_id and l.company_id = %1$L)))))$f$, co.id);

  v_counts := app.erasure_add(v_counts, 'evidence.url',       app.erase_column(r.tenant_id, 'company', 'evidence', 'url',       v_evidence));
  v_counts := app.erasure_add(v_counts, 'evidence.reference', app.erase_column(r.tenant_id, 'company', 'evidence', 'reference', v_evidence));
  v_counts := app.erasure_add(v_counts, 'evidence.snippet',   app.erase_column(r.tenant_id, 'company', 'evidence', 'snippet',   v_evidence));
  v_counts := app.erasure_add(v_counts, 'claims.value',       app.erase_column(r.tenant_id, 'company', 'claims', 'value',       v_claims));
  v_counts := app.erasure_add(v_counts, 'leads.source',              app.erase_column(r.tenant_id, 'company', 'leads', 'source',              v_leads));
  v_counts := app.erasure_add(v_counts, 'leads.disqualified_reason', app.erase_column(r.tenant_id, 'company', 'leads', 'disqualified_reason', v_leads));
  v_counts := app.erasure_add(v_counts, 'opportunities.title',       app.erase_column(r.tenant_id, 'company', 'opportunities', 'title',       v_leads));
  v_counts := app.erasure_add(v_counts, 'opportunities.lost_reason', app.erase_column(r.tenant_id, 'company', 'opportunities', 'lost_reason', v_leads));

  -- T008: the enquiries of this company's leads, and what was extracted from them
  v_enq := format('(%1$s.company_id = %2$L or %1$s.lead_id in (select l.id from public.leads l where l.tenant_id = %1$s.tenant_id and l.company_id = %2$L))', 't', co.id);
  v_fields := format('t.requirement_id in (select q.id from public.requirements q join public.enquiries e on e.tenant_id = q.tenant_id and e.id = q.enquiry_id where q.tenant_id = t.tenant_id and %s)',
                     format('(%1$s.company_id = %2$L or %1$s.lead_id in (select l.id from public.leads l where l.tenant_id = %1$s.tenant_id and l.company_id = %2$L))', 'e', co.id));
  v_counts := app.erasure_add(v_counts, 'enquiries.subject',          app.erase_column(r.tenant_id, 'company', 'enquiries', 'subject', v_enq));
  v_counts := app.erasure_add(v_counts, 'enquiries.body',             app.erase_column(r.tenant_id, 'company', 'enquiries', 'body', v_enq));
  v_counts := app.erasure_add(v_counts, 'requirement_fields.quote',      app.erase_column(r.tenant_id, 'company', 'requirement_fields', 'quote', v_fields));
  v_counts := app.erasure_add(v_counts, 'requirement_fields.value_text', app.erase_column(r.tenant_id, 'company', 'requirement_fields', 'value_text', v_fields));

  -- job AT: the messages written to this company's leads, and the call requests about them
  v_counts := app.erasure_add(v_counts, 'outbox_messages.body',      app.erase_column(r.tenant_id, 'company', 'outbox_messages', 'body', v_enq));
  v_counts := app.erasure_add(v_counts, 'outbox_messages.gloss_en',  app.erase_column(r.tenant_id, 'company', 'outbox_messages', 'gloss_en', v_enq));
  v_counts := app.erasure_add(v_counts, 'call_requests.reason',        app.erase_column(r.tenant_id, 'company', 'call_requests', 'reason', v_enq));
  v_counts := app.erasure_add(v_counts, 'call_requests.script_draft',  app.erase_column(r.tenant_id, 'company', 'call_requests', 'script_draft', v_enq));
  v_counts := app.erasure_add(v_counts, 'call_requests.decision_note', app.erase_column(r.tenant_id, 'company', 'call_requests', 'decision_note', v_enq));

  -- job AS: the store visits of this person's leads (what the visit was for, the note, why it was cancelled)
  v_counts := app.erasure_add(v_counts, 'store_visits.purpose', app.erase_column(r.tenant_id, 'company', 'store_visits', 'purpose', v_enq));
  v_counts := app.erasure_add(v_counts, 'store_visits.note', app.erase_column(r.tenant_id, 'company', 'store_visits', 'note', v_enq));
  v_counts := app.erasure_add(v_counts, 'store_visits.cancel_reason', app.erase_column(r.tenant_id, 'company', 'store_visits', 'cancel_reason', v_enq));

  -- job CN: the sites of this company (the address, the map pin, the access notes ...) and the names of the people who received goods on its orders' trips
  v_sites := format('t.company_id = %L', co.id);
  v_pods := format('t.trip_id in (select x.id from public.delivery_trips x join public.orders o on o.tenant_id = x.tenant_id and o.id = x.order_id where x.tenant_id = t.tenant_id and o.lead_id in (select l.id from public.leads l where l.tenant_id = t.tenant_id and l.company_id = %L))', co.id);
  v_counts := app.erasure_add(v_counts, 'customer_sites.name',         app.erase_column(r.tenant_id, 'company', 'customer_sites', 'name',         v_sites));
  v_counts := app.erasure_add(v_counts, 'customer_sites.address_line', app.erase_column(r.tenant_id, 'company', 'customer_sites', 'address_line', v_sites));
  v_counts := app.erasure_add(v_counts, 'customer_sites.city',         app.erase_column(r.tenant_id, 'company', 'customer_sites', 'city',         v_sites));
  v_counts := app.erasure_add(v_counts, 'customer_sites.map_lat',      app.erase_column(r.tenant_id, 'company', 'customer_sites', 'map_lat',      v_sites));
  v_counts := app.erasure_add(v_counts, 'customer_sites.map_lng',      app.erase_column(r.tenant_id, 'company', 'customer_sites', 'map_lng',      v_sites));
  v_counts := app.erasure_add(v_counts, 'customer_sites.access_notes', app.erase_column(r.tenant_id, 'company', 'customer_sites', 'access_notes', v_sites));
  v_counts := app.erasure_add(v_counts, 'delivery_proofs.received_by', app.erase_column(r.tenant_id, 'company', 'delivery_proofs', 'received_by', v_pods));

  v_counts := app.erasure_add(v_counts, 'companies.name',    app.erase_column(r.tenant_id, 'company', 'companies', 'name',    format('t.id = %L', co.id)));
  v_counts := app.erasure_add(v_counts, 'companies.website', app.erase_column(r.tenant_id, 'company', 'companies', 'website', format('t.id = %L', co.id)));
  v_counts := app.erasure_add(v_counts, 'companies.city',    app.erase_column(r.tenant_id, 'company', 'companies', 'city',    format('t.id = %L', co.id)));
  v_counts := app.erasure_add(v_counts, 'companies.region',  app.erase_column(r.tenant_id, 'company', 'companies', 'region',  format('t.id = %L', co.id)));
  v_counts := app.erasure_add(v_counts, 'companies.tags',    app.erase_column(r.tenant_id, 'company', 'companies', 'tags',    format('t.id = %L', co.id)));
  v_counts := app.erasure_add(v_counts, 'companies.gstin',   app.erase_column(r.tenant_id, 'company', 'companies', 'gstin',   format('t.id = %L', co.id)));
  update public.companies set erased_at = now(), archived_at = coalesce(archived_at, now()) where id = co.id;

  -- audit rows written before the four identity columns were classified PII carry their values: remove those KEYS (nothing else)
  update public.audit_events a
     set old_values = a.old_values - v_keys, new_values = a.new_values - v_keys
   where a.tenant_id = r.tenant_id and a.entity_type = 'company' and a.entity_id = co.id
     and (a.old_values ?| v_keys or a.new_values ?| v_keys);
  get diagnostics n = row_count;
  v_counts := app.erasure_add(v_counts, 'audit_events.values', n);

  select * into sw from app.erasure_sweep(r.tenant_id, v_patterns, v_name);
  for d in select key, value from jsonb_each_text(sw.o_counts) loop
    v_counts := app.erasure_add(v_counts, d.key, d.value::bigint);
  end loop;
  return jsonb_build_object('counts', v_counts, 'review', sw.o_review, 'review_truncated', sw.o_truncated);
end;
$$;
