# The 3D Agent office: a proposal (Job AC, batch C6, stop point)

Status: **PROPOSAL ONLY. Nothing from it is built or installed.** It needs the owner's "deps ok" for the three packages below, and the owner's answer to the "decisions" section.
The Office as a list (reference `office-list-1440`) is done in batch C6. This is the 3D view (reference `office-v3-1440`, source `design-lab/src/office/*` on branch `web/landing`).

## What the reference is
A round table with seven people drawn from code (no models, no textures, no downloads): `Office3D.tsx` (the scene, the only importer of three), `character.ts` and `geo.ts` (the people), `anatomy.ts`, `seats.ts`, `people.ts`, `SceneLabels.tsx` (labels over the heads, DOM, not WebGL), `webgl.ts` (the "can this browser make a WebGL context" probe), `reducer.ts` and `stream.ts` (a SIMULATED event stream that moves the people). A List view toggle always exists and is the fallback.

## Packages (all three would be new dependencies: not installed, not added to package.json)
| Package | Version in the design lab | Unpacked in node_modules (npm registry) | Needed for |
|---|---|---|---|
| `three` | 0.186.1 | 20.4 MB (not shipped: tree-shaken) | the renderer, geometry, `BufferGeometryUtils` |
| `@react-three/fiber` | 9.8.1 | 2.4 MB | the React renderer and `<Canvas>` |
| `@react-three/drei` | 10.7.9 | 1.75 MB | `OrbitControls`, `PerformanceMonitor` (two helpers: could be replaced by about 60 lines and the dependency dropped; decision below) |
| `@types/three` (dev) | 0.186.0 | types only | type checking |

React 19 (we have 19.2.8) is what fiber 9 requires. Licences: three, fiber and drei are MIT (the lab's `npm run audit:licenses` is the check; we would run an equivalent before merging). No model or texture file, so nothing else to license.

## Sizes (measured, not guessed)
From the design lab's own production build (`~/Desktop/sme-ai-web/design-lab/dist`, built 2026-10-07), `gzip -9`:
- the Office chunk (`Office3D-*.js`, three + fiber + drei + the scene): **985,553 B raw, 267,431 B gzip**;
- for scale, the lab's whole app shell is 281 KB raw / 71 KB gzip, and our public-page budget is the empty Next route (177,009 B gzip) plus 40,000 B (`scripts/budget.json`).
So the 3D view adds about **260 KB gzip, on demand, to one route**: more than the whole current app. It must never be in any other route's JS, and never in the first load of the Office route.
Fonts: none new. Images: none. Texture memory: none (procedural). CPU/GPU: a continuous render loop while the 3D view is open.

## Lazy-loading plan
1. The Office page stays a server component that draws the LIST (this batch). The 3D view is a separate client island.
2. A small client component `OfficeViewSwitch` holds the toggle (3D view, List view; real buttons, `aria-pressed`). Default is the list on every device until the person chooses 3D (or, owner decision 1 below, a capable desktop).
3. `Office3D` is loaded with `next/dynamic(() => import("./Office3D"), { ssr: false })` **only when 3D is chosen** (prefetch on hover or focus of the toggle). Server render and first load: no three.js. A skeleton of the same height is shown while the chunk loads (no layout shift).
4. One file imports three (as in the lab); a build check (modelled on the lab's `bundle-report.mjs`) fails the build if `WebGLRenderer` appears in any chunk except the Office3D chunk, and `audit:budget` keeps checking the landing page.
5. CSP: production `script-src` is `'self' 'nonce' 'strict-dynamic'` with no `unsafe-eval`; three needs no eval and the scene loads no image or font, so no policy change is expected (to be checked in a real build; dev uses `unsafe-eval` already).

## Weak-device and no-WebGL fallback
- **Probe before loading the chunk:** a 10-line `webglAvailable()` (copied in spirit from `webgl.ts`: create a `webgl2`/`webgl` context, release it). No WebGL: the list is shown with one sentence ("The 3D view is not available on this device, so here is the list."), and the 3D button is disabled with the reason as text.
- **Do not even offer it automatically** on: `prefers-reduced-motion` (the lab already draws a still pose; we would just show the list), `navigator.connection.saveData`, `effectiveType` of 2g/3g, `navigator.deviceMemory <= 4` or `hardwareConcurrency <= 4` (the person can still press 3D).
- **While running:** the lab's `PerformanceMonitor` lowers pixel ratio and detail when the frame rate drops; on `webglcontextlost` the scene unmounts and the list returns with the same sentence. Leaving the screen disposes the canvas (the lab's toggle test: 18 toggles, no "too many WebGL contexts").
- **Accessibility:** the canvas is `aria-hidden`; the list IS the accessible version (same information, as text); labels are DOM text; the toggle and the list are keyboard reachable; nothing is only in 3D.

## Decisions for the owner before any build
1. **Default view:** list everywhere (recommended; 3D is a choice), or 3D by default on a capable desktop?
2. **drei or not:** keep the dependency for two helpers, or write them (about 60 lines) and ship two packages instead of three?
3. **"No decorative agents" (CLAUDE.md):** the lab's seven people are invented faces and its animation is a simulated event stream. In the product the scene may show ONLY the real state of `getAgentsStatus()` (working/idle/not available, the job, the last event); a person that is "working" must be working in the data; an agent that does not exist yet (`not_available`) is an empty chair, not a character. Do you accept characters at all, or a plainer scene (the table and labelled seats)?
4. **Data it needs from Claude 1:** `getAgentsStatus()` as in the contract (7 rows) plus a last-events list per agent if the detail panel should show more than one event (`last_event` is one string today).
5. **Budget:** approve about 260 KB gzip on demand for the Office route (a separate budget line, not the landing's).

## Work and risk
About five commits: the dependency commit (needs "deps ok"), the loader and switch with the weak-device logic and tests (the scene mocked: jsdom has no WebGL), the scene port, the build check and budget line, pictures and a real-device check (the lab itself says the frame rate on a real phone was never measured). Risks: bundle size, a GPU-heavy screen on cheap phones, the "invented people" question above, and a port of about 2,300 lines of procedural geometry that we would own.

Not done in this job: no package installed, no `package.json` or lockfile change, no 3D code in the repository.
