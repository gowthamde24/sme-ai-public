import { parseDncEntry } from "@/lib/api/do-not-call-parse";

import { MOCK_DNC_COUNT, WIRE_DNC, WIRE_DNC_LIFTED } from "./fixtures";
import type { DncEntry } from "./dnc";

/** JOBS=mock: the made-up Do-Not-Call list of the demo shop (the one in mocks/jobs, 08): the fixtures (lib/jobs/fixtures.ts, the contract's wire shape) run through the REAL parser. Nothing leaves the server; adding or removing only changes the screen the person is on. */
export const MOCK_DNC: readonly DncEntry[] = WIRE_DNC.map(parseDncEntry);
/** The numbers that came off the list (`?include=lifted`): they are not on the list any more and are never in `MOCK_DNC`. */
export const MOCK_DNC_LIFTED: readonly DncEntry[] = WIRE_DNC_LIFTED.map(parseDncEntry);
/** The mock shows 128 numbers in all (the mock's own count), the ones above being the newest. */
export { MOCK_DNC_COUNT };
