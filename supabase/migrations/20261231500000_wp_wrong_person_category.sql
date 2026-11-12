-- A call that reaches someone the goal does not allow to hear its subject (a pushy uncle where only a parent may hear) is "wrong_person", not "not_interested" (owner, 12 Nov 2026).
-- phone_calls.category is a closed word list (CHECK); phone_call_finish relies on that CHECK, so a call finished with the new word would be refused until this is applied: apply the migration BEFORE the API that can write it.
-- Append-only: the constraint is dropped and added again with one more word. Existing rows are untouched.
alter table public.phone_calls drop constraint phone_calls_category_check;
alter table public.phone_calls add constraint phone_calls_category_check
  check (category in ('interested', 'visit_booked', 'order_likely', 'not_interested', 'wrong_number', 'wrong_person', 'too_costly', 'call_back_later', 'already_bought', 'do_not_call'));
comment on column public.phone_calls.category is 'SAFE: a closed word. wrong_number = the number belongs to someone else; wrong_person = the right number, but the person reached may not hear the subject of the call. CLEAN-EXEMPT: closed CHECK list';
