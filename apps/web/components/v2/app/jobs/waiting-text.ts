import type { ApprovalKind } from "@/lib/jobs/plan";

import type { Say } from "../words";

/** The sentence of "Waiting for your OK" (`409 approval_needed`): the closed `approval.kind` says what waits ("Waiting for your OK: the offer"). Its own small file: the start page draws it without the rest of the plan's words (route-JS ceiling). */
export const waitingText = (t: Say, kind: ApprovalKind): string => t("jobs.new.waiting.kind", { what: t(`jobs.new.waiting.${kind}`) });
