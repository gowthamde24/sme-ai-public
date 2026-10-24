import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { billedText, QuoteFigures } from "./QuoteFigures";
import type { FigureLine, Figures } from "./figures";
import { WORDS } from "./mat-test-kit";

const LINE: FigureLine = { name: "Paver block 80 mm", soldPer: "sq_ft", areaX100: 100000, areaUnit: "sq_ft", pieces: 4725, pallets: 10, deliveredAreaX100: 105000, billedQuantity: 105000, unitPricePaise: 6500, gstBps: 1800, materialPaise: 6825000, taxPaise: 1228500 };
const FIGURES: Figures = { lines: [LINE], trips: 2, materialPaise: 6825000, transportPaise: 700000, handlingPaise: 0, layingPaise: 0, taxPaise: 1354500, totalPaise: 8879500, advancePaise: 4439750, balancePaise: 4439750, balanceOn: "delivery", creditDays: 0, dueDate: null, validUntil: "2026-11-01", flags: [], rangeLowPaise: null, rangeHighPaise: null };

describe("the quantity on a quote line (job DF: staging showed 1,05,000 sq ft for 1,050 sq ft)", () => {
  it("a product sold by area shows the billed area in whole units, not in hundredths", () => {
    expect(billedText(LINE)).toBe("1,050");
    expect(billedText({ ...LINE, soldPer: "sq_m", billedQuantity: 99950, deliveredAreaX100: 99950 })).toBe("999.5");
    expect(billedText({ ...LINE, billedQuantity: 100000 })).toBe("1,000"); // area billed without the wastage
  });
  it("a product sold by the piece, the bag or the tonne shows the whole number", () => {
    expect(billedText({ soldPer: "piece", billedQuantity: 4725, deliveredAreaX100: 105000 })).toBe("4,725");
    expect(billedText({ soldPer: "bag", billedQuantity: 120, deliveredAreaX100: null })).toBe("120");
    expect(billedText({ soldPer: "sq_ft", billedQuantity: 300, deliveredAreaX100: null })).toBe("300"); // sold by area but entered as a plain quantity: the engine billed whole units
  });
  it("the table row reads 1,050 sq ft at ₹65.00 = ₹68,250.00, and 1,05,000 appears nowhere", () => {
    render(<QuoteFigures figures={FIGURES} words={WORDS} />);
    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByText(/1,050 sq ft/)).toBeInTheDocument();
    expect(within(row).getByText("₹65.00")).toBeInTheDocument();
    expect(within(row).getByText("₹68,250.00")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("1,05,000");
  });
});
