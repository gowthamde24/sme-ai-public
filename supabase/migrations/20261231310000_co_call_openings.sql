-- co: a line's opening, kept ready across restarts (owner, 6 Nov 2026: "Keeping the opening ready across restarts: yes ... stored in Supabase Storage ... re-render only when the opening text or
-- voice changes"). One private bucket, `call-openings`. A file is `<tenant id>/<sha256 of language, voice and wording>.pcm`: the 16-bit 24 kHz audio a REAL call spoke for that opening (so storing it
-- costs no extra voice characters); a new wording or voice is a new file. Only the telephony worker (the scheduler principal) reads and writes it; no client, no member, no public URL.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('call-openings', 'call-openings', false, 2097152, array['application/octet-stream'])
on conflict (id) do nothing;

-- the storage rules are evaluated as the caller, who must be able to run this (app.is_scheduler itself is not executable by clients)
create function app.call_openings_worker() returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select app.is_scheduler() $$;
revoke all on function app.call_openings_worker() from public;
grant execute on function app.call_openings_worker() to authenticated;

create policy call_openings_select on storage.objects for select to authenticated
  using (bucket_id = 'call-openings' and app.call_openings_worker());
create policy call_openings_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'call-openings' and app.call_openings_worker());
create policy call_openings_update on storage.objects for update to authenticated
  using (bucket_id = 'call-openings' and app.call_openings_worker())
  with check (bucket_id = 'call-openings' and app.call_openings_worker());
