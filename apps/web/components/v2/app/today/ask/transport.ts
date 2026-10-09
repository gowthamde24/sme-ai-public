import type { AskTransport } from "./ask-types";

/**
 * The Main agent's answer stream, as an AskTransport. NULL until Claude 1's contract (Job AG) exists: while it is null the box on Today says "Not available yet" and nothing is sent
 * anywhere. When the endpoint lands, this is the only file that changes: it turns the endpoint's stream into AskEvents (the browser never holds the API token, so the call goes through a
 * route handler of this app that adds the signed-in person's token on the server).
 */
export const ASK_TRANSPORT: AskTransport | null = null;
