-- Fix (C2, 29 Oct): the pack of a workspace says whether its business type SHIPS example data. `public.workspace_pack_get` hands the manifest out WITHOUT its `example_data` (the rows are only for the loader), and the API worked out
-- `has_example_data` from that manifest, so it was false for every type: no business type showed the "Try with example data" offer (the clean-up of 27 Oct, which hid the offer for types with nothing to load, hid it for all of them).
-- The function now says it itself: true when one of the lists of the pinned version's `example_data` holds a row. Nothing else changes (the rows are still not given out; grants are those of the function).
do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.workspace_pack_get(uuid)'::regprocedure);
  v_new := replace(v_def, '''manifest'', v.manifest - ''example_data'',',
                          '''manifest'', v.manifest - ''example_data'', ''has_example_data'', coalesce((select bool_or(case when jsonb_typeof(e.value) = ''array'' then jsonb_array_length(e.value) > 0 else false end) from jsonb_each(coalesce(v.manifest -> ''example_data'', ''{}''::jsonb)) e), false),');
  if v_new = v_def then raise exception 'packs_has_example_data: workspace_pack_get is not the function this migration expects'; end if;
  execute v_new;
end;
$$;
