/**
 * Which pictures an owl uses (job CI, CJ, DA): the folder, the seven agents, the stills and the layers. Kept apart from plush-rig.ts (the rig numbers and the maths) so that a page that only shows a still
 * (an avatar, the hero, a list of owls) does not carry the rig of the live owl in its script: plush-rig.ts re-exports all of this for the live owl and its tests.
 */

/**
 * The pictures live under a versioned folder: next.config.ts serves /owl/ as "immutable" for a year, so a changed picture goes in a new folder (/owl/v5/) and every name below moves with it. v4 (job DA, art job CY): the
 * approved eyes, blush, fur and beak, one folder for each of the seven agents, /owl/v4/<agent>/ (owlet-{head,body,beak,wing-left,wing-right}-{512,1024}.webp and owlet-full-{128,256,512,1024}.webp). The rig numbers of
 * the art are in /owl/v4/rig.json (the same file in every folder): this module reads them from there and design/owl.css carries the same figures (a test keeps the two equal). The folder of the version before this one stays on disk for now; no code reads it.
 */
export const OWL_DIR = "/owl/v4";
/** The seven owls, in the order of the API's agent list (lib/api/today.ts AGENT_KEYS; a test keeps them equal): Agent OWL (sky blue) and the six helpers, each with a collar, ears and wings in a colour of their own. */
export const OWL_AGENTS = ["main", "lead_finder", "researcher", "requirement_analyst", "quote_writer", "followup_desk", "order_desk"] as const;
export type OwlAgent = (typeof OWL_AGENTS)[number];
/** The six helpers in the order of the six steps (job CZ): Find leads, Research, Understand, Quote, Follow up, Close & collect. Agent OWL leads them and is not a step. */
export const HELPER_AGENTS = OWL_AGENTS.slice(1) as readonly OwlAgent[];
/** An id this app does not know gets Agent OWL (never a made-up owl, never a broken picture). */
export const owlAgent = (agent: string | undefined): OwlAgent => ((OWL_AGENTS as readonly string[]).includes(agent ?? "") ? (agent as OwlAgent) : "main");
export const owlDir = (agent?: string): string => `${OWL_DIR}/${owlAgent(agent)}`;
/** The two sizes of a layer picture: 512 px for an owl drawn up to 512 device pixels across, 1024 px beyond that (never a 512 px file stretched). */
export const LAYER_SIZES = [512, 1024] as const;
export type LayerSize = (typeof LAYER_SIZES)[number];
/** Which layer size an owl drawn `cssPx` wide on a screen with this pixel ratio needs: the smallest file that is not smaller than the device pixels it fills. */
export const layerSizeFor = (cssPx: number, pixelRatio: number): LayerSize => (cssPx * (pixelRatio || 1) > 512 ? 1024 : 512);
/** The five layers of one agent's owl. */
export const owlFiles = (agent?: string, size: LayerSize = 512) => {
  const d = owlDir(agent);
  return {
    head: `${d}/owlet-head-${size}.webp`,
    body: `${d}/owlet-body-${size}.webp`,
    beak: `${d}/owlet-beak-${size}.webp`,
    wingLeft: `${d}/owlet-wing-left-${size}.webp`,
    wingRight: `${d}/owlet-wing-right-${size}.webp`,
  } as const;
};
/** The still picture in four sizes: the browser picks by the size the owl is drawn at and the screen's pixel ratio (srcset + sizes), so a 56 px avatar never downloads the 512 px file and a big owl on a sharp screen gets the 1024 px one. */
export const STILL_WIDTHS = [128, 256, 512, 1024] as const;
export type StillWidth = (typeof STILL_WIDTHS)[number];
export const stillFile = (width: StillWidth, agent?: string): string => `${owlDir(agent)}/owlet-full-${width}.webp`;
export const stillSrcSet = (widths: readonly StillWidth[] = STILL_WIDTHS, agent?: string): string => widths.map((w) => `${stillFile(w, agent)} ${w}w`).join(", ");
/** The stills offered to an avatar drawn `px` CSS pixels wide: 1x and 2x of it, and never a file smaller than the pixels it fills. Small owls (up to 128 px) take the 128 and 256 px files, bigger ones the 256 and 512 px ones. */
export const avatarWidths = (px: number): readonly StillWidth[] => (px <= 128 ? [128, 256] : [256, 512]);
/** The stills offered to an owl drawn big (the hero): 512 and 1024. */
export const HERO_WIDTHS: readonly StillWidth[] = [512, 1024];
/**
 * The rig numbers (the wing boxes, the pivots, the mesh) are in the 1024 x 1024 space of the art (LAYER_PX); a layer file is 512 or 1024 px across (the wing boxes are scaled by file size / LAYER_PX in PlushOwl.tsx).
 * Everything else is in percent of the box.
 */
export const LAYER_PX = 1024;
export const STILL_PX = 512;
