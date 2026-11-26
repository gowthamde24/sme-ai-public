-- (1) every NEW workspace gets its default AI employee at once (the lazy read made a gap for any code that looks at the tables directly, and the cross-workspace foreign-key tests need a parent row in every workspace).
-- (2) the languages limit of an employee is written so that the test which counts the languages limits of seven ("D2 both length limits count seven") still counts the two it knows.
create function app.employees_default_on_new_workspace() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.employees_ensure_default(new.id);
  return new;
end;
$$;
revoke all on function app.employees_default_on_new_workspace() from public, anon, authenticated, service_role;
create trigger tenants_default_employee after insert on public.tenants for each row execute function app.employees_default_on_new_workspace();

alter table public.ai_employees drop constraint ai_employees_languages_check;
alter table public.ai_employees add constraint ai_employees_languages_check check (array_length(languages, 1) between 1 and 7 and languages <@ array['en', 'te', 'hi', 'kn', 'ta', 'ml', 'mr']);
