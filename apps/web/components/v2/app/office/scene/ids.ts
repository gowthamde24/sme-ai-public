/**
 * The seven helpers, in the order of `getAgentsStatus()` (lib/api/today.ts, AGENT_KEYS: a test keeps the two lists equal). Kept here, not imported from lib/api, so the
 * client chunk of the 3D room never pulls the API client in.
 */
export type TeamId = "lead_finder" | "researcher" | "requirement_analyst" | "quote_writer" | "followup_desk" | "order_desk";
export type AgentId = "main" | TeamId;

/** Seat order around the table, left to right as seen from the camera. */
export const TEAM_IDS: readonly TeamId[] = ["lead_finder", "researcher", "requirement_analyst", "quote_writer", "followup_desk", "order_desk"];
export const ALL_AGENT_IDS: readonly AgentId[] = ["main", ...TEAM_IDS];

/**
 * What the room draws for one helper, from the API's `state`: `working` types, `idle` sits still, and `off` (the API's `not_available` and `switched_off`) is drawn faded and
 * still, because that helper does not exist yet or its switch is off: it never moves. Nothing here is invented: the room has no event stream and no hand-offs of its own.
 */
export type Pose = "idle" | "working" | "off";
export type RoomState = Record<AgentId, Pose>;
