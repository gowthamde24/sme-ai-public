// The in-page parts of audit:landing. Each export is a JavaScript expression (a string) that the engine evaluates in
// the page and that returns plain JSON, so the same checks run in Chrome, WebKit and Firefox. No dependency.

/** Shared helpers, prepended to the checks that need them. */
const HELPERS = `
const vis = (e) => {
  const cs = getComputedStyle(e);
  if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};
const srOnly = (e) => { const r = e.getBoundingClientRect(); return r.width <= 2 || r.height <= 2; };
const label = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.getAttribute('class') ? '.' + String(e.getAttribute('class')).split(/\\s+/).slice(0, 2).join('.') : '') + ' "' + (e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 28) + '"';
const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const rgba = (css) => {
  ctx.globalCompositeOperation = 'copy';
  ctx.fillStyle = '#000'; ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2], d[3] / 255];
};
const over = (f, b) => [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3])).concat([1]);
const lum = (c) => { const k = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const root = document.querySelector('[data-ui="v2"]');
/** The colour behind an element: its ancestors' backgrounds composited. images:true if a gradient or image sits behind it (not counting the page's own dot pattern on the root). */
const backdrop = (el) => {
  const layers = []; let images = false;
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  let base = dark ? [0, 0, 0, 1] : [255, 255, 255, 1];
  for (let n = el; n; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.backgroundImage !== 'none' && n !== root) images = true;
    const c = rgba(cs.backgroundColor);
    if (c[3] > 0) layers.push(c);
    if (c[3] >= 0.999) break;
  }
  let acc = layers.length && layers[layers.length - 1][3] >= 0.999 ? layers.pop() : base;
  while (layers.length) acc = over(layers.pop(), acc);
  return { color: acc, images };
};
const opacityOf = (el) => { let o = 1; for (let n = el; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; };
`;

