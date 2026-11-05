/** The assistant does the work (C2): the chat's files and work cards. ChatPanel takes ONE hook call (`useChatWork`) and draws `WorkCards` under an answer. */
export { useChatWork, type WorkOptions } from "./use-chat-work";
export { WorkCards } from "./LazyWorkCards";
export type { WorkEnv, WorkRole } from "./work-env";
