import { TEAM_IDS, type AgentId } from "./ids";

/**
 * Seats around the round table, in metres. The camera looks along -z, so Agent OWL sits at the
 * far side facing the camera (the head of the table) and the six teammates fill the two arcs beside
 * it. The side nearest the camera is left open. The two helpers on that open side swivel their
 * stools toward the camera, and every owl turns a little toward the viewer, so every face is visible from the default view.
 */
export const SEAT_RADIUS = 1.8;
/** The two swivelled seats sit a little closer so their laptops stay on the table. */
export const NEAR_SEAT_RADIUS = 1.74;
export const TABLE_RADIUS = 1.5;
export const TABLE_HEIGHT = 0.84;
/** How far the near-side chairs swivel toward the camera (radians). */
export const SWIVEL = (24 * Math.PI) / 180;

/** Angle from the far side of the table, in degrees. Negative is left as the camera sees it. */
const TEAM_ANGLES = [-105, -70, -35, 35, 70, 105];

export interface Seat {
  id: AgentId;
  x: number;
  z: number;
  /** Rotation about y of the whole seated person (chair, body, laptop). */
  yaw: number;
  /** Radians the chair is turned away from "facing the table centre". */
  swivel: number;
  /** 0..1: how much this person's head drifts toward the camera when nobody is speaking. */
  glance: number;
}

function seatAt(id: AgentId, deg: number): Seat {
  const a = (deg * Math.PI) / 180;
  // seats whose "face the table" direction points away from the camera turn toward it
  const nearSide = Math.abs(deg) > 90;
  const r = nearSide ? NEAR_SEAT_RADIUS : SEAT_RADIUS;
  const x = r * Math.sin(a);
  const z = -r * Math.cos(a);
  const toCentre = Math.atan2(-x, -z);
  const swivel = nearSide ? -Math.sign(toCentre) * SWIVEL : 0;
  return { id, x, z, yaw: toCentre + swivel, swivel, glance: nearSide ? 0.8 : id === "main" ? 0.15 : 0.3 };
}

export const SEATS: Record<AgentId, Seat> = {
  main: seatAt("main", 0),
  ...(Object.fromEntries(TEAM_IDS.map((id, i) => [id, seatAt(id, TEAM_ANGLES[i])])) as Record<string, Seat>),
} as Record<AgentId, Seat>;

/** Smallest signed difference between two angles, in (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Where the default camera stands (x, z); the owls turn a little toward it. */
const CAMERA_XZ: [number, number] = [0, 7];
/** How much of the way from "facing the table" to "facing the camera" an owl turns. */
const TURN = 0.6;

/** The extra turn (about y, in the seat's own frame) that makes an owl face the viewer a little, so no face is seen edge-on. Zero for the head of the table. */
export function owlYaw(seat: Seat): number {
  const toCam = Math.atan2(CAMERA_XZ[0] - seat.x, CAMERA_XZ[1] - seat.z);
  return Math.max(-1, Math.min(1, angleDiff(toCam, seat.yaw) * TURN));
}
