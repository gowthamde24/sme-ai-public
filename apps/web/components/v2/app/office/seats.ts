import { TEAM_IDS, type AgentId } from "./ids";

/**
 * Where the seven sit in the plush office (job CJ). A flat round table seen from the front: Agent OWL at the head (the far side, top), the six helpers on the two arcs beside it in the seat order of the API
 * (left to right: lead finder, researcher, requirement analyst, | Agent OWL | quote writer, follow-up desk, order desk), and the near side left open so the person looks into the room. The angle is measured from the
 * head of the table (0 = top, negative = left); the ellipse is the arc the seats stand on, in percent of the room's box.
 */
export const TEAM_ANGLES = [-140, -100, -60, 60, 100, 140] as const;
export const ARC = { cx: 50, cy: 54, rx: 38, ry: 37 } as const;

export type Seat = {
  id: AgentId;
  /** Angle from the head of the table, degrees. */
  angle: number;
  /** The seat's centre in percent of the room's box (left, top). */
  x: number;
  y: number;
  /** On a 390 px phone the room is two rows: Agent OWL in the middle of the far row; the others keep their left and right sides. Grid column start/span (of 12) and row (1 or 2). */
  phone: { col: number; span: number; row: 1 | 2 };
};

const round1 = (n: number) => Math.round(n * 10) / 10;
function seatAt(id: AgentId, angle: number, phone: Seat["phone"]): Seat {
  const a = (angle * Math.PI) / 180;
  return { id, angle, x: round1(ARC.cx + ARC.rx * Math.sin(a)), y: round1(ARC.cy - ARC.ry * Math.cos(a)), phone };
}

// far row (3): requirement analyst, Agent OWL, quote writer; near row (4): lead finder, researcher, follow-up desk, order desk
const PHONE: Record<AgentId, Seat["phone"]> = {
  requirement_analyst: { col: 1, span: 4, row: 1 },
  main: { col: 5, span: 4, row: 1 },
  quote_writer: { col: 9, span: 4, row: 1 },
  lead_finder: { col: 1, span: 3, row: 2 },
  researcher: { col: 4, span: 3, row: 2 },
  followup_desk: { col: 7, span: 3, row: 2 },
  order_desk: { col: 10, span: 3, row: 2 },
};

export const SEATS: Record<AgentId, Seat> = {
  main: seatAt("main", 0, PHONE.main),
  ...(Object.fromEntries(TEAM_IDS.map((id, i) => [id, seatAt(id, TEAM_ANGLES[i], PHONE[id])])) as Record<string, Seat>),
} as Record<AgentId, Seat>;
