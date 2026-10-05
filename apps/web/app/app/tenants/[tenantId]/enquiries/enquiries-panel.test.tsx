import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ captureEnquiryAction: vi.fn(async () => undefined) }));

import { EnquiriesPanel } from "./enquiries-panel";

const TENANT = "22222222-2222-2222-2222-222222222222";
const LEAD = "33333333-3333-3333-3333-333333333333";
const FORM = "55555555-5555-4555-8555-555555555555";
const enquiry = (id: string, body: string) => ({
  id, lead_id: LEAD, company_id: null, contact_id: null, channel: "email" as const, received_at: "2026-10-05T10:00:00+00:00", subject: null, body,
  truncated_from: null, created_by: null, created_at: "2026-10-05T10:01:00+00:00", archived_at: null,
});

describe("EnquiriesPanel", () => {
  it("lists the enquiries as links to their own page and never shows the customer's text", () => {
    render(<EnquiriesPanel tenantId={TENANT} leadId={LEAD} enquiries={[enquiry("44444444-4444-4444-4444-444444444444", "SECRET customer words")]} canWrite formId={FORM} />);
    expect(screen.getByRole("link", { name: "E-mail enquiry" })).toHaveAttribute("href", `/app/tenants/${TENANT}/enquiries/44444444-4444-4444-4444-444444444444`);
    expect(screen.queryByText(/SECRET/)).toBeNull();
    expect(screen.getByText("Paste a new enquiry")).toBeInTheDocument();
  });

  it("a viewer sees the list and no paste form", () => {
    render(<EnquiriesPanel tenantId={TENANT} leadId={LEAD} enquiries={[]} canWrite={false} formId={FORM} />);
    expect(screen.getByText("No enquiries yet.")).toBeInTheDocument();
    expect(screen.queryByText("Paste a new enquiry")).toBeNull();
    expect(screen.getByText(/Only an owner, admin or sales user can paste/)).toBeInTheDocument();
  });

  it("an API failure shows an error in this section only, never placeholder data", () => {
    render(<EnquiriesPanel tenantId={TENANT} leadId={LEAD} enquiries={null} canWrite formId={FORM} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Could not load the enquiries/);
  });

  it("gives the paste form the page's own id", () => {
    render(<EnquiriesPanel tenantId={TENANT} leadId={LEAD} enquiries={[]} canWrite formId={FORM} />);
    expect((document.querySelector('input[name="enquiry_id"]') as HTMLInputElement).value).toBe(FORM);
  });
});
