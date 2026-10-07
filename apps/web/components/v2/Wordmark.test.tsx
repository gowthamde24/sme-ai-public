import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/design/brand", () => ({ BRAND_NAME: "Rename Test (working name)", BRAND_TEXT: "Rename Test (working name)" }));

import { Wordmark } from "@/components/v2/Wordmark";

describe("Wordmark", () => {
  it("renders the name from the one constant, split at the working-name tail", () => {
    render(<Wordmark />);
    expect(screen.getByText(/^Rename Test/).textContent).toBe("Rename Test.");
    expect(screen.getByText("(working name)")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/sme-?ai/i);
  });
});
