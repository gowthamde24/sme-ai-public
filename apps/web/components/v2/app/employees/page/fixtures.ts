import { render } from "@testing-library/react";
import * as React from "react";
import { vi } from "vitest";

import { appDict } from "@/i18n/app";
import type { Done, Employee } from "@/lib/employees/types";

import type { CatalogueVoice, PageActions } from "./shared";
import { EmployeePage, type EmployeePageProps } from "./EmployeePage";

export const ID = "11111111-1111-4111-8111-111111111111";
export const BASE = "/app/tenants/t";
/** The real English words of the screen, as the page hands them down. */
export const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => /^(emp\.|vc\.|vt\.|outcome\.cat\.)/.test(k)));

export const employee = (over: Partial<Employee> = {}): Employee => ({
  id: ID,
  name: "Sunita",
  roleCode: "receptionist",
  roleTitle: "Showroom helper",
  status: "on",
  isDefault: false,
  responsibilities: ["enquiry_reply", "faq_answers"],
  extraInstructions: "Be kind.",
  languages: ["te", "en"],
  autoSwitchLanguage: true,
  allowEnglishMixing: true,
  style: "friendly",
  speed: 1,
  openingLine: { te: "నమస్కారం, నేను AI అసిస్టెంట్ ని." },
  autonomy: { mayAnswerPrices: true, mayBookVisits: false, maySendMedia: false, mayTalkDues: false, maxDiscountPercent: 5, handoverOwnerAsked: true, handoverUpset: true, handoverOrderAbovePaise: 5_000_000 },
  askFirst: ["send_message", "make_call"],
  hours: null,
  neverSay: ["free"],
  phoneNumberId: null,
  personaIn: "employee",
  voices: { te: "te_ramya", en: "en_riya" },
  callsToday: 3,
  channels: { phone: true, whatsapp: false, webChat: false },
  needs: [],
  ...over,
});
export const defaultEmployee = (over: Partial<Employee> = {}): Employee => employee({ id: "22222222-2222-4222-8222-222222222222", name: "Asha", isDefault: true, personaIn: "my_assistant", ...over });

export const catalogue: CatalogueVoice[] = [
  { id: "te_ramya", name: "Ramya", language: "te", gender: "female", recommended: true },
  { id: "te_kavitha", name: "Kavitha", language: "te", gender: "female", recommended: false },
  { id: "te_arun", name: "Arun", language: "te", gender: "male", recommended: false },
  { id: "en_riya", name: "Riya", language: "en", gender: "female", recommended: false },
];

export const baseProps = (over: Partial<EmployeePageProps> = {}): Omit<EmployeePageProps, "actions"> => ({
  employee: employee(),
  words,
  lang: "en",
  base: BASE,
  canEdit: true,
  initialTab: "overview",
  catalogue,
  sampleEndpoint: `${BASE}/voice-pick`,
  lines: [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", display: "+91 98765 43210" },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", display: "+91 98765 00000" },
  ],
  takenBy: { "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb": "Ravi" },
  ...over,
});

export const ok = <T,>(data: T): Done<T> => ({ ok: true, data });
/** The moves of the page as mocks that answer with an employee; a test reads the exact call. */
export function acts() {
  return {
    patch: vi.fn<PageActions["patch"]>(async () => ok(employee())),
    setStatus: vi.fn<PageActions["setStatus"]>(async (s) => ok(employee({ status: s }))),
    setVoice: vi.fn<PageActions["setVoice"]>(async () => ok(employee())),
    setPhone: vi.fn<PageActions["setPhone"]>(async () => ok(employee())),
    preview: vi.fn<PageActions["preview"]>(async () => ok({ spokenText: "x", mime: "audio/wav", base64: "UklGRg==", voiceId: "te_ramya" })),
    activity: vi.fn<PageActions["activity"]>(async () => ok([])),
  } satisfies PageActions;
}
export type Acts = ReturnType<typeof acts>;
export function show(over: Partial<EmployeePageProps> = {}, a: Acts = acts()) {
  const view = render(React.createElement(EmployeePage, { ...baseProps(over), actions: a }));
  return { a, ...view };
}
