import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/v2/app/start/ActivationCard", () => ({ ActivationCard: ({ activation }: { activation: { done: number; total: number } }) => <p>{`card ${activation.done} of ${activation.total}`}</p> }));

import type { Activation } from "@/lib/packs/activation";

import { ActivationIntro } from "./activation-intro";

const t = ((k: string) => k) as never;
const hide = (async () => undefined) as (f: FormData) => Promise<void>;
const act1 = (done: number, total: number) => ({ steps: [], done, total, next: null }) as unknown as Activation;

describe("ActivationIntro: the checklist streams in after the first paint", () => {
  it("draws nothing while the facts are still being read, then the card when they arrive", async () => {
    let arrive: (a: Activation | null) => void = () => undefined;
    const asked = new Promise<Activation | null>((resolve) => (arrive = resolve));
    let container!: HTMLElement;
    await act(async () => {
      container = render(<ActivationIntro asked={asked} base="/app/tenants/x" t={t} hide={hide} />).container; // (rendered inside an awaited act: the part that reads a promise settles there, as in the screens' own test)
    });
    expect(container).toBeEmptyDOMElement();
    await act(async () => {
      arrive(act1(5, 7));
      await asked;
    });
    expect(screen.getByText("card 5 of 7")).toBeInTheDocument();
    expect(container.querySelector("[data-part=start]")).not.toBeNull();
  });
  it("draws nothing when the checklist could not be read (null) or every step is done", async () => {
    let a!: HTMLElement;
    let b!: HTMLElement;
    let c!: HTMLElement;
    await act(async () => {
      a = render(<ActivationIntro asked={Promise.resolve(null)} base="/b" t={t} hide={hide} />).container;
      b = render(<ActivationIntro asked={Promise.resolve(act1(6, 6))} base="/b" t={t} hide={hide} />).container;
      c = render(<ActivationIntro asked={Promise.resolve(act1(2, 6))} base="/b" t={t} hide={hide} />).container;
    });
    expect(a).toBeEmptyDOMElement();
    expect(b).toBeEmptyDOMElement();
    expect(c).toHaveTextContent("card 2 of 6"); // (the control: an unfinished list does draw)
  });
});
