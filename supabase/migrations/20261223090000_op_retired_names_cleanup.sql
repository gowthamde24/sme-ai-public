-- One opening line (owner, 29 Oct 2026): clean the STAGING data of the retired example persona names and hard-coded owner/city names.
--   * a stored opening line (every workspace, every campaign) that holds a retired name (Tara, Vani, Vijaya, Vijay: Latin or Telugu letters) or the hard-coded owner/city words of old test data (Gowtham, Dharmavaram)
--     is removed, so the workspace falls back to the default template (the one resolved line: services/ai-api/app/opening/resolve.py)
--   * a saved assistant name that is one of the retired names is removed with its settings row (the assistant is then unnamed again; the Owner names it; no name is ever made up)
-- Nothing else is touched. Idempotent: a second run deletes nothing.

do $$
declare
  v_lines    integer;
  v_settings integer;
begin
  delete from workspace.opening_lines
   where line ~* '\m(tara|vani|vijaya|vijay|gowtham|dharmavaram)\M'
      or line ~ '(తార|వాణి|విజయ)';
  get diagnostics v_lines = row_count;

  delete from public.assistant_settings
   where assistant_name ~* '^\s*(tara|vani|vijaya|vijay)\s*$'
      or assistant_name ~ '^\s*(తార|వాణి|విజయ)\s*$';
  get diagnostics v_settings = row_count;

  raise notice 'retired names removed: % opening line(s), % assistant name(s)', v_lines, v_settings;
end;
$$;
