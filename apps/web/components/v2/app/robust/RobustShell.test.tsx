import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const nav = { pathname: "/app/tenants/t1/orders", search: "tab=open" };
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useSearchParams: () => new URLSearchParams(nav.search), useRouter: () => ({ refresh }) }));

import { RobustShell } from "./RobustShell";

const fetchMock = vi.fn();
let online = true;
const setOnline = (v: boolean) => {
  online = v;
  window.dispatchEvent(new Event(v ? "online" : "offline"));
};
const answer = (over: Partial<Response> & { type?: string } = {}) => Promise.resolve({ ok: true, status: 200, type: "basic", ...over } as Response);
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  online = true;
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  refresh.mockReset();
  fetchMock.mockReset().mockImplementation(() => answer());
  vi.stubGlobal("fetch", fetchMock);
  setHidden(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("offline", () => {
  it("says so while the connection is down, and goes quiet with a short 'back online' and one fresh read when it returns", async () => {
    render(<RobustShell />);
    expect(screen.queryByText(/You are offline/)).toBeNull();
    act(() => setOnline(false));
    expect(screen.getByText(/You are offline/)).toBeInTheDocument();
    expect(screen.getByText(/Buttons that need the internet wait/)).toBeInTheDocument();
    act(() => setOnline(true));
    expect(screen.queryByText(/You are offline/)).toBeNull();
    expect(screen.getByText("You are back online.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(4500);
    });
    expect(screen.queryByText("You are back online.")).toBeNull();
  });
  it("an online person never sees a banner or a refresh", () => {
    render(<RobustShell />);
    expect(document.querySelector('[data-robust="offline"]')).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
  it("speaks the person's language from the labels", () => {
    render(<RobustShell labels={{ "robust.offline.title": "ఆఫ్‌లైన్", "robust.offline.body": "పాతది కావచ్చు" }} />);
    act(() => setOnline(false));
    expect(screen.getByText(/ఆఫ్‌లైన్/)).toBeInTheDocument();
  });
});

describe("the session", () => {
  const ended = () => fetchMock.mockImplementation(() => answer({ ok: false, status: 401 }));
  const comeBack = async () => {
    await act(async () => {
      setHidden(true);
      vi.advanceTimersByTime(40_000);
      setHidden(false);
    });
  };
  it("asks /app/session without following a redirect, and says nothing while the session is good", async () => {
    render(<RobustShell />);
    await comeBack();
    expect(fetchMock).toHaveBeenCalledWith("/app/session", expect.objectContaining({ redirect: "manual", cache: "no-store" }));
    expect(document.querySelector('[data-robust="session"]')).toBeNull();
  });
  it("a 401 shows 'Your session has ended' with a sign-in link for a NEW tab that comes back to this very page", async () => {
    ended();
    render(<RobustShell />);
    await comeBack();
    const link = await screen.findByRole("link", { name: "Sign in again" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
    expect(link).toHaveAttribute("href", `/login?next=${encodeURIComponent("/app/tenants/t1/orders?tab=open")}`);
    expect(screen.getByText(/What you typed here stays on this page/)).toBeInTheDocument();
  });
  it("a redirect to sign-in (an opaque redirect) counts as ended", async () => {
    fetchMock.mockImplementation(() => answer({ ok: false, status: 0, type: "opaqueredirect" }));
    render(<RobustShell />);
    await comeBack();
    expect(await screen.findByRole("link", { name: "Sign in again" })).toBeInTheDocument();
  });
  it("an outage (503) or no answer at all is NOT a sign-out", async () => {
    fetchMock.mockImplementation(() => answer({ ok: false, status: 503 }));
    render(<RobustShell />);
    await comeBack();
    expect(screen.queryByRole("link", { name: "Sign in again" })).toBeNull();
    fetchMock.mockImplementation(() => Promise.reject(new TypeError("failed")));
    await comeBack();
    expect(screen.queryByRole("link", { name: "Sign in again" })).toBeNull();
  });
  it("when the person has signed in again, the banner says so and then goes", async () => {
    ended();
    render(<RobustShell />);
    await comeBack();
    await screen.findByRole("link", { name: "Sign in again" });
    fetchMock.mockImplementation(() => answer());
    await comeBack();
    expect(await screen.findByText("You are signed in again. You can go on.")).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(4500);
    });
    expect(screen.queryByText(/signed in again/)).toBeNull();
  });
  it("asks again every few minutes while the page is in front, not while it is hidden", async () => {
    render(<RobustShell />);
    await act(async () => {
      vi.advanceTimersByTime(4 * 60_000 + 1000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => setHidden(true));
    const n = fetchMock.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(20 * 60_000);
    });
    expect(fetchMock.mock.calls.length).toBe(n);
  });
});

function withForm(onSubmit = vi.fn()) {
  const submitted = onSubmit;
  const utils = render(
    <div>
      <RobustShell />
      <form
        aria-label="Save it"
        onSubmit={(e) => {
          e.preventDefault();
          submitted();
        }}
      >
        <input aria-label="Name" name="name" defaultValue="typed words" />
        <button type="submit">Save</button>
      </form>
    </div>,
  );
  return { submitted, ...utils };
}

describe("a form is sent once", () => {
  it("a second submit inside the window is ignored, the first goes through, and the button says it is busy", () => {
    const { submitted } = withForm();
    const form = screen.getByRole("form", { name: "Save it" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(submitted).toHaveBeenCalledTimes(1);
    expect(form).toHaveAttribute("aria-busy", "true");
  });
  it("the same form with a CHANGED value inside the window is a new submit (a new search, a correction)", () => {
    const { submitted } = withForm();
    const form = screen.getByRole("form", { name: "Save it" });
    fireEvent.submit(form);
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "corrected words" } });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(submitted).toHaveBeenCalledTimes(2); // the changed one went; its own double was ignored
  });
  it("after the window the same form can be sent again (a correction, a second message)", async () => {
    const { submitted } = withForm();
    const form = screen.getByRole("form", { name: "Save it" });
    fireEvent.submit(form);
    await act(async () => {
      vi.advanceTimersByTime(1700);
    });
    expect(form).not.toHaveAttribute("aria-busy");
    // jsdom event timestamps follow the real clock: wait it out
    await new Promise((r) => setTimeout(r, 1600));
    fireEvent.submit(form);
    expect(submitted).toHaveBeenCalledTimes(2);
  }, 10_000);
  it("a form inside data-no-guard is left alone", () => {
    const submitted = vi.fn();
    render(
      <div data-no-guard="">
        <RobustShell />
        <form aria-label="Free" onSubmit={(e) => (e.preventDefault(), submitted())}>
          <button type="submit">Go</button>
        </form>
      </div>,
    );
    const form = screen.getByRole("form", { name: "Free" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(submitted).toHaveBeenCalledTimes(2);
  });
  it("offline: nothing is sent, it says so, and what was typed stays", () => {
    const { submitted } = withForm();
    act(() => setOnline(false));
    fireEvent.submit(screen.getByRole("form", { name: "Save it" }));
    expect(submitted).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Not sent. You are offline.");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("typed words");
  });
  it("with the session ended: nothing is sent, it says so, and what was typed stays", async () => {
    fetchMock.mockImplementation(() => answer({ ok: false, status: 401 }));
    const { submitted } = withForm();
    await act(async () => {
      setHidden(true);
      vi.advanceTimersByTime(40_000);
      setHidden(false);
    });
    await screen.findByRole("link", { name: "Sign in again" });
    fireEvent.submit(screen.getByRole("form", { name: "Save it" }));
    expect(submitted).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Not sent. Your session has ended.");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("typed words");
  });
});

describe("a button is pressed once", () => {
  function withButton(attrs: Record<string, string> = {}) {
    const pressed = vi.fn();
    render(
      <div>
        <RobustShell />
        <button type="button" onClick={pressed} {...attrs}>
          Archive
        </button>
      </div>,
    );
    return { pressed, button: screen.getByRole("button", { name: "Archive" }) };
  }
  it("a double tap does the work once", () => {
    const { pressed, button } = withButton();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(pressed).toHaveBeenCalledTimes(1);
  });
  it("a button marked data-repeat can be pressed again at once", () => {
    const { pressed, button } = withButton({ "data-repeat": "" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(pressed).toHaveBeenCalledTimes(2);
  });
  it("a button that shows and hides is never held back", () => {
    const { pressed, button } = withButton({ "aria-expanded": "false" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(pressed).toHaveBeenCalledTimes(2);
  });
});

describe("moving to another page", () => {
  function withLink(href = "/app/tenants/t1/visits") {
    const utils = render(
      <div>
        <RobustShell />
        <a href={href} onClick={(e) => e.preventDefault()}>
          Visits
        </a>
      </div>,
    );
    return utils;
  }
  beforeEach(() => {
    nav.pathname = "/app/tenants/t1/orders";
    nav.search = "tab=open";
    window.history.pushState({}, "", "/app/tenants/t1/orders?tab=open");
  });
  it("shows 'Loading' at once when a link to another page is pressed, and takes it away when the page has changed", () => {
    const { rerender } = withLink();
    expect(document.querySelector('[data-robust="progress"]')).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Visits" }));
    expect(document.querySelector('[data-robust="progress"]')).not.toBeNull();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    nav.pathname = "/app/tenants/t1/visits";
    nav.search = "";
    rerender(
      <div>
        <RobustShell />
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/app/tenants/t1/visits">Visits</a>
      </div>,
    );
    expect(document.querySelector('[data-robust="progress"]')).toBeNull();
  });
  it("says it is taking longer after eight seconds, and stops waiting after a while", async () => {
    withLink();
    fireEvent.click(screen.getByRole("link", { name: "Visits" }));
    await act(async () => {
      vi.advanceTimersByTime(8100);
    });
    expect(screen.getAllByText("This is taking longer than usual. Still trying.").length).toBeGreaterThan(0);
    await act(async () => {
      vi.advanceTimersByTime(18_000);
    });
    expect(document.querySelector('[data-robust="progress"]')).toBeNull();
  });
  it("does nothing for the page we are on, another site or a modified click", () => {
    withLink("/app/tenants/t1/orders?tab=open");
    fireEvent.click(screen.getByRole("link", { name: "Visits" }));
    expect(document.querySelector('[data-robust="progress"]')).toBeNull();
    cleanup();
    withLink("https://elsewhere.example/x");
    fireEvent.click(screen.getByRole("link", { name: "Visits" }));
    expect(document.querySelector('[data-robust="progress"]')).toBeNull();
    cleanup();
    withLink();
    fireEvent.click(screen.getByRole("link", { name: "Visits" }), { ctrlKey: true });
    expect(document.querySelector('[data-robust="progress"]')).toBeNull();
  });
});
