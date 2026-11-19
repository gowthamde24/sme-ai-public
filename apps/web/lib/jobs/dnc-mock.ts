import type { DncEntry } from "./dnc";

/** JOBS=mock: the made-up Do-Not-Call list of the demo shop (the one in mocks/jobs, 08). Nothing leaves the server; adding or removing only changes the screen the person is on. */
const id = (n: number) => `77777777-7777-4777-8777-7777777777${String(n).padStart(2, "0")}`;
export const MOCK_DNC: readonly DncEntry[] = [
  { id: id(1), phoneMasked: "+91 98480 ••• 21", reason: "stop_whatsapp", at: "2026-11-12T08:10:00Z" },
  { id: id(2), phoneMasked: "+91 99890 ••• 07", reason: "asked_on_call", at: "2026-11-09T11:40:00Z" },
  { id: id(3), phoneMasked: "+91 90000 ••• 64", reason: "added_by_owner", at: "2026-11-02T05:05:00Z" },
  { id: id(4), phoneMasked: "+91 70937 ••• 18", reason: "stop_whatsapp", at: "2026-10-28T13:30:00Z" },
];
/** The mock shows 128 numbers in all (the mock's own count), the four above being the newest. */
export const MOCK_DNC_COUNT = 128;
