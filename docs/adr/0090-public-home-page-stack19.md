# ADR 0090: the public home page rebuilt from the approved design, the Stack19 brand, no prices (job CX)

Status: accepted (owner brief, job CX, 15 Oct 2026).

## Context
The home page was built in job CM around seven plush owls, a pack switcher with owl pictures, a trust strip, a pricing teaser with amounts and an FAQ. The owner approved a new design (`landing-design.html`) and decided three things at the same time: the public pages show **no price** until usage tests are done; the free trial **needs a payment method**, so nothing may say "no card"; and the product is called **Stack19**, replacing the working name.

## Decisions
1. **The home page has eight sections** (nav, hero, "Currently built for", six steps, languages, calls and voice, the trial box, the last call to action, the footer). The hero shows Agent OWL, the only owl on the page; the three business cards have no picture; the owl team, the trust strip, the FAQ and the pricing teaser are gone from the home page (the facts about what waits for the owner and the automatic-sending switch stay on `/how-it-works`, and the home hero says "Anything about money waits for your OK").
2. **Two client components, nothing else.** The six steps (2.2 s) and the sample chats (4 s) are animated by `useAutoplay`. With `prefers-reduced-motion` nothing moves and nothing is marked; there is a pause button for everyone else (WCAG 2.2.2); a tab touch stops the chat slide. All words come from the server as props.
3. **The business cards are data.** Each `landing.json` gets an optional `home_card` {title, line, link}; the card shows it, or the type's name and hero eyebrow without it. The web still names no business type, and no pack file other than `landing.json` changed (`pack.json` is hash-synced into migrations and was not touched).
4. **No amount anywhere.** `plans.ts` holds plan ids and the trial days only; the pricing page says "Pricing announced soon" for each plan and for the setup; the JSON-LD has no offers. A test renders every public page in every language and fails on a rupee sign, a price field or a "no card" claim.
5. **Stack19 is the `BRAND_NAME` constant.** The wordmark is the Layers mark and the name. The change reaches every page that reads the constant (the sign-in and sign-up frames, the legal pages, the install hint, the manifest, the share pictures), not only the public site.
6. **The sign-up picker has no owls.** Each business type is its prop icon in its accent colour, the name and the line.
7. **Sample chats and the new Telugu, Hindi and Kannada words are machine drafts** marked draft in the string store; a native reader must check them before launch. The chats name three invented businesses and are labelled "Sample chats".
8. **The `night` tokens** (`--v2-night`, `--v2-on-night`, `--v2-night-muted`, `--v2-night-2`, `--v2-night-line`) hold the two dark bands: the same in both themes, a shade deeper in the dark theme so the band still reads as a band.

## Consequences
- The landing route measures 150,924 B of 156,000 B (was 149,084); `/landing` and the language prefixes (the same page) are under the 153,000 B public ceiling with 2 KB left. The hero picture is the 512 px owl in `srcset` (38 KB, under the 60 KB limit); on the throttled phone LCP is 912 ms (908 ms before).
- The old FAQ, owl-team and trust copy are deleted from `site.json`; the business pages keep their own FAQ and day-with-the-owls sections (not in scope).
- The visual baselines of the landing page (8) were rewritten; the share pictures (16) were regenerated.
