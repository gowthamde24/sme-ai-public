import { parseJobDetail, parseSays } from "@/lib/api/jobs-parse";

import type { JobDetail, JobSays } from "./detail";
import { MOCK_BUSINESS, composeSays, wireJobDetail } from "./fixtures";

/**
 * JOBS=mock: the made-up pages of the demo shop's jobs (Neelambari Silks), the ones in mocks/jobs sheets 04 and 09. Nothing is sent or stored: a change only changes the screen the person is on. The page is built in the contract's wire shape
 * (lib/jobs/fixtures.ts) and read by the REAL parser, so it can never show a shape the API does not send.
 */
export { MOCK_BUSINESS };

/** What a customer hears or reads, in the words the API would compose (the job's name and "the AI assistant of {business}" are always there). */
export const mockSays = (kind: string, name: string | null): JobSays[] => parseSays(composeSays(kind, name, MOCK_BUSINESS));

/** The made-up page of one job; null for an id that is not one of the mock jobs. */
export function mockJobDetail(jobId: string, now: number = Date.now()): JobDetail | null {
  const wire = wireJobDetail(jobId, now);
  return wire ? parseJobDetail(wire) : null;
}
