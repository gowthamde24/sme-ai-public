import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieValues: Record<string, string> = {};
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name in cookieValues ? { name, value: cookieValues[name] } : undefined) }),
  headers: async () => ({ get: () => null }),
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/" }));
vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));

import SiteFirstPage, { generateMetadata as firstMetadata } from "./[first]/page";
import SiteSecondPage, { generateMetadata as secondMetadata } from "./[first]/[second]/page";
import { SITE_PACKS } from "@/lib/site/packs";

beforeEach(() => {
  for (const k of Object.keys(cookieValues)) delete cookieValues[k];
});
/** The route file returns the async <SiteRoute segments>; run it as Next does and give back the page element it makes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = async (el: any) => el.type(el.props);
const first = (v: string) => ({ params: Promise.resolve({ first: v }) });
const second = (a: string, b: string) => ({ params: Promise.resolve({ first: a, second: b }) });

describe("the public site's routes", () => {
  it("serve a language home, a fixed page and a business type's page in English, and the same with a language prefix", async () => {
    expect((await run(await SiteFirstPage(first("te")))).props).toMatchObject({ lang: "te", target: { kind: "home" } });
    expect((await run(await SiteFirstPage(first("pricing")))).props).toMatchObject({ lang: "en", target: { kind: "page", page: "pricing" } });
    expect((await run(await SiteSecondPage(second("hi", "security")))).props).toMatchObject({ lang: "hi", target: { kind: "page", page: "security" } });
    const slug = SITE_PACKS[0].slug;
    expect((await run(await SiteFirstPage(first(slug)))).props).toMatchObject({ lang: "en", target: { kind: "pack", slug } });
    expect((await run(await SiteSecondPage(second("kn", slug)))).props).toMatchObject({ lang: "kn", target: { kind: "pack", slug } });
  });
  it("answer 404 for anything else: an unknown word, 'en' as a prefix, a prefix on nothing, a business type that has no page", async () => {
    await expect(run(await SiteFirstPage(first("nonsense")))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(run(await SiteFirstPage(first("construction_materials")))).rejects.toThrow("NEXT_NOT_FOUND"); // the page's address is its slug, not the pack's id
    await expect(run(await SiteSecondPage(second("en", "pricing")))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(run(await SiteSecondPage(second("te", "nonsense")))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(run(await SiteSecondPage(second("pricing", "te")))).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it("tell the page whether our number is set up, and pass the two server actions", async () => {
    delete process.env.STACK19_WHATSAPP;
    expect((await run(await SiteFirstPage(first("contact")))).props.actions.chatAvailable).toBe(false);
    process.env.STACK19_WHATSAPP = "919876543210";
    const props = (await run(await SiteFirstPage(first("contact")))).props;
    delete process.env.STACK19_WHATSAPP;
    expect(props.actions.chatAvailable).toBe(true);
    expect(typeof props.actions.contactChat).toBe("function");
    expect(JSON.stringify(props)).not.toContain("919876543210"); // the number itself never goes to the page
  });
  it("give each page its own head: title, canonical, the other languages, a share picture (a business type's own), noindex until the switch is on", async () => {
    const slug = SITE_PACKS[0].slug;
    const m = await secondMetadata(second("te", slug));
    expect(m.alternates?.canonical).toBe(`/te/${slug}`);
    expect(m.alternates?.languages).toMatchObject({ "en-IN": `/${slug}`, "kn-IN": `/kn/${slug}`, "x-default": `/${slug}` });
    expect(JSON.stringify(m.openGraph)).toContain(`/og/og-${slug}-te.png`);
    expect(m.robots).toEqual({ index: false, follow: false });
    expect((await firstMetadata(first("pricing"))).title).toBeTruthy();
    expect(await firstMetadata(first("nonsense"))).toEqual({});
  });
});
