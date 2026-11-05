"use client";

import dynamic from "next/dynamic";

/**
 * The free-times picker, as a chunk of its own for Today: it is only drawn when the person presses "Change time" on a visit the assistant proposed, so Today's first load does not carry it (the route-JS budget,
 * scripts/audit-route-js.mjs). The Visits page imports the picker itself. Tests mock this module to the real component.
 */
export const SlotPicker = dynamic(() => import("./SlotPicker").then((m) => m.SlotPicker), { ssr: false });