export const STRUCTURE = `(() => { ${HELPERS}
  const problems = [], info = {};
  const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(vis);
  info.h1 = hs.filter((h) => h.tagName === 'H1').length;
  if (info.h1 !== 1) problems.push('expected exactly one h1, found ' + info.h1);
  let prev = 0;
  for (const h of hs) { const lv = Number(h.tagName[1]); if (prev === 0 && lv !== 1) problems.push('the first heading is ' + h.tagName); if (prev && lv > prev + 1) problems.push('heading level jumps from h' + prev + ' to h' + lv + ': ' + label(h)); prev = lv; }
  info.headings = hs.length;
  const count = (sel) => [...document.querySelectorAll(sel)].filter(vis).length;
  info.banner = count('body header:not(section header):not(article header)'); info.main = count('main'); info.contentinfo = count('body footer');
  if (info.banner !== 1) problems.push('expected one banner (header), found ' + info.banner);
  if (info.main !== 1) problems.push('expected one main, found ' + info.main);
  if (info.contentinfo !== 1) problems.push('expected one footer, found ' + info.contentinfo);
  for (const n of document.querySelectorAll('nav')) if (!n.getAttribute('aria-label') && !n.getAttribute('aria-labelledby')) problems.push('nav without a name: ' + label(n));
  info.v2Roots = document.querySelectorAll('[data-ui="v2"]').length;
  if (info.v2Roots !== 1) problems.push('expected one [data-ui="v2"] root, found ' + info.v2Roots);
  info.rootLang = root.getAttribute('lang'); info.htmlLang = document.documentElement.lang;
  // unique ids, resolvable references
  const ids = {}; for (const e of document.querySelectorAll('[id]')) ids[e.id] = (ids[e.id] || 0) + 1;
  for (const [id, n] of Object.entries(ids)) if (n > 1) problems.push('duplicate id ' + id);
  for (const e of document.querySelectorAll('[aria-labelledby],[aria-controls]')) for (const a of ['aria-labelledby', 'aria-controls']) for (const id of (e.getAttribute(a) || '').split(/\\s+/).filter(Boolean)) if (!document.getElementById(id)) problems.push(a + ' points at a missing id "' + id + '" on ' + label(e));
  for (const a of document.querySelectorAll('a[href^="#"]')) { const id = decodeURIComponent(a.getAttribute('href').slice(1)); if (id && id !== 'top' && !document.getElementById(id)) problems.push('in-page link to a missing target: ' + a.getAttribute('href')); }
  // accessible names
  const txt = (n) => {
    if (n.nodeType === 3) return n.textContent;
    if (n.nodeType !== 1 || n.getAttribute('aria-hidden') === 'true') return '';
    const cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden') return '';
    if (n.tagName === 'IMG') return n.getAttribute('alt') || '';
    return [...n.childNodes].map(txt).join(' ');
  };
  const nameOf = (e) => {
    const al = (e.getAttribute('aria-label') || '').trim(); if (al) return al;
    const lb = (e.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean).map((id) => { const t = document.getElementById(id); return t ? txt(t) : ''; }).join(' ').trim(); if (lb) return lb;
    if (e.labels && e.labels.length) { const l = [...e.labels].map(txt).join(' ').trim(); if (l) return l; }
    const t = txt(e).replace(/\\s+/g, ' ').trim(); if (t) return t;
    return (e.getAttribute('title') || '').trim();
  };
  const controls = [...document.querySelectorAll('a[href],button,select,input:not([type=hidden]),textarea,summary,[tabindex="0"]')].filter(vis);
  info.controls = controls.length;
  for (const c of controls) if (!nameOf(c)) problems.push('no accessible name: ' + label(c));
  for (const i of document.querySelectorAll('img')) if (!i.hasAttribute('alt') && i.getAttribute('aria-hidden') !== 'true' && i.getAttribute('role') !== 'presentation') problems.push('img without alt');
  for (const s of document.querySelectorAll('svg')) if (vis(s) && s.getAttribute('aria-hidden') !== 'true' && !s.getAttribute('aria-label') && !s.querySelector('title') && s.getAttribute('role') !== 'presentation' && !s.closest('[aria-hidden="true"]')) problems.push('svg that is neither hidden nor named');
  // head
  const meta = (n) => (document.querySelector('meta[name="' + n + '"]') || {}).content || null;
  info.title = document.title; info.robots = meta('robots');
  info.ogImage = !!document.querySelector('meta[property="og:image"]'); info.jsonLd = document.querySelectorAll('script[type="application/ld+json"]').length;
  if (!document.title.trim()) problems.push('empty title');
  if (!/noindex/.test(info.robots || '')) problems.push('robots meta is not noindex: ' + info.robots);
  if (info.ogImage) problems.push('og:image present'); if (info.jsonLd) problems.push('JSON-LD present');
  return { problems, info };
})()`;

/** Text size, touch targets, contrast: run in the reduced-motion page so every element is in its final state. */
export const TEXT_AND_TARGETS = (phone) => `(() => { ${HELPERS}
  const phone = ${phone ? "true" : "false"};
  const small = [], contrast = [], unknown = [], targets = [], exempt = [];
  let texts = 0, minFont = 999, worst = 99, checkedText = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || seen.has(el) || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName) || el.closest('svg')) continue;
    seen.add(el);
    if (!vis(el) || srOnly(el) || opacityOf(el) < 0.05) continue;
    texts++;
    const cs = getComputedStyle(el), fs = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    minFont = Math.min(minFont, fs);
    if (fs < 14) small.push(label(el) + ' ' + fs + 'px');
    if (el.closest(':disabled')) continue; // inactive controls are exempt from the contrast rule
    const bg = backdrop(el);
    const c = rgba(cs.color); c[3] *= opacityOf(el);
    const fg = over(c, bg.color);
    const r = ratio(fg, bg.color), need = (fs >= 24 || (fs >= 18.66 && bold)) ? 3 : 4.5;
    checkedText++; worst = Math.min(worst, r / need);
    if (bg.images) unknown.push(label(el) + ' (a background image or gradient sits behind it)');
    else if (r + 1e-9 < need) contrast.push(label(el) + ' ' + r.toFixed(2) + ':1 needs ' + need + ':1 (' + Math.round(fs) + 'px)');
  }
  const min = phone ? 44 : 24;
  const interactive = [...document.querySelectorAll('a[href],button,select,input:not([type=hidden]),textarea,summary,[tabindex="0"]')].filter((e) => vis(e) && !srOnly(e));
  for (const e of interactive) {
    const r = e.getBoundingClientRect();
    const inline = e.tagName === 'A' && getComputedStyle(e).display === 'inline' && e.closest('p,li,span') && (e.parentElement.textContent || '').trim() !== (e.textContent || '').trim();
    if (inline) { exempt.push(label(e)); continue; }
    if (r.width + 0.5 < min || r.height + 0.5 < min) targets.push(label(e) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  return { texts, minFont, checkedText, worstRatioOverNeed: Number(worst.toFixed(2)), small, contrast, unknown, targets, targetMin: min, interactive: interactive.length, exempt };
})()`;

