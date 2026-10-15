import { describe, expect, it } from "vitest";

import { bpsFromText, emptyForm, formFromPolicy, policyFromForm, type PolicyForm } from "./policy-logic";

const good = (over: Partial<PolicyForm> = {}): PolicyForm => ({ ...emptyForm(), ...over });

describe("percent text", () => {
  it.each([["5", 500], ["5%", 500], ["2.5", 250], ["18", 1800], ["0", 0], [" 12.75 ", 1275]])("%s is %i basis points", (t, bps) => expect(bpsFromText(t)).toBe(bps));
  it.each(["", "abc", "-5", "5.123", "101", "1e2"])("%j is refused", (t) => expect(bpsFromText(t)).toBeNull());
  it("a bound can be lower than a hundred percent", () => {
    expect(bpsFromText("50", 5000)).toBe(5000);
    expect(bpsFromText("50.01", 5000)).toBeNull();
  });
});

describe("the form becomes a policy", () => {
  it("the defaults are the engine's own (5 percent wastage, half advance, seven days, no freight)", () => {
    expect(policyFromForm(emptyForm())).toEqual({ ok: true, policy: { default_wastage_bps: 500, round_to_pallet: false, bill_wastage: true, advance_bps: 5000, credit_days: 0, validity_days: 7, rounding_mode: "half_up", transport: { kind: "none" } } });
  });
  it("freight per trip with a free-above amount, loading per trip and laying", () => {
    const r = policyFromForm(good({ transport: "per_trip", basis: "pieces", capacity: "2500", ratePerTrip: "3,500", transportGst: "18", freeAbove: "2,00,000", handling: "trip", handlingAmount: "500", handlingGst: "18", laying: true, layingRate: "12", layingGst: "18", roundPallet: true }));
    expect(r).toEqual({ ok: true, policy: expect.objectContaining({ round_to_pallet: true, transport: { kind: "per_trip", capacity_basis: "pieces", truck_capacity: 2500, rate_per_trip_paise: 350000, gst_bps: 1800, free_above_paise: 20000000 }, handling: { per: "trip", amount_paise: 50000, gst_bps: 1800 }, laying: { rate_paise_per_area: 1200, gst_bps: 1800 } }) });
  });
  it("freight by the kilometre needs rising slabs", () => {
    const slabs = [{ km: "10", charge: "2000" }, { km: "25", charge: "3000" }, { km: "", charge: "" }];
    const r = policyFromForm(good({ transport: "per_km_slab", basis: "area", capacity: "1500", transportGst: "5", slabs }));
    expect(r.ok && r.policy.transport).toEqual({ kind: "per_km_slab", capacity_basis: "area", truck_capacity: 1500, slabs: [{ up_to_km: 10, charge_paise: 200000 }, { up_to_km: 25, charge_paise: 300000 }], gst_bps: 500 });
    expect(policyFromForm(good({ transport: "per_km_slab", capacity: "1500", transportGst: "5", slabs: [{ km: "25", charge: "3000" }, { km: "10", charge: "2000" }] }))).toEqual({ ok: false, field: "slabs" });
    expect(policyFromForm(good({ transport: "per_km_slab", capacity: "1500", transportGst: "5", slabs: [{ km: "", charge: "" }] }))).toEqual({ ok: false, field: "slabs" });
  });
  it.each([
    [{ wastage: "60" }, "wastage"], [{ wastage: "x" }, "wastage"], [{ advance: "101" }, "advance"], [{ creditDays: "181" }, "creditDays"], [{ validityDays: "-1" }, "validityDays"],
    [{ transport: "per_trip" as const, capacity: "0", ratePerTrip: "1", transportGst: "18" }, "capacity"], [{ transport: "per_trip" as const, capacity: "5", ratePerTrip: "", transportGst: "18" }, "ratePerTrip"],
    [{ transport: "per_trip" as const, capacity: "5", ratePerTrip: "10", transportGst: "" }, "transportGst"], [{ handling: "order" as const, handlingAmount: "", handlingGst: "18" }, "handlingAmount"],
    [{ laying: true, layingRate: "12", layingGst: "" }, "layingGst"],
  ] as const)("a bad box is named: %j", (over, field) => expect(policyFromForm(good(over as Partial<PolicyForm>))).toEqual({ ok: false, field }));
});

describe("a policy becomes a form", () => {
  it("round-trips", () => {
    const form = good({ transport: "per_trip", basis: "pieces", capacity: "2500", ratePerTrip: "3500", transportGst: "18", handling: "order", handlingAmount: "750.50", handlingGst: "18", laying: true, layingRate: "12", layingGst: "18", wastage: "2.5", advance: "30", creditDays: "15", validityDays: "10", freeAbove: "100000" });
    const r = policyFromForm(form);
    expect(r.ok).toBe(true);
    if (r.ok) expect(formFromPolicy(r.policy)).toEqual({ ...form, slabs: [{ km: "", charge: "" }] });
  });
  it("no policy gives the defaults", () => expect(formFromPolicy(null)).toEqual(emptyForm()));
});
