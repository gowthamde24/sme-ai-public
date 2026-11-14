/**
 * The words that follow the language of the CONVERSATION (not the app's): two closed sets, by prefix. `talk` = Talk live (its labels, plan card, status and error lines); `task` = the typed plan card and its live progress, undo and cancel.
 * In a file of their own: the route that serves them, the page that names them for the app language and the tests read the same list.
 */
export const CONV_WORD_SETS = {
  talk: ["dst.", "tv6.talk.", "bv.chat.plan.", "bv.chat.state.", "bv.chat.err.", "bv.end.", "bv.live."],
  task: ["tk.", "pc."],
} as const;
export type ConvSet = keyof typeof CONV_WORD_SETS;
export const isConvSet = (v: unknown): v is ConvSet => v === "talk" || v === "task";
