/**
 * The Overview of the Developers page (owner, 29 Nov 2026; mock "Developers"): three steps and a first request in cURL, Node and Python. Developer-facing text, English by design (like an API page). The routes it names (`GET /me`, `POST /calls` with `dry_run`)
 * are C1's developer API v1; until they are live the page says so (the Overview marks the calls as "coming with the developer API"). Nothing here holds a secret.
 */
export const BASE_URL = "https://api.stack19.in/v1";
export const STEPS = [
  { title: "Make an API key", text: "Start with a test key. Test keys never call anyone.", tab: "keys" },
  { title: "Make your first request", text: "Ask who you are, then try a call with dry_run on: everything is checked and nobody is dialled.", tab: null },
  { title: "Get results by webhook", text: "Every call outcome, summary and the details it captured are sent to your address.", tab: "hooks" },
] as const;
export const LANGS = ["curl", "node", "python"] as const;
export type Lang = (typeof LANGS)[number];
export const isLang = (v: unknown): v is Lang => typeof v === "string" && (LANGS as readonly string[]).includes(v);
export const LABEL: Readonly<Record<Lang, string>> = { curl: "cURL", node: "Node", python: "Python" };
import samples from "./samples.json";

/** The first request in each language (a JSON file: the lines hold calls that a source scan must not mistake for code of the app). */
export const SAMPLE: Readonly<Record<Lang, string>> = samples as Record<Lang, string>;
