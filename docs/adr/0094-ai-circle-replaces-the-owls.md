# ADR 0094: the AI circle and the job icons replace the owls (job DM, the "clean redesign")

Status: accepted (owner, 25 Oct 2026: "Stack19 clean redesign"). Supersedes ADR 0091 (the v4 plush owl) for everything the owner sees; the API's seven agent keys do not change.

## Context
The owner approved a new look for the landing page and the app (design files `Main.dc.html`, `Call.dc.html`, `Setup.dc.html`; `Today.dc.html` as a reference only). The product's mark is a glowing circle; the helpers are shown by the job they do.

## Decisions
1. **One component, CSS only.** `components/v2/Orb.tsx` + `design/orb.css`: no picture, no script, four states (still, ambient, think, speak), an optional halo, still with "reduce motion". Its size sits on its own wrapper because v2 code never puts a `style` and a `className` on one element (audit:leaks).
2. **Where it stands.** The logo mark (site header, app sidebar and phone top bar via `Wordmark` and `BrandMark`), the favicon and the install icons (`public/icons/orb.svg`, `npm run pwa:icons`), the Today card and the Ask bar, voice mode (full screen), the live call, the setup welcome, the share pictures (`npm run og:images`).
3. **The helpers are job icons**, not characters: `AgentMark` draws the main assistant as the circle and each of the six helpers as the icon of its job on a soft tile. `OrbMark` is the circle alone, for client files that name no helper (the friendly error pages are in every route's first load: they must not carry the icons).
4. **No owl is kept.** The pictures (`public/owl`), the live rig (`PlushOwl`), the stills, the Office room around a table and their tests and CSS are deleted. The Office is a team board (`TeamBoard`): a tile for each of the seven, the circle or the icon of its job, its state in words.
5. **The workflow has one order everywhere:** Find leads, Research, AI calls, WhatsApp, Outcome, Follow-up. The six steps of the home page, How it works, "What can Agent OWL do?" and a school's own steps (data: `packages/packs/education/landing.json`) read it. A school has no lead finding (its modules do not include `lead_finder` or `research`).
6. **Honest early access.** AI calls and voices are said to be early access wherever they appear; there is no play button for a voice that does not exist; the live call, the outcomes and Settings > AI assistant are behind flags with fake data until C1's APIs exist.
7. **Trial wording follows the data:** every sentence reads `trial.days` from the plans data (14 days from the day WhatsApp is connected, owner decision of 25 Oct). The Terms and their summary say it (`LEGAL_VERSION` 2026-10-25): counsel should confirm.
