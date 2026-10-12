// (job CC: the integrations, privacy and team schemas hold tenant rows too: imports, calendar feeds, WhatsApp accounts, exports, invitations.)
// Removes what the real-stack run (be-stack.mjs) made: every workspace whose slug starts with "e2e-" and is named "E2E Silks ...", their rows in every tenant table, their catalogue bucket rows, and the throwaway accounts
// e2e-*@e2e.example.test. LOCAL database only (docker exec into the local container); nothing else is touched, so the owner's demo workspace is safe. A guard stops it if anything it would delete does not look like ours.
// Why SQL and not the app: the app never deletes a workspace (its audit trail and many tables are append-only on purpose), so this is the one place, and only for these throwaway workspaces, that switches the
// row guards off (session_replication_role = replica inside one transaction). The picture FILES of the bucket stay in the local Storage volume (Storage refuses to delete them from SQL); they are small and synthetic.
import "./be-env.mjs";
import { psql, dbContainer } from "./be-lib.mjs";
import { cleanupRefusal, hostsFromEnv } from "./cleanup-guard.mjs";

// The safety lock (job BF): this script switches row guards off, so it runs only against a database on THIS machine and only for workspaces whose slug starts with "e2e-".
const hosts = hostsFromEnv(process.env, dbContainer());
const fail = (why) => {
  console.error(`cleanup: REFUSED: ${why}.`);
  process.exit(2);
};
const hostProblem = cleanupRefusal({ hosts, slugs: [] }); // before any query at all
if (hostProblem) fail(hostProblem);
const named = psql("select coalesce(string_agg(slug, ','), '') from public.tenants where name like 'E2E Silks %'");
const slugProblem = cleanupRefusal({ hosts, slugs: named === "" ? [] : named.split(",") });
if (slugProblem) fail(slugProblem);

const found = psql("select count(*) || '|' || coalesce(string_agg(slug, ','), '') from public.tenants where slug like 'e2e-%' and name like 'E2E Silks %'");
const [count, slugs] = found.split("|");
const odd = psql("select count(*) from public.tenants where slug like 'e2e-%' and name not like 'E2E Silks %'");
if (odd !== "0") {
  console.error(`cleanup: ${odd} workspace(s) have a slug starting e2e- but another name; not touching anything.`);
  process.exit(2);
}
const users = psql("select count(*) from auth.users where email like 'e2e-%@e2e.example.test'");
console.log(`cleanup: ${count} e2e workspace(s) (${slugs || "none"}) and ${users} throwaway account(s)`);
if (count === "0" && users === "0") process.exit(0);

const sql = `
begin;
set local session_replication_role = replica;
do $$
declare v_ids uuid[]; v_users uuid[]; r record; n bigint; total bigint := 0;
begin
  select array_agg(t.id) into v_ids from public.tenants t where t.slug like 'e2e-%' and t.name like 'E2E Silks %';
  if exists (select 1 from public.tenants t where t.id = any (v_ids) and t.slug not like 'e2e-%') then raise exception 'cleanup: a workspace without the e2e- prefix is in the list'; end if;
  select array_agg(u.id) into v_users from auth.users u where u.email like 'e2e-%@e2e.example.test';
  if v_ids is not null then
    for r in
      select c.table_schema as s, c.table_name as t
        from information_schema.columns c
        join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
       where c.column_name = 'tenant_id' and c.table_schema in ('public', 'suppression', 'app', 'private', 'integrations', 'privacy', 'team')
       order by 1, 2
    loop
      execute format('delete from %I.%I where tenant_id = any($1)', r.s, r.t) using v_ids;
      get diagnostics n = row_count;
      total := total + n;
    end loop;
    delete from storage.objects where bucket_id = any (select 'cat-' || x::text from unnest(v_ids) x);
    delete from storage.buckets where id = any (select 'cat-' || x::text from unnest(v_ids) x);
    delete from public.tenants where id = any (v_ids);
  end if;
  if v_users is not null then
    delete from auth.mfa_challenges where factor_id in (select id from auth.mfa_factors where user_id = any (v_users));
    delete from auth.mfa_factors where user_id = any (v_users);
    delete from auth.one_time_tokens where user_id = any (v_users);
    delete from auth.refresh_tokens where user_id::text = any (select id::text from unnest(v_users) id);
    delete from auth.sessions where user_id = any (v_users);
    delete from auth.identities where user_id = any (v_users);
    delete from auth.users where id = any (v_users);
  end if;
  raise notice 'removed % rows in tenant tables', total;
end $$;
commit;`;
psql(sql);
const left = psql("select (select count(*) from public.tenants where slug like 'e2e-%') || '|' || (select count(*) from auth.users where email like 'e2e-%@e2e.example.test')");
console.log(`cleanup: left ${left} (workspaces|accounts)`);
process.exit(left === "0|0" ? 0 : 1);
