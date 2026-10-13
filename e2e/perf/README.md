# Speed measurement (job CF)

How fast the main screens load on a mid-range Android phone on slow 4G, measured in a real headless Chromium. Lab numbers, not field numbers: use them to compare a change with the one before it on the same machine, not as a promise about a particular phone.

```
make perf                                  # builds the web app, measures six screens, prints a table
make perf ARGS="--no-build --only landing,today --runs 5 --out /tmp/result.json"
make perf ARGS="--no-build --lang te"      # a Telugu visitor (the Telugu font is 122 KB on its own)
make perf ARGS="--no-build --api-delay 100 --trace --only today"   # 100 ms per backend read, and the order of the reads of one page load
make perf ARGS="--no-build --waterfall --only landing"             # when each file started, got its first byte and finished
make perf-budget                           # the cheap guard, after `npm run build`: gzip JS of every page route against apps/web/scripts/budget.json (CI runs it)
```

## What it does

- Builds `apps/web` against the visual tests' invented backend (`e2e/visual/stand-in.mjs`: no database, no keys, no network after the build) and starts `next start` on port **3016** with the stand-in on **54999** (the visual tests' port, so never run both at once). It stops only the two processes it started.
- Per route, in a new browser context each time (cold cache, 360 x 780 phone, touch, device scale 2): Network 150 ms round trip, 1.6 Mbit/s down, 750 kbit/s up, CPU 4x slower (the settings Lighthouse uses for "mobile").
- Records **FCP, LCP** (PerformanceObserver), **TBT** (long tasks after the first paint, over 50 ms), **INP** (one real tap on the first control of the page), **CLS** (worst 5 s session window), the **gzip bytes** that crossed the wire by type (script, CSS, font, image, document), the request count and how many were the router's background reads of the menu pages (`?_rsc=`).
- The median of `--runs` runs (default 3) after one warm-up that is not counted.
- Routes: landing `/`, sign-in `/login`, Today, Outbox, Catalogue (with its photos), Settings > Data. The signed-in ones use a cookie session the stand-in accepts, and a clock pinned to 14 Oct 2026.

## What it does not do

- It is not Lighthouse (not in the repository, not installed); the throttling and the metric definitions are the same, but the scores are not computed. If Lighthouse CI is wanted later, it needs `npm i -D @lhci/cli` (a new dependency: the owner's decision).
- The browser talks HTTP/1.1 to `next start` on this machine: the bandwidth is shared by every file in flight, which a real HTTP/2 or HTTP/3 host with priorities does better. The first-paint figures are therefore pessimistic, and they move with the total bytes in flight, which is the point of using them to compare.
- The server-side time is the stand-in's (about nothing). `--api-delay 100` adds 100 ms to every answer of the stand-in to stand for a real API and Auth server, so a chain of reads one after another shows in the page's time; `--trace` prints the chain.
- Compression is Next's gzip. A host or CDN with brotli sends 15 to 20 per cent less JavaScript than the numbers here.
