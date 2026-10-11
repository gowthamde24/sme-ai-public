import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { cleanupRefusal, hostOf, hostsFromEnv, isLocalDatabaseHost } from "../../../e2e/cleanup-guard.mjs";

const LOCAL = ["http://127.0.0.1:54321", "postgresql://postgres:pw@localhost:54322/postgres", "supabase_db_sme-ai", "host.docker.internal", "::1", "[::1]:5432"];

describe("e2e clean-up safety lock (job BF): the host", () => {
  it.each(LOCAL)("%s is this machine", (h) => expect(isLocalDatabaseHost(h)).toBe(true));
  it.each([
    "https://abcdefgh.supabase.co",
    "postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres",
    "aws-0-ap-south-1.pooler.supabase.com",
    "10.0.0.5",
    "192.168.1.20:5432",
    "localhost.example.com", // a look-alike
    "127.0.0.1.example.com",
    "evil-localhost",
    "supabase_db_x.example.com:5432",
    "",
    "   ",
  ])("%s is not", (h) => expect(isLocalDatabaseHost(h)).toBe(false));
  it("reads the host out of a URL, a host:port and a bare name", () => {
    expect(hostOf("postgresql://u:p@LocalHost:5432/db")).toBe("localhost");
    expect(hostOf("127.0.0.1:54322")).toBe("127.0.0.1");
    expect(hostOf("[::1]:54322")).toBe("::1");
    expect(hostOf(undefined)).toBeNull();
  });
});

describe("e2e clean-up safety lock: the refusal", () => {
  const ok = { hosts: ["http://127.0.0.1:54321", "supabase_db_sme-ai"], slugs: ["e2e-abc", "e2e-def"] };
  it("runs on a local database for e2e- workspaces, and when there is nothing to delete", () => {
    expect(cleanupRefusal(ok)).toBeNull();
    expect(cleanupRefusal({ ...ok, slugs: [] })).toBeNull();
  });
  it("refuses when ANY database address is not local, even if the others are", () => {
    for (const away of ["https://abcdefgh.supabase.co", "postgresql://u:p@db.example.com/postgres", "10.1.2.3"]) {
      const why = cleanupRefusal({ ...ok, hosts: [...ok.hosts, away] });
      expect(why).toMatch(/is not this machine/);
      expect(why).toMatch(/nothing is deleted/);
    }
  });
  it("refuses when no database address is known", () => {
    expect(cleanupRefusal({ hosts: [], slugs: ["e2e-a"] })).toMatch(/cannot tell which database/);
    expect(cleanupRefusal({ hosts: ["", "  "], slugs: [] })).toMatch(/cannot tell which database/);
  });
  it("refuses a workspace whose slug does not start with e2e-, even among good ones", () => {
    for (const bad of ["demo", "silks-demo", "E2E-abc", "xe2e-abc", "", "e2e"]) {
      expect(cleanupRefusal({ ...ok, slugs: ["e2e-a", bad] })).toMatch(/does not start with "e2e-"/);
    }
  });
  it("collects the addresses from the environment and adds the container", () => {
    const env = { SUPABASE_URL: "http://127.0.0.1:54321", PGHOST: "db.prod.example.com", PATH: "/bin", E2E_DB_HOST: "" };
    expect(hostsFromEnv(env, "supabase_db_sme-ai")).toEqual(["http://127.0.0.1:54321", "db.prod.example.com", "supabase_db_sme-ai"]);
    expect(cleanupRefusal({ hosts: hostsFromEnv(env, "supabase_db_sme-ai"), slugs: ["e2e-a"] })).toMatch(/db\.prod\.example\.com/);
    expect(cleanupRefusal({ hosts: hostsFromEnv({ SUPABASE_URL: "http://localhost:54321" }, "supabase_db_sme-ai"), slugs: ["e2e-a"] })).toBeNull();
  });
});

describe("e2e clean-up script: the lock is wired in before any deletion", () => {
  const src = readFileSync(path.resolve(import.meta.dirname, "../../../e2e/cleanup-be.mjs"), "utf8");
  it("checks the host before the first query, the slugs before the delete, and the SQL re-checks the prefix", () => {
    const host = src.indexOf("cleanupRefusal({ hosts, slugs: [] })");
    const firstQuery = src.indexOf("psql(");
    const slugs = src.indexOf("slugProblem");
    const del = src.indexOf("delete from %I.%I");
    expect(host).toBeGreaterThan(-1);
    expect(host).toBeLessThan(firstQuery);
    expect(slugs).toBeLessThan(del);
    expect(src).toMatch(/slug not like 'e2e-%'\) then raise exception/);
    expect(src).toMatch(/process\.exit\(2\)/);
  });
});
