-- STAGING ONLY (owner decision, 15 Nov 2026). Never run this on production: production keeps the GUARD at 50,000 paise (Rs 500 a day, migration 20261104090000_ak2_cap_ceiling_500).
-- What it does: the soft daily AI allowance of the free_trial plan is the line where a workspace drops to Light mode. The database guard `plan_ai_allowances_daily_under_wall_chk` caps that line at Rs 500 a
-- day. For testing on staging the guard is raised to Rs 2,000 a day and free_trial is set to Rs 2,000 a day and Rs 10,000 a month, so tests always use the full assistant. The HARD cap per workspace
-- (tenant_agent_settings.daily_cost_cap_micros) is a different limit and is untouched. Run with the Supabase CLI linked to STAGING (ref uiallwgywitryxatcqxf): supabase db query --linked "<one block>".

-- ===== APPLY (one transaction) =====
begin;
alter table public.plan_ai_allowances drop constraint plan_ai_allowances_daily_under_wall_chk;
alter table public.plan_ai_allowances add constraint plan_ai_allowances_daily_under_wall_chk check (daily_paise <= 200000);
update public.plan_ai_allowances set daily_paise = 200000, monthly_paise = 1000000 where plan = 'free_trial';
commit;

-- ===== REVERT (one transaction; the values before the apply were 50000 / 1500000) =====
-- begin;
-- update public.plan_ai_allowances set daily_paise = 50000, monthly_paise = 1500000 where plan = 'free_trial';
-- alter table public.plan_ai_allowances drop constraint plan_ai_allowances_daily_under_wall_chk;
-- alter table public.plan_ai_allowances add constraint plan_ai_allowances_daily_under_wall_chk check (daily_paise <= 50000);
-- commit;

-- ===== BEFORE ANY MIGRATION THAT TOUCHES THE GUARD OR plan_ai_allowances: run the REVERT first, then the migration, then decide again. =====
