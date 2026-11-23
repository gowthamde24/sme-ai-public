-- "To you": the style the signed-in person wants THEIR OWN assistant to talk in with them (owner, 24 Nov 2026; docs/contracts/voice-styles.md section 1B).
-- It is a setting of one PERSON, not of a workspace: one row per user, read and written only by that person. It never changes what the assistant says to customers (that is the workspace's `tone`).
--
--   public.user_assistant_style                  private (no client grant): one row per person that chose; a person who never chose has no row
--   public.my_assistant_style_get()              {value, saved}: the person's own choice, or value null / saved false
--   public.my_assistant_style_set(p_style text)  one of the 7 style ids sets it, null clears it (back to the workspace default); returns the same shape
--
-- Personal data: a user id and a style word (a preference, no free text). It goes with the account (on delete cascade).

create table public.user_assistant_style (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  style      text not null check (style in ('friendly', 'respectful', 'quick', 'professional', 'calm_caring', 'cheerful', 'confident')),
  updated_at timestamptz not null default now()
);
alter table public.user_assistant_style enable row level security;
alter table public.user_assistant_style force row level security;
revoke all on public.user_assistant_style from public, anon, authenticated, service_role;
comment on table public.user_assistant_style is 'The style a person wants their own assistant to talk in with them (one row per person; written only by public.my_assistant_style_set for the caller themself). PERSONAL DATA: user id + a style word, erased with the account.';
comment on column public.user_assistant_style.style is 'SAFE: one of seven fixed style words; no free text.';

create function public.my_assistant_style_get() returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_style text;
begin
  if auth.uid() is null then
    perform app.privacy_error('deny');
  end if;
  select s.style into v_style from public.user_assistant_style s where s.user_id = auth.uid();
  return jsonb_build_object('value', v_style, 'saved', v_style is not null);
end;
$$;
revoke all on function public.my_assistant_style_get() from public, anon;
grant execute on function public.my_assistant_style_get() to authenticated;

create function public.my_assistant_style_set(p_style text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    perform app.privacy_error('deny');
  end if;
  if p_style is null then
    delete from public.user_assistant_style where user_id = auth.uid();
  else
    if p_style not in ('friendly', 'respectful', 'quick', 'professional', 'calm_caring', 'cheerful', 'confident') then
      perform app.privacy_error('invalid');
    end if;
    insert into public.user_assistant_style (user_id, style) values (auth.uid(), p_style)
      on conflict (user_id) do update set style = excluded.style, updated_at = now() where public.user_assistant_style.style is distinct from excluded.style;
  end if;
  return public.my_assistant_style_get();
end;
$$;
revoke all on function public.my_assistant_style_set(text) from public, anon;
grant execute on function public.my_assistant_style_set(text) to authenticated;
