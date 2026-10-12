/* The offline shell worker (job BL). Served from /sw.js, scope "/".
 *
 * What it does, and (more important) what it never does:
 *  - It keeps ONE small thing for offline use: the "You're offline" page (four languages), its stylesheet and the owl picture. Nothing else is needed to show it.
 *  - A page the person opens is always fetched from the network. If the network is gone, the offline page is shown instead. A page is NEVER stored: pages and API answers carry customer data.
 *  - It stores the application's own files under /_next/static/ (the code and fonts, named by their content, no customer data) so the app starts faster on a bad connection. Never in development,
 *    where those files change under the same name.
 *  - Everything else (any other request, any POST, any server action, any /api/ or /app/ address, any request that carries an Authorization header, any other site) is not touched: the browser goes to the network as if this worker were not here.
 *  - It remembers the person's language (one word, in the cache "sme-prefs") so the offline page speaks it. That is all it remembers.
 */
const VERSION = "v1";
const SHELL = "sme-shell-" + VERSION;
const STATIC = "sme-static-" + VERSION;
const PREFS = "sme-prefs";
const LANGS = ["en", "te", "hi", "kn"];
const SHELL_URLS = ["/offline/en.html", "/offline/te.html", "/offline/hi.html", "/offline/kn.html", "/offline/offline.css", "/icons/owl.svg"];
const MAX_STATIC = 150;
// development builds register with ?dev=1: their files are not named by content, so they are never kept
const DEV = new URL(self.location.href).searchParams.get("dev") === "1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== SHELL && n !== STATIC && n !== PREFS).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "lang" || LANGS.indexOf(data.lang) === -1) return;
  event.waitUntil(caches.open(PREFS).then((cache) => cache.put("/__lang", new Response(data.lang))));
});

function language() {
  return caches
    .open(PREFS)
    .then((cache) => cache.match("/__lang"))
    .then((hit) => (hit ? hit.text() : "en"))
    .then((lang) => (LANGS.indexOf(lang) === -1 ? "en" : lang))
    .catch(() => "en");
}

function offlinePage() {
  return language().then((lang) => caches.match("/offline/" + lang + ".html", { cacheName: SHELL }).then((hit) => hit || caches.match("/offline/en.html", { cacheName: SHELL })));
}

/** The only addresses ever kept or answered from the cache. */
function isShellFile(path) {
  return SHELL_URLS.indexOf(path) !== -1;
}
function isStaticFile(path) {
  return path.indexOf("/_next/static/") === 0;
}

function trim(cache) {
  return cache.keys().then((keys) => {
    const extra = keys.length - MAX_STATIC;
    return extra > 0 ? Promise.all(keys.slice(0, extra).map((k) => cache.delete(k))) : null;
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return; // not ours
  if (request.headers.has("authorization") || request.headers.has("next-action") || request.headers.has("rsc")) return; // never touch a request that carries a login or a server call
  if (url.search.indexOf("_rsc") !== -1 || url.pathname.indexOf("/api/") === 0) return;

  if (request.mode === "navigate") {
    // always the network; the offline page only when there is none. The page is not stored.
    event.respondWith(fetch(request).catch(() => offlinePage()));
    return;
  }
  if (isShellFile(url.pathname)) {
    event.respondWith(caches.match(request, { cacheName: SHELL }).then((hit) => hit || fetch(request)));
    return;
  }
  if (isStaticFile(url.pathname) && !DEV) {
    event.respondWith(
      caches.open(STATIC).then((cache) =>
        cache.match(request).then(
          (hit) =>
            hit ||
            fetch(request).then((response) => {
              if (response.ok && response.type === "basic") cache.put(request, response.clone()).then(() => trim(cache));
              return response;
            }),
        ),
      ),
    );
  }
  // anything else: no respondWith, the browser's own network path
});
