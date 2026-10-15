# ADR 0091: the site and the app switch to the v4 plush owl (job DA, art job CY)

Status: accepted (owner brief, job DA, 15 Oct 2026).

## Context
Job CY made the v4 art (approved eyes, blush, fur and beak, seven team colours) and put it on `main` under `apps/web/public/owl/v4/<agent>/` with a `rig.json` in each folder and one at the top. No code used it. The v3 code read its rig numbers from constants written for the v3 art.

## Decisions
1. **`/owl/v4/rig.json` is the one source of every rig number.** `plush-rig.ts` imports it (head pivot, breathing pivot, eyelid boxes, eye centres, mouth, beak box, wing source boxes, inner edges and pivots) and a test checks that all seven agent folders carry the same file. `design/owl.css` needs literal numbers, so a test checks it says what `rig.json` says (head and body pivots, mouth, both eyelid boxes). Nothing is copied from the v3 code.
2. **Lids and arcs follow the new eyes.** The closed-eye arc of each eye is drawn about that eye's centre from `rig.json`. The lids are drawn 20 % larger than the eyelid box with a feathered mask that is opaque over the whole eye, coloured like the fur round the eye in the v4 head picture; the lower lid closes to 44 % of the box and the upper to 54 %, so the two overlap and nothing of the eye shows at the sides. Checked frozen in every mood (idle, listening, thinking, answering, resting) with a fake clock, at 200 %.
3. **No stretched pictures.** Every agent has 128 / 256 / 512 / 1024 px stills and 512 / 1024 px layers. A small owl is offered the 1x and 2x files of its size (128 + 256, or 256 + 512 above 128 px); the hero offers 512 and 1024 with `sizes` of 240 px on a phone and 340 px from 640 px up, so a 2x screen takes the 1024 px file. The live layers are the 1024 px ones when the owl fills more than 512 device pixels, and the wing canvas is as sharp as the screen (up to the layer size, pixel ratio up to 3).
4. **Every owl is the agent's own.** All owls go through `PlushStill`, `SiteOwl` and `PlushOwl` with an `agent` id; an unknown id is Agent OWL. There is no agent-to-colour table in code: the colour is the picture of that agent's folder (the only agent list is `OWL_AGENTS`, kept equal to the API's by a test).
5. **Cache and old files.** `/owl/:path*` stays "immutable, a year" (`next.config.ts`; the folder is versioned). `public/owl/v3` stays on disk for now; no code reads it (a test checks the owl component files, the share-picture script and the stylesheet).
6. **The file helpers are a module of their own.** `owl-files.ts` (folder, agents, stills, layer sizes) is separate from `plush-rig.ts` (rig numbers from `rig.json`, the maths): a page that only shows a still no longer carries the rig of the live owl. The landing route went from 151,051 B to 149,645 B and no app route grew past its budget.
7. The visual runner also refuses the 1024 px layer files, so a picture still never differs from run to run.

## Consequences
- A retina phone takes the 1024 px still for the hero (94 KB against 43 KB for the 512 px one), so the hero image is above the 60 KB that applies to a 1x screen; the perf run (1x) takes the 512 px file.
- Only the first request of a big live owl is heavier (the 1024 px layers: about 100 KB, after the first paint, as before).