/** Horizontal overflow, and the first screen. */
export const LAYOUT = `(() => { ${HELPERS}
  const w = document.documentElement.clientWidth, h = innerHeight;
  const doc = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  const offenders = [];
  for (const e of document.querySelectorAll('body *')) {
    if (!vis(e) || e.closest('svg') && e.tagName !== 'svg') continue;
    const r = e.getBoundingClientRect();
    if (r.right <= w + 0.5 && r.left >= -0.5) continue;
    let clipped = false;
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p); if (/(auto|scroll)/.test(o.overflowX)) { const pr = p.getBoundingClientRect(); if (pr.right <= w + 0.5 && pr.left >= -0.5) { clipped = true; break; } } }
    if (!clipped && !srOnly(e)) offenders.push(label(e) + ' right=' + Math.round(r.right));
  }
  const flow = [...document.querySelectorAll('[data-flow]')].find(vis);
  const card = flow && flow.querySelector('[data-card="0"]');
  const first = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return Math.round(r.bottom); };
  return { viewportW: w, viewportH: h, docScrollWidth: doc, offenders: offenders.slice(0, 6), h1Bottom: first(document.querySelector('h1')), ctaBottom: first(document.querySelector('a[href="#early-access"]')), cardBottom: first(card), mode: flow ? flow.getAttribute('data-mode') : null };
})()`;

/** One tab stop: what has focus and how it looks. */
export const FOCUS_STATE = `(() => { ${HELPERS}
  const e = document.activeElement;
  if (!e || e === document.body) return null;
  const cs = getComputedStyle(e);
  const bg = backdrop(e.parentElement || e);
  const ring = rgba(cs.outlineColor);
  const widthPx = parseFloat(cs.outlineWidth) || 0;
  const hasOutline = cs.outlineStyle !== 'none' && widthPx >= 2;
  const hasShadow = cs.boxShadow !== 'none';
  const r = e.getBoundingClientRect();
  return { name: label(e), hasOutline, hasShadow, outlineWidth: widthPx, ratio: Number(ratio(over(ring, bg.color), bg.color).toFixed(2)), inView: r.bottom > 0 && r.top < innerHeight, tag: e.tagName.toLowerCase() };
})()`;

export const FOCUSABLE_COUNT = `(() => { ${HELPERS}
  return [...document.querySelectorAll('a[href],button:not(:disabled),select,input:not([type=hidden]):not(:disabled),textarea,summary,[tabindex="0"]')].filter((e) => vis(e) && !srOnly(e) && !e.closest('[inert]')).length;
})()`;

/** Which animated properties exist right now (running CSS animations and transitions). */
export const ANIMATED_NOW = `(() => {
  const out = [];
  for (const a of document.getAnimations()) {
    const eff = a.effect; if (!eff || !eff.getKeyframes) continue;
    const names = new Set(); for (const kf of eff.getKeyframes()) for (const k of Object.keys(kf)) if (!['offset', 'computedOffset', 'easing', 'composite'].includes(k)) names.add(k);
    out.push((a.transitionProperty ? 'transition:' : 'animation:' + (a.animationName || '') + ':') + [...names].join(','));
  }
  return out;
})()`;

