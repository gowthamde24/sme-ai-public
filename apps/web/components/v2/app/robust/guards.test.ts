import { describe, expect, it } from "vitest";

import { guardedButton, startsNavigation, tooSoon } from "./guards";

function dom(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

describe("tooSoon", () => {
  it("is true only inside the window after a first press", () => {
    expect(tooSoon(undefined, 1000, 700)).toBe(false);
    expect(tooSoon(1000, 1500, 700)).toBe(true);
    expect(tooSoon(1000, 1700, 700)).toBe(false);
    expect(tooSoon(1000, 900, 700)).toBe(false); // a clock that went back is not a double press
  });
});

describe("which clicks are guarded", () => {
  it("an ordinary button is", () => {
    dom('<button id="a" type="button"><span id="in">Save</span></button>');
    expect(guardedButton(document.getElementById("in"))?.id).toBe("a");
  });
  it("not a submit (guarded as a submit), a disabled one, or a link", () => {
    dom('<button id="s" type="submit">Go</button><button id="d" type="button" disabled>No</button><a id="l" href="/x">x</a>');
    expect(guardedButton(document.getElementById("s"))).toBeNull();
    expect(guardedButton(document.getElementById("d"))).toBeNull();
    expect(guardedButton(document.getElementById("l"))).toBeNull();
    expect(guardedButton(null)).toBeNull();
  });
  it("not one that opts out, or that only shows and hides, or a tab or switch", () => {
    dom(
      '<button id="r" type="button" data-repeat>Up</button><div data-no-guard><button id="n" type="button">x</button></div><button id="e" type="button" aria-expanded="false">m</button><button id="p" type="button" aria-pressed="true">p</button><button id="t" type="button" role="tab">t</button><button id="w" type="button" role="switch">w</button>',
    );
    for (const id of ["r", "n", "e", "p", "t", "w"]) expect(guardedButton(document.getElementById(id)), id).toBeNull();
  });
});

describe("which clicks start a move to another page", () => {
  const here = { origin: "https://app.example.test", pathname: "/app/tenants/t1", search: "" };
  const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
  const link = (href: string, attrs = "") => {
    document.body.innerHTML = `<a id="a" href="${href}" ${attrs}>x</a>`;
    return document.getElementById("a") as HTMLAnchorElement;
  };
  it("a plain click on a link to another page of the site does", () => {
    expect(startsNavigation(link("/app/tenants/t1/orders"), plain, here)).toBe(true);
    expect(startsNavigation(link("https://app.example.test/app/tenants/t1?tab=x"), plain, here)).toBe(true); // same path, another query
  });
  it("not the page we are on, a hash on it, another site, a new tab, a download, a modified or a non-left click", () => {
    expect(startsNavigation(link("/app/tenants/t1"), plain, here)).toBe(false);
    expect(startsNavigation(link("/app/tenants/t1#needs-you"), plain, here)).toBe(false);
    expect(startsNavigation(link("https://elsewhere.example/x"), plain, here)).toBe(false);
    expect(startsNavigation(link("/x", 'target="_blank"'), plain, here)).toBe(false);
    expect(startsNavigation(link("/x", "download"), plain, here)).toBe(false);
    for (const mod of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) expect(startsNavigation(link("/x"), { ...plain, ...mod }, here)).toBe(false);
    expect(startsNavigation(null, plain, here)).toBe(false);
  });
});
