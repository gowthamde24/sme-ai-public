import type { Reply } from "../../cc/kit";
import type { DraftAnswer, OwnMessage, SubmitInput } from "@/lib/templates/types";
import type { Message } from "@/lib/templates/meta-checks";

/** What the builder may ask the server (already bound to the workspace by the page; server actions). null = the person only reads (Sales, Viewer). Nothing here reaches a customer: writing a draft sends nothing, and only `submit` goes to WhatsApp, with the person's two-step code. */
export type BuilderActions = {
  write: (text: string, previous: Message | null) => Promise<Reply<DraftAnswer>>;
  submit: (input: SubmitInput, code: string) => Promise<Reply<OwnMessage>>;
};

/** The "Your own messages" card's facts: the messages so far, whether the person has a two-step code set up, and whether the sheet runs on made-up data (JOBS=mock: nothing is sent or saved). */
export type OwnMessagesProps = { items: readonly OwnMessage[]; actions: BuilderActions | null; secondFactor: boolean; mock: boolean; securityHref: string; jobsHref: string; lang: string };
