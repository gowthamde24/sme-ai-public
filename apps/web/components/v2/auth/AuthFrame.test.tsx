import fs from "node:fs";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const jarValues: Record<string, string> = {};
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name in jarValues ? { name, value: jarValues[name] } : undefined) }),
}));
vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AuthFrame } from "@/components/v2/auth/AuthFrame";
import { authDict } from "@/i18n/auth";
import { LANGS } from "@/i18n/lang";

import AuthLayout, { metadata as authMetadata } from "@/app/auth/layout";
import LoginLayout, { metadata as loginMetadata } from "@/app/login/layout";

beforeEach(() => {
  for (const k of Object.keys(jarValues)) delete jarValues[k];
});

const PAGE = <main id="main"><h1>Page heading</h1><form action="/x"><button type="submit">Go</button></form></main>;
const html = async (node = PAGE) => renderToStaticMarkup(await AuthFrame({ children: node }));
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("AuthFrame", () => {
  it.each(LANGS)("%s: the chrome words are in that language and the wrapper carries it", async (lang) => {
    jarValues.sme_lang = lang;
    const out = await html();
    const d = authDict(lang);
    for (const k of ["skip", "home", "side.title", "side.d", "side.note"] as const) expect(out, `${lang} ${k}`).toContain(d[k].replace(/&/g, "&amp;"));
    expect(out).toMatch(new RegExp(`<div[^>]*data-ui="v2"[^>]*lang="${lang}"|<div[^>]*lang="${lang}"[^>]*data-ui="v2"`));
    expect(out).toContain(d["lang.label"]);
  });
  it("English is the default and an out-of-list cookie is ignored", async () => {
    jarValues.sme_lang = "fr; Path=/";
    jarValues.sme_theme = "<script>";
    const out = await html();
    expect(out).toMatch(/data-ui="v2"[^>]*lang="en"|lang="en"[^>]*data-ui="v2"/);
    expect(out).not.toContain("<script>");
    expect(out).not.toMatch(/data-theme/);
  });
  it("a saved theme is on the wrapper", async () => {
    jarValues.sme_theme = "dark";
    expect(await html()).toMatch(/data-theme="dark"/);
  });
  it("puts the page in an English region and keeps its single main and h1", async () => {
    jarValues.sme_lang = "te";
    const out = await html();
    expect(out).toMatch(/<div lang="en"><main id="main"><h1>Page heading<\/h1>/);
    expect(count(out, /<main[\s>]/g)).toBe(1);
    expect(count(out, /<h1[\s>]/g)).toBe(1);
  });
  it("adds no <form> and no <main> of its own, and exactly one skip link", async () => {
    const out = await html(<p>just text</p>);
    expect(count(out, /<form[\s>]/g)).toBe(0);
    expect(count(out, /<main[\s>]/g)).toBe(0);
    expect(count(out, /<h1[\s>]/g)).toBe(0);
    expect(count(out, /<a [^>]*href="#main"/g)).toBe(1);
  });
  it("has the language select, the theme button, the wordmark link home, and the way back", async () => {
    const out = await html();
    expect(count(out, /<select[\s>]/g)).toBe(1);
    expect(out).toMatch(/aria-label="Switch to dark mode"|Switch to dark mode/);
    expect(count(out, /<a [^>]*href="\/"/g)).toBe(2); // wordmark and "Back to the home page"
    expect(out).toContain("Back to the home page");
  });
});

describe("the two route layouts", () => {
  it.each([
    ["app/auth/layout.tsx", AuthLayout, authMetadata],
    ["app/login/layout.tsx", LoginLayout, loginMetadata],
  ])("%s renders the frame around its children and asks not to be indexed", async (_file, Layout, metadata) => {
    const element = Layout({ children: PAGE });
    const out = renderToStaticMarkup(await (element.type as typeof AuthFrame)(element.props));
    expect(out).toContain("Page heading");
    expect(out).toMatch(/data-ui="v2"/);
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(Object.keys(metadata)).toEqual(["robots"]); // no title: the pages' own titles are untouched
  });
  it.each(["app/auth/layout.tsx", "app/login/layout.tsx"])("%s imports only next types, react types and the frame (no session, no auth, no lib)", (file) => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../..", file), "utf8");
    const imports = [...src.matchAll(/^import .* from "([^"]+)";/gm)].map((m) => m[1]).sort();
    expect(imports).toEqual(["@/components/v2/auth/AuthFrame", "next", "react"]);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); // comments may say what the file does not do
    expect(code).not.toMatch(/redirect|requireUser|supabase|"use server"|fetch\(|cookies/);
  });
});
