/**
 * The hero flow's playback rules, as pure functions (tested).
 *
 * One made-up enquiry moves through six nodes. On a laptop the whole strip is visible and a card
 * travels left to right; on a tablet or phone the strip is a swipeable row that advances itself.
 * Only transforms and opacity are animated, so nothing shifts the layout.
 */
export const NODE_COUNT = 6;

/**
 * Laptop timeline: how long each phase lasts (ms).
 * Phases 0-5 = the enquiry sits at node 0-5 (its card appears); 6 = everything shown, held;
 * 7 = the cards fade out before the loop starts again.
 */
export const PHASE_MS = [2300, 2300, 2300, 2300, 2300, 2500, 2400, 700] as const;
export const PHASE_COUNT = PHASE_MS.length;
export const LOOP_MS = PHASE_MS.reduce((a, b) => a + b, 0);

/** Phone and tablet: how long each slide stays before the row advances (ms). */
export const SLIDE_MS = 2800;
/** After a touch, swipe, wheel or key press the row stays still for this long (ms). */
export const TOUCH_PAUSE_MS = 12000;

export interface PlayInputs {
  /** The visitor's device asks for less motion. */
  reduced: boolean;
  /** The visitor chose "Play motion" while reduced motion is on. */
  forceMotion: boolean;
  /** The strip is on screen. */
  inView: boolean;
  /** The browser tab is visible. */
  tabVisible: boolean;
  /** The visitor pressed the pause icon. */
  userPaused: boolean;
  /** The visitor just touched or swiped the row. */
  touchPaused: boolean;
}

/** Motion is allowed when the device does not ask for less (or the visitor overrode that) and nothing pauses it. */
export const motionAllowed = (i: Pick<PlayInputs, "reduced" | "forceMotion">): boolean => !i.reduced || i.forceMotion;

/** Autoplay only when it is allowed, visible, and not paused. */
export const shouldPlay = (i: PlayInputs): boolean => motionAllowed(i) && i.inView && i.tabVisible && !i.userPaused && !i.touchPaused;

export const nextPhase = (p: number): number => (p + 1) % PHASE_COUNT;
/** The node the enquiry is at (0-5); during the hold and fade phases it rests at the last node. */
export const nodeAt = (phase: number): number => Math.max(0, Math.min(NODE_COUNT - 1, phase));
/** Is node i's mini-card shown in this phase? Cards stay once they appear, until the fade-out. */
export const cardVisible = (i: number, phase: number): boolean => phase < PHASE_COUNT - 1 && (phase >= NODE_COUNT ? true : i <= phase);
/** Has the enquiry already left node i? (the node shows a tick) */
export const nodeDone = (i: number, phase: number): boolean => phase < PHASE_COUNT - 1 && (phase >= NODE_COUNT || i < phase);
/** How far the line behind the nodes is filled (0..1). */
export const lineProgress = (phase: number): number => (phase >= PHASE_COUNT - 1 ? 0 : Math.min(1, nodeAt(phase) / (NODE_COUNT - 1)));

/** Which slide a horizontal scroll position is showing. */
export const slideAt = (scrollLeft: number, stride: number): number =>
  stride <= 0 ? 0 : Math.max(0, Math.min(NODE_COUNT - 1, Math.round(scrollLeft / stride)));

/** The line's fill as a step 0..5 (the line only ever has six states), so the strip can use a class instead of an inline style. */
export const lineStep = (phase: number): number => Math.round(lineProgress(phase) * (NODE_COUNT - 1));
