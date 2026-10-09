# The 3D Agent office: a proposal (Job AC, batch C6, stop point)

Status: **BUILT in Job AH (branch `web/ah-office-3d`, not pushed)** after the owner's "deps ok" for exactly the packages below. See "As built (Job AH)" at the end; the rest of this file is the proposal as it was written.
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

## As built (Job AH)

What was built, and how the five decisions were taken (the owner's instruction for the job answered 1, 2, 4 and 5; 3 was decided as the smallest safe choice and is for the owner to confirm).

- **Packages** (exact versions, as in the lab): `three` 0.186.1, `@react-three/fiber` 9.8.1, `@react-three/drei` 10.7.9, dev `@types/three` 0.186.0. 55 more packages arrive with drei (transitive, all tree-shaken out of the chunk); all MIT, BSD-3, ISC or Apache-2.0 (`webgl-constants` has no `license` field in its package.json but ships an MIT LICENSE file). `npm audit` reports 5 high findings, all in `braces` under `eslint-config-next` (dev tooling, present before this change).
- **Decision 1, default view:** the room is the first view on a device that can clearly run it; the List is the first view on a weak one (reduced motion, data saver, 2g/3g, 4 GB of memory or less, 4 cores or less) and whenever WebGL is missing (`scene/capability.ts`, tested). The server always draws the List (it works without script); the client then picks. The person's last choice is remembered in this browser only.
- **Decision 2, drei:** kept (the owner approved the three packages). Measured: the chunk is within the proposal's figure, so the two helpers were not rewritten.
- **Decision 3, the people:** all seven are drawn, but the room has no event stream of its own. `working` types, `idle` sits still, and a helper that is `not_available` (not built) or `switched_off` is drawn faded and still, with its state on its name tag. Nothing moves that is not working in the data; there are no speech bubbles and no hand-off paper. If you would rather have an empty chair for a helper that does not exist, it is a one-line change in `scene/Office3D.tsx` (skip the person).
- **Decision 4, data:** only `getAgentsStatus()`: the state, the job and the ONE `last_event` per helper. The side panel therefore shows one latest event, and the event feed is the helpers' latest events newest first (at most six); a list of several events per helper needs Claude 1 to add it (the link from an event to its record was added in Job AI, below).
- **Decision 5, budget:** `scripts/budget.json` has a separate line `office3d` (267,431 B gzip, the lab's measured figure). Measured in a production build: one chunk, 968,350 B raw, **258,660 B gzip**, margin 8,771 B. `npm run audit:3d` (after `npm run build`) fails if three.js is in more than one chunk, if the chunk is over budget, or if any first-load manifest names it.
- **Loading:** `next/dynamic(() => import("./scene/Office3D"), { ssr: false })` in `OfficeStage.tsx`, rendered only when the 3D view is shown; hovering or focusing "3D view" starts the download ahead of the click. A test keeps `three` imports inside `components/v2/app/office/scene/`.
- **Not ported from the lab:** the simulated event stream and reducer, the speech bubbles, the paper in transit, the debug close-up cameras, the `OfficeProvider`.
- **Still open:** a real phone (frame rate and heat were not measured; the lab says the same), a screen-reader pass, and the touch size of the name tags (about 28 px high; tapping the person works too, and the List is the accessible version).

## As built (Job AI): "Ask your team" on the real Main agent, event links

- **Route, not browser:** the box posts to this app's own route `app/app/tenants/[tenantId]/ask/route.ts` (same-site only, 400 for a bad body). The route asks `POST /v1/tenants/{id}/assistant/messages` with the signed-in person's own token (`lib/api/assistant.ts`); the browser never holds it. It sends only the text and two ids (`message_id`, new for every question, so a retry is never taken for a replay; `conversation_id`, one per open box, so a follow-up continues the chat). Nothing else of the body is passed on: no tenant, role or price.
- **Shape:** `ask/ask-stream.ts` turns the API's events into the box's (`ask-types.ts`) and builds each in-workspace path from a `{type, id}` target (order, lead, enquiry; a quote opens the enquiry it belongs to, found with the person's token, else the list of quotes). The route sends one JSON event per line; `transport.ts` reads it. A refusal before the stream (cost cap, run limit, switch off, Viewer) is one `error` event with a code the box has a fixed sentence for; the API's own English sentence is never shown. A stream that stops before `done` is an error, never a half answer shown as whole.
- **Drafts:** a quote, follow-up or enquiry draft has an Approve link to the screen that decides (nothing is approved from the box). A customer reply is shown in the customer's language with its English meaning and the "written by a machine" label; no screen approves it yet, so it has no Approve link and says nothing was sent.
- **State:** the box is live when the Main agent is `idle` or `working`, says "Switched off" for `switched_off`, and "Not available yet" otherwise.
- **Office:** each helper's latest event is a link to the page its `target` names, in the panel and in the feed; a null target (the Main agent's answers) is plain text.
- **Guards touched:** `test/guards.test.ts` now allows exactly one other `fetch(` caller, the box's transport (it posts to this app's own route, holds no token, names no API address); `nav-structure.test.ts` ignores a folder that holds only a route handler.
- **Open:** the answer's `title` and `summary` are English except a reply draft's text (localising the fixed sentences by `kind` is a later step); the model call is not streamed token by token, so the first words arrive after a wait; no `step` event exists for "Looking at your quotes...".

