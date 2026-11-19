import { parseJob, parseJobsToday } from "@/lib/api/jobs-parse";

import { WIRE_JOBS, wireToday } from "./fixtures";
import type { Job, TodayJobs } from "./types";

/** JOBS=mock: the made-up jobs of the demo shop (Neelambari Silks), the ones in mocks/jobs: the fixtures (lib/jobs/fixtures.ts, the contract's wire shape) run through the REAL parser. Nothing is sent or stored by them; a switch only changes the screen the person is on. */
export const MOCK_JOBS: readonly Job[] = WIRE_JOBS.map(parseJob);

/** `GET /jobs/today` in the mock: the same jobs, what waits for the owner and the main assistant's name. */
export const mockToday = (): TodayJobs => parseJobsToday(wireToday());
