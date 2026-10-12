# Runbook: install Sme-AI on a phone, and what works offline (job BL)

Sme-AI is a **progressive web app**: the same website, but it can sit on the home screen with the Agent OWL icon, open without the browser's address bar, and show a friendly page when the phone has no signal. Nothing to download from a store.

## How the owner installs it
It needs the address of the running site (for now: the address of the hosted test site; a phone cannot reach `localhost` on the computer). The site must be on **https** for the phone to offer the install.

| Phone | Steps |
|---|---|
| **Android, Chrome** | Open the site and sign in. After the third visit a card says "Add Sme-AI to your home screen": tap **Add**, then **Install**. Or: menu (three dots) > **Install app** / **Add to Home screen**. |
| **iPhone, Safari** | Open the site in **Safari** (not Chrome). Tap the **Share** button (the square with an arrow), scroll, tap **Add to Home Screen**, then **Add**. The card after the third visit says the same. |
| **Samsung Internet / Edge** | Menu > **Add page to** > **Home screen** (or **Install**). |
| **Computer (Chrome, Edge)** | The install icon at the right of the address bar, or menu > **Install Sme-AI**. |

The icon is the Agent OWL on the orange brand colour. Opening it starts on **Today** (or the sign-in page if you are signed out).

## The "Add to home screen" card
* Only on a **phone**, only from the **third visit** (a visit = a page view at least 30 minutes after the last), never inside the installed app.
* **Not now** (or the cross) hides it for 30 days. It never blocks anything and sends nothing.
* What it remembers is a visit count and your choice, in this browser only (the key `sme-install-hint`; listed in the Privacy Policy's device settings).

## What works offline
Only the **"You're offline" page**: "You're offline. Agent OWL will catch up when you're back." (also in Telugu, Hindi and Kannada, in the language you chose; the three are machine drafts). **Nothing else is kept for offline use, on purpose**: pages and answers carry customer data, so no page and no answer of the API is ever stored on the phone. A page you open is always fetched live; with no signal you see the offline page and a **Try again** button.

The small worker that does this (`/sw.js`) also keeps the application's own code files (named by their content, no customer data) so the app starts faster on a bad connection. It never touches a request that carries a login, a server action or a POST, nor any address of the API or of another site. `lib/pwa/sw.test.ts` pins all of this.

## For whoever maintains it
* The files: `app/manifest.ts` (name, colours, icons, start page), `public/icons/` (the owl SVG and the PNG set), `public/sw.js`, `public/offline/` (four pages and one stylesheet), `components/v2/pwa/` (registration, the install card), `lib/pwa/` (when to show the card).
* **Change the owl or the brand colour:** edit `public/icons/owl.svg` (keep it the same bird: a test compares it with the app's owl), then `npm run pwa:icons` (draws the PNGs with Chromium from `e2e/node_modules`), commit the PNGs.
* **Change the offline words:** edit `public/offline/<lang>.html`; the English sentence is pinned by `lib/pwa/pwa.test.tsx`. If the worker's behaviour changes, bump `VERSION` in `public/sw.js` (an update removes the old caches).
* **Check it in a real browser:** `make e2e-local` steps **P1** (manifest served, the browser's own installability check finds no error, the worker takes control, the offline page in English and Telugu with the network cut, only the offline shell stored) and **P2** (the card on a 360 px phone: from the third visit, above the bottom bar, 44 px buttons, light and dark, "Not now" kept). In Chrome: DevTools > Application > Manifest / Service Workers.
* **Remove the worker on a device:** DevTools > Application > Service Workers > Unregister, or "Clear site data". Uninstall the app like any app.
* The development server registers the worker as `/sw.js?dev=1`, which keeps no code files (they change under one name there).
* The Content-Security-Policy has `worker-src 'self'` (the worker comes from this site only); `/sw.js` is served with `Cache-Control: no-store` and `Service-Worker-Allowed: /`.

## Not done (needs hosting or a device)
* A check on a **real iPhone and a real Android phone** over https (the hosted site does not exist yet). The e2e run uses Chromium on localhost.
* Push notifications (job BU, only if the owner opts in).
