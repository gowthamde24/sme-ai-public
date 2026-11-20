/** The shapes of the home page's demo conversations and the speaker label, apart from the words themselves (chat-stack.ts): the client islands import this small file, so the conversations' text is not part of the page's script (it reaches the page as props from the server). */
export type StackCode = "te" | "hi" | "kn" | "en";
export type StackLine = { from: "me" | "them"; time: string; text: string };
export type CallLine = { from: "me" | "them"; text: string };
export type StackChat = {
  code: StackCode;
  name: string;
  /** The city shown with the call's timer. */
  place: string;
  day: string;
  /** The call screen's own words, in the conversation's language: the customer's label, the live chip and the ended chip. */
  call: { you: string; live: string; ended: string; lines: CallLine[] };
  lines: StackLine[];
};
export const AI_LABEL = "AI assistant";