/** Declared transition properties of everything inside the flow (not only the ones running now). */
export const FLOW_TRANSITIONS = `(() => {
  const props = new Set();
  for (const f of document.querySelectorAll('[data-flow]')) for (const e of f.querySelectorAll('*')) {
    const cs = getComputedStyle(e);
    const d = cs.transitionDuration.split(',').some((x) => parseFloat(x) > 0.0011);
    if (d) for (const p of cs.transitionProperty.split(',')) props.add(p.trim());
  }
  return [...props];
})()`;

/**
 * Structure of a sign-in or account screen behind the Stage 3 frame: one h1, one banner, one main (id "main", the skip
 * link's target), exactly one skip link, the form region in English inside the content language, names for every control,
 * labels for every field, unique ids, noindex, the expected title.
 */
export const AUTH_STRUCTURE = (opts) => `(() => { ${HELPERS}
  const opts = ${JSON.stringify(opts)};
  const problems = [], info = {};
  const count = (sel) => [...document.querySelectorAll(sel)].filter(vis).length;
  info.h1 = count('h1'); if (info.h1 !== 1) problems.push('expected one h1, found ' + info.h1);
  info.main = count('main'); if (info.main !== 1) problems.push('expected one main, found ' + info.main);
  const main = document.querySelector('main');
  if (!main || main.id !== 'main') problems.push('the main has no id="main" (the skip link target)');
  info.banner = count('body header:not(section header):not(article header)'); if (info.banner !== 1) problems.push('expected one banner, found ' + info.banner);
  const skips = [...document.querySelectorAll('a[href="#main"]')]; info.skipLinks = skips.length; if (skips.length !== 1) problems.push('expected one skip link, found ' + skips.length);
  info.v2Roots = document.querySelectorAll('[data-ui="v2"]').length; if (info.v2Roots !== 1) problems.push('expected one [data-ui="v2"] root, found ' + info.v2Roots);
  info.rootLang = root ? root.getAttribute('lang') : null; if (info.rootLang !== opts.lang) problems.push('wrapper lang is "' + info.rootLang + '", expected "' + opts.lang + '"');
  const region = main && main.parentElement; info.regionLang = region ? region.getAttribute('lang') : null;
  if (info.regionLang !== 'en') problems.push('the form region has lang="' + info.regionLang + '", expected "en"');
  if (opts.lang !== 'en') { const t = (skips[0] && skips[0].textContent.trim()) || ''; if (t === 'Skip to content') problems.push('the skip link is not translated'); }
  info.forms = count('form'); if (info.forms !== opts.forms) problems.push('expected ' + opts.forms + ' form(s), found ' + info.forms);
  info.title = document.title; if (document.title !== opts.title) problems.push('title is "' + document.title + '", expected "' + opts.title + '"');
  const robots = (document.querySelector('meta[name="robots"]') || {}).content || null; info.robots = robots;
  if (!/noindex/.test(robots || '') || !/nofollow/.test(robots || '')) problems.push('robots meta is not noindex, nofollow: ' + robots);
  const ids = {}; for (const e of document.querySelectorAll('[id]')) ids[e.id] = (ids[e.id] || 0) + 1;
  for (const [id, n] of Object.entries(ids)) if (n > 1) problems.push('duplicate id ' + id);
  for (const f of document.querySelectorAll('input:not([type=hidden]),select,textarea')) {
    if (!vis(f)) continue;
    const named = (f.labels && f.labels.length && [...f.labels].some((l) => l.textContent.trim())) || f.getAttribute('aria-label') || f.getAttribute('aria-labelledby');
    if (!named) problems.push('field without a label: ' + label(f));
  }
  const txt = (n) => { if (n.nodeType === 3) return n.textContent; if (n.nodeType !== 1 || n.getAttribute('aria-hidden') === 'true') return ''; const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return ''; return [...n.childNodes].map(txt).join(' '); };
  for (const c of document.querySelectorAll('a[href],button,select,summary')) {
    if (!vis(c)) continue;
    if (!((c.getAttribute('aria-label') || '').trim() || txt(c).trim() || (c.getAttribute('title') || '').trim())) problems.push('no accessible name: ' + label(c));
  }
  info.alertInForm = !!document.querySelector('form [role="alert"]'); info.statusInForm = !!document.querySelector('form [role="status"]');
  return { problems, info };
})()`;
