-- ai_employee_voices gets a surrogate `id` like the other workspace tables (the export, the cross-workspace foreign-key tests and the registry address a row by it).
alter table public.ai_employee_voices add column id uuid not null default gen_random_uuid();
create unique index ai_employee_voices_id_key on public.ai_employee_voices (id);
comment on column public.ai_employee_voices.id is 'SAFE: a row id';
