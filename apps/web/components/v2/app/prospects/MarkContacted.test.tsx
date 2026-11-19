import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { appDict } from "@/i18n/app";
import { parseProspect } from "@/lib/api/lead-finder";
import { P1, PROSPECT } from "@/lib/api/lead-finder-fixtures";

import { MarkContacted } from "./MarkContacted";
import { ProspectCards, type CardActions } from "./ProspectCards";

const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => /^(lf|apierr)\./.test(k)));
const fresh = parseProspect(PROSPECT);
const contacted = parseProspect({ ...PROSPECT, status: "contacted", last_contacted_at: "2026-11-18T09:30:00Z", contacted_by: "Ramesh", contact_note: "Spoke to the owner. Wants samples." });

describe("Mark as contacted", () => {
  it("opens a small form (when, note), sends the day and the trimmed note, then shows a solid Contacted chip with who, when and the note", async () => {
    const mark = vi.fn(async () => ({ ok: true as const, data: contacted }));
    render(<MarkContacted prospect={fresh} words={words} actions={{ mark }} />);
    expect(screen.queryByTestId("contacted")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mark as contacted" }));
    fireEvent.change(screen.getByLabelText("When"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Note (optional)"), { target: { value: "  Spoke to the owner. Wants samples.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mark).toHaveBeenCalledWith(P1, { daysAgo: 1, note: "Spoke to the owner. Wants samples." }));
    expect(await screen.findByText("Contacted · 18 Nov")).toBeInTheDocument();
    expect(screen.getByText("by Ramesh")).toBeInTheDocument();
    expect(screen.getByText("Spoke to the owner. Wants samples.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit note" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark as contacted" })).toBeNull();
  });
  it("a business that is already contacted shows its chip at once; Cancel closes the form without asking the API", () => {
    const mark = vi.fn();
    render(<MarkContacted prospect={contacted} words={words} actions={{ mark }} />);
    expect(screen.getByText("Contacted · 18 Nov")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit note" }));
    expect(screen.getByLabelText("Note (optional)")).toHaveValue("Spoke to the owner. Wants samples.");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Note (optional)")).toBeNull();
    expect(mark).not.toHaveBeenCalled();
  });
  it("a refusal says so in the form and shows no chip", async () => {
    const mark = vi.fn(async () => ({ ok: false as const, kind: "invalid" as const, error: "This business can’t be marked as contacted." }));
    render(<MarkContacted prospect={fresh} words={words} actions={{ mark }} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as contacted" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("can’t be marked");
    expect(document.querySelector('[data-chip="contacted"]')).toBeNull();
  });
  it("on the cards it is the third thing, beside Call from your phone and Plan a visit; no action, no button; a business already skipped for good has none", () => {
    const base = { act: vi.fn(), quoteDraft: vi.fn(), makeQuoteDraft: vi.fn(), planLikeThis: vi.fn(), approve: vi.fn(), cancel: vi.fn() } as unknown as CardActions;
    const { rerender } = render(<ProspectCards items={[fresh]} words={words} base="/app/tenants/t" canPractice canSearch langNames={{ en: "English", te: "తెలుగు" }} actions={base} />);
    expect(screen.queryByRole("button", { name: "Mark as contacted" })).toBeNull();
    rerender(<ProspectCards items={[fresh]} words={words} base="/app/tenants/t" canPractice canSearch langNames={{ en: "English", te: "తెలుగు" }} actions={{ ...base, mark: vi.fn() }} />);
    expect(screen.getByRole("button", { name: "Mark as contacted" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Plan a visit" })).toBeInTheDocument();
    rerender(<ProspectCards items={[{ ...fresh, suppressed: true }]} words={words} base="/app/tenants/t" canPractice canSearch langNames={{ en: "English", te: "తెలుగు" }} actions={{ ...base, mark: vi.fn() }} />);
    expect(screen.queryByRole("button", { name: "Mark as contacted" })).toBeNull();
  });
});

describe("the new fields", () => {
  it("parseProspect reads contacted_by and contact_note, and treats them as null from an older API", () => {
    expect(contacted.contactedBy).toBe("Ramesh");
    expect(contacted.contactNote).toBe("Spoke to the owner. Wants samples.");
    expect(fresh.contactedBy).toBeNull();
    expect(fresh.contactNote).toBeNull();
  });
});
