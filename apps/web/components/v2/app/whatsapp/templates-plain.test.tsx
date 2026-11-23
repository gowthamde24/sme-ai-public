import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { wordsFor } from "@/i18n/app-words";
import type { Template } from "@/lib/api/whatsapp";

import { TemplatesList } from "./TemplatesList";

afterEach(cleanup);
const WORDS = wordsFor("en", ["wa.", "apierr.", "problem.", "today.lang."], ["dta.btn.working"]);
const tpl = (id: string, name: string, language: string, status: Template["status"]): Template => ({ id, name, language, purpose: "followup", status }) as Template;
const ITEMS = [tpl("1", "lead_ack", "en", "draft"), tpl("2", "lead_ack", "te", "draft"), tpl("3", "visit_reminder", "en", "submitted"), tpl("4", "missed_call_followup", "en", "approved")];
const actions = { submitDrafts: vi.fn(), submitOne: vi.fn(), sync: vi.fn() } as never;

describe("Messages we send as plain rows (TEMPLATES_PLAIN)", () => {
  it("one row per message with a plain name, its languages and ONE status in words; no technical name, no table", () => {
    const { container } = render(<TemplatesList plain words={WORDS} items={ITEMS} actions={actions} />);
    expect(container.querySelector("table")).toBeNull();
    const rows = [...container.querySelectorAll("[data-template]")] as HTMLElement[];
    expect(rows.map((r) => r.getAttribute("data-template"))).toEqual(["lead_ack", "visit_reminder", "missed_call_followup"]);
    expect(within(rows[0]).getByText("Thanks for your enquiry")).toBeInTheDocument();
    expect(within(rows[0]).getByText("English · Telugu")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Not sent yet")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Waiting for WhatsApp")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Missed call followup")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Approved")).toBeInTheDocument();
    expect(screen.queryByText("lead_ack")).toBeNull();
  });
  it("has ONE main button, 'Send all for approval', waking only while something is a draft", () => {
    render(<TemplatesList plain words={WORDS} items={ITEMS} actions={actions} />);
    expect(screen.getByRole("button", { name: "Send all for approval" })).toBeEnabled();
    cleanup();
    render(<TemplatesList plain words={WORDS} items={[tpl("4", "lead_ack", "en", "approved")]} actions={actions} />);
    expect(screen.getByRole("button", { name: "Send all for approval" })).toBeDisabled();
  });
});
