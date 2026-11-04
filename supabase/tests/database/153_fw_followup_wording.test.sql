-- Follow-up wording for every business type (migration 20261228090000)
begin;
select plan(5);
select is((select count(*)::int from public.followup_templates), 3, 'the three closed wordings are still there (no code added or removed)');
select is((select count(*)::int from public.followup_templates where body ~* '(saree|sari\M|silk|pattu|cement|steel|paver|student|admission|fee)'), 0, 'no wording names a product or a school word');
select is((select count(*)::int from public.followup_templates where body like '%your enquiry%'), 3, 'each speaks of the enquiry, which every business type has');
select ok((select bool_and(app.text_is_clean(body) and not app.text_has_contact(body) and char_length(body) between 20 and 1000) from public.followup_templates), 'each still passes the table''s own checks');
select results_eq($$select app.followup_template_code(n, 4) from generate_series(1, 4) n$$, $$values ('followup_reminder'), ('followup_gentle'), ('followup_reminder'), ('followup_last')$$, 'the touch rule is unchanged');
select * from finish();
rollback;
