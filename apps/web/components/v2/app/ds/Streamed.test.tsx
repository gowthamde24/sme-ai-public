import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError } from "@/lib/api/client";

const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to), forbidden: () => undefined }));

import { early, Part, settle } from "./Streamed";

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const flush = async () => {
  for (let i = 0; i < 3; i += 1) await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
};

describe("a part drawn when its reads are done", () => {
  it("holds its room with the fallback, then draws the part", async () => {
    let done!: (v: string) => void;
    const read = new Promise<string>((res) => (done = res));
    await act(async () => void render(<Part of={settle(read.then((v) => <p>{v}</p>))} fallback={<i data-testid="room" />} />));
    expect(screen.getByTestId("room")).toBeInTheDocument();
    await act(async () => done("the leads"));
    await flush();
    expect(screen.queryByTestId("room")).toBeNull();
    expect(screen.getByText("the leads")).toBeInTheDocument();
  });

  it("says its quiet sentence when its read fails, or nothing where the page leaves the part out", async () => {
    await act(async () => void render(<Part of={settle(Promise.reject(new Error("down")))} fallback={null} quiet={<p>could not be read</p>} />));
    await flush();
    expect(screen.getByText("could not be read")).toBeInTheDocument();
    cleanup();
    const { container } = render(<Part of={settle(Promise.reject(new Error("down")))} fallback={null} />);
    await flush();
    expect(container).toBeEmptyDOMElement();
  });

  it("sends a rejected session to sign-in, as the page always did", async () => {
    await act(async () => void render(<Part of={settle(Promise.reject(new ApiAuthError()))} fallback={null} quiet={<p>quiet</p>} />));
    await flush();
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});

describe("early", () => {
  it("keeps a read that fails before anyone looks at it from being an unhandled rejection, and still raises where it is used", async () => {
    const read = early(Promise.reject(new Error("late")));
    await new Promise((r) => setTimeout(r, 0));
    await expect(read).rejects.toThrow("late");
  });
});
