import type { Reply } from "../../cc/kit";
import type { NewJobActions } from "../NewJob";
import type { SheetLoad } from "@/lib/jobs/templates";

/** What the New job sheet calls: the same plan, start and test as the Start a job page (typing and a card end in the very same `start`), and one read for the ideas (null = none yet: the box still works). */
export type SheetActions = Pick<NewJobActions, "plan" | "start" | "test"> & { load: () => Promise<Reply<SheetLoad | null>> };
