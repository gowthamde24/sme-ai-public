import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { parseItem } from "@/lib/api/catalogue";
import { itemJson, photoJson } from "@/lib/api/catalogue-fixtures";

import { ItemEditor, type ItemEditorProps } from "./ItemEditor";
import { BASE, WORDS, fakeEditorActions, file, item, makeWorld } from "./catalogue-test-kit";
import type { Uploader } from "./catalogue-types";

const ID = "c27a36f2-ef14-5f33-b10f-3e03bade04aa";
let n = 0;
const photoId = (i: number) => `0f8a927d-7777-4a77-8a77-${String(i).padStart(12, "0")}`;

beforeEach(() => {
  n = 0;
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => photoId(++n) as `${string}-${string}-${string}-${string}-${string}`);
  URL.createObjectURL = vi.fn((f: Blob) => `blob:${(f as File).name}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Over = Partial<ItemEditorProps> & { wrap?: (inner: Uploader & ReturnType<typeof vi.fn>) => Uploader };
function show(over: Over = {}) {
  const world = makeWorld(over.item ?? null);
  const actions = over.actions ?? world.actions;
  const uploader = over.uploader ?? (over.wrap ? over.wrap(world.uploader) : world.uploader);
  const go = vi.fn();
  const prepare = vi.fn(async (f: File) => ({ ok: true as const, blob: f as Blob }));
  const { wrap: _wrap, ...rest } = over;
  void _wrap;
  render(<ItemEditor base={BASE} itemId={ID} item={null} role="owner" words={WORDS} uploadUrl={`${BASE}/catalogue/${ID}/photos`} {...rest} actions={actions} uploader={uploader} prepare={prepare} go={go} />);
  return { actions: actions as typeof world.actions, go, uploader: uploader as typeof world.uploader, prepare, world };
}
const put = (input: HTMLElement, ...files: File[]) => fireEvent.change(input, { target: { files } });
const take = () => document.querySelector("input[data-input=take]") as HTMLInputElement;
const choose = () => document.querySelector("input[data-input=choose]") as HTMLInputElement;
const fill = (name = "Maroon Kanchi pattu") => {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: name } });
  fireEvent.click(screen.getByLabelText("Maroon"));
};
const save = () => act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save" })));
const tray = () => Array.from(document.querySelectorAll("[data-tray=photos] > li"));

describe("taking and choosing photos", () => {
  it("the camera button asks the phone's camera (capture), the other lets you pick several; only jpeg, png and webp", () => {
    show();
    expect(take()).toHaveAttribute("capture", "environment");
    expect(take()).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    expect(choose()).toHaveAttribute("multiple");
    expect(choose()).not.toHaveAttribute("capture");
    expect(screen.getByRole("button", { name: "Take a photo" }).className).toContain("min-h-11");
  });

  it("shows each photo as soon as it is picked, with a local preview, the first as the cover", () => {
    show();
    put(choose(), file("a.jpg"), file("b.png", "image/png"));
    expect(tray()).toHaveLength(2);
    expect(tray()[0]).toHaveTextContent("Cover");
    expect(screen.getAllByRole("img").map((i) => i.getAttribute("src"))).toEqual(["blob:a.jpg", "blob:b.png"]);
    expect(tray()[1]).toHaveTextContent("Waiting");
  });

  it("refuses a type that is not allowed, in words, and keeps the good ones; the ninth photo is not added", () => {
    show();
    put(choose(), file("a.gif", "image/gif"), file("b.jpg"));
    expect(screen.getByRole("alert")).toHaveTextContent("a.gif: Use a JPEG, PNG or WebP photo.");
    expect(tray()).toHaveLength(1);
    put(choose(), ...Array.from({ length: 9 }, (_, i) => file(`p${i}.jpg`)));
    expect(tray()).toHaveLength(8);
    expect(screen.getByRole("alert")).toHaveTextContent("2 photo(s) were not added: the limit is 8.");
    expect(screen.getByRole("button", { name: "Take a photo" })).toBeDisabled();
  });

  it("taking a photo off the list (before it is saved) forgets its preview", () => {
    show();
    put(choose(), file("a.jpg"), file("b.jpg"));
    fireEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
    expect(tray()).toHaveLength(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:a.jpg");
  });
});

describe("a saree cannot be shown without a photo", () => {
  it("the 'show to customers' box is off and says why until there is a photo", () => {
    show();
    const box = screen.getByLabelText("Show this saree to customers");
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
    expect(screen.getByText("Add at least one photo to show this saree to customers.")).toBeInTheDocument();
    put(choose(), file("a.jpg"));
    expect(screen.getByLabelText("Show this saree to customers")).toBeEnabled();
    expect(screen.queryByText("Add at least one photo to show this saree to customers.")).toBeNull();
  });

  it("taking the last photo off switches 'show' off again, and nothing is sent as shown", async () => {
    const { actions } = show();
    fill();
    put(choose(), file("a.jpg"));
    fireEvent.click(screen.getByLabelText("Show this saree to customers"));
    fireEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
    expect(screen.getByLabelText("Show this saree to customers")).not.toBeChecked();
    await save();
    expect(actions.save).toHaveBeenCalledTimes(1);
    expect(actions.save.mock.calls[0][1]).toMatchObject({ active: false });
  });
});

describe("saving: details, photos with progress, order, then show", () => {
  it("does the steps in that order for a new saree, with the same ids on every call, and goes to the saree's page", async () => {
    const { actions, uploader, go } = show();
    fill();
    put(choose(), file("a.jpg"), file("b.jpg"));
    fireEvent.click(screen.getByLabelText("Show this saree to customers"));
    await save();
    // 1. the details, hidden (there is no photo yet)
    expect(actions.save).toHaveBeenNthCalledWith(1, ID, expect.objectContaining({ name: "Maroon Kanchi pattu", colours: ["maroon"], fabric: "kanchi_pattu", active: false }));
    // 2. each photo, one at a time, with its own id
    expect(uploader.mock.calls.map((c) => c[1])).toEqual([photoId(1), photoId(2)]);
    // 3. the order already matches, so no reorder; 4. shown last
    expect(actions.reorder).not.toHaveBeenCalled();
    expect(actions.save).toHaveBeenNthCalledWith(2, ID, expect.objectContaining({ active: true }));
    expect(actions.save).toHaveBeenCalledTimes(2);
    expect(go).toHaveBeenCalledWith(`${BASE}/catalogue/${ID}?saved=1`);
  });

  it("saves a saree that is left hidden with one request and no 'show' step", async () => {
    const { actions, go } = show();
    fill();
    put(choose(), file("a.jpg"));
    await save();
    expect(actions.save).toHaveBeenCalledTimes(1);
    expect(actions.save.mock.calls[0][1].active).toBe(false);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("shows how far each upload is while it is sent, then that it is done", async () => {
    let finish!: () => void;
    let report!: (p: number) => void;
    const slow = vi.fn(
      (_b: Blob, id: string, progress: (p: number) => void) =>
        new Promise((resolve) => {
          report = progress;
          finish = () => resolve({ ok: true, photo: parseItem(itemJson({}, [photoJson(id, 1)])).photos[0], photos: parseItem(itemJson({}, [photoJson(id, 1)])).photos });
        }),
    ) as unknown as Uploader;
    const { go } = show({ uploader: slow });
    fill();
    put(choose(), file("a.jpg"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(report).toBeDefined());
    await act(async () => report(55));
    expect(screen.getByText("Uploading 55%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "55");
    expect(screen.getByText("Uploading photo 1 of 1…")).toBeInTheDocument();
    await act(async () => finish());
    await vi.waitFor(() => expect(go).toHaveBeenCalled());
  });

  it("uploads in the order the person chose, so the cover goes up first and the saree ends up in that order", async () => {
    const { uploader, world, go } = show();
    fill();
    put(choose(), file("a.jpg"), file("b.jpg"), file("c.jpg"));
    fireEvent.click(screen.getByRole("button", { name: "Make photo 3 the cover" }));
    await save();
    expect(uploader.mock.calls.map((c) => c[1])).toEqual([photoId(3), photoId(1), photoId(2)]);
    expect(world.state.photos).toEqual([photoId(3), photoId(1), photoId(2)]);
    expect(go).toHaveBeenCalled();
  });

  it("keeps the form and marks the photo that failed, with the reason; the others go through, and a second Save tries only the failed one", async () => {
    let calls = 0;
    const { actions, go, world, uploader } = show({ wrap: (inner) => vi.fn(async (b: Blob, id: string, p: (n: number) => void) => (++calls === 2 ? { ok: false as const, code: "photo_too_large" } : inner(b, id, p))) as unknown as Uploader });
    void uploader;
    fill();
    put(choose(), file("a.jpg"), file("b.jpg"), file("c.jpg"));
    fireEvent.click(screen.getByLabelText("Show this saree to customers"));
    await save();
    expect(go).not.toHaveBeenCalled();
    expect(tray()[1]).toHaveTextContent("Not uploaded: This photo is bigger than 5 MB.");
    expect(tray()[0]).toHaveTextContent("Uploaded");
    expect(tray()[2]).toHaveTextContent("Uploaded");
    expect(screen.getByText("The details were saved, but some photos did not upload. Try those again below.")).toBeInTheDocument();
    // the saree has two photos, so it is shown anyway
    expect(world.state.active).toBe(true);
    expect(world.state.photos).toEqual([photoId(1), photoId(3)]);
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Try this photo again" })));
    expect(calls).toBe(4); // three the first time, then only the failed photo again
    expect(actions.reorder).toHaveBeenCalledWith(ID, [photoId(1), photoId(2), photoId(3)]); // it arrived last, so it was put back in its place
    expect(world.state.photos).toEqual([photoId(1), photoId(2), photoId(3)]);
    expect(go).toHaveBeenCalledWith(`${BASE}/catalogue/${ID}?saved=1`);
  });

  it.each([
    ["network", "The connection dropped. Try again."],
    ["photo_type_unsupported", "Use a JPEG, PNG or WebP photo."],
    ["photo_unreadable", "This file could not be read as a photo."],
    ["photo_too_big", "This photo is too large in pixels. Take it again at a lower size."],
    ["photo_animated", "Animated pictures cannot be used. Choose a still photo."],
    ["photo_files_missing", "The photo did not finish uploading. Try again."],
    ["too_many_photos", "An item can have 8 photos at most."],
    ["something_new", "The photo could not be uploaded. Try again."],
  ])("says what went wrong with an upload in our own words: %s", async (code, sentence) => {
    show({ uploader: vi.fn(async () => ({ ok: false as const, code })) as unknown as Uploader });
    fill();
    put(choose(), file("a.jpg"));
    await save();
    expect(tray()[0]).toHaveTextContent(`Not uploaded: ${sentence}`);
  });

  it("a photo the browser cannot prepare (too big even after shrinking) is marked and never sent", async () => {
    const world = makeWorld(null);
    const prepare = vi.fn(async () => ({ ok: false as const, code: "photo_too_large" as const }));
    render(<ItemEditor base={BASE} itemId={ID} item={null} role="owner" words={WORDS} uploadUrl="/u" actions={world.actions} uploader={world.uploader} prepare={prepare} go={vi.fn()} />);
    fill();
    put(choose(), file("huge.jpg"));
    await save();
    expect(world.uploader).not.toHaveBeenCalled();
    expect(tray()[0]).toHaveTextContent("Not uploaded: This photo is bigger than 5 MB.");
  });

  it("a refusal of the save is shown in our words; a missing second factor points at the Security page; nothing is uploaded", async () => {
    const actions = fakeEditorActions({ save: vi.fn(async () => ({ ok: false as const, error: "This needs your authenticator app. Nothing was changed.", mfa: true })) });
    const { uploader, go } = show({ actions });
    fill();
    put(choose(), file("a.jpg"));
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("This needs your authenticator app.");
    expect(within(screen.getByRole("alert")).getByRole("link", { name: "Open Security" })).toHaveAttribute("href", "/app/security");
    expect(uploader).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("checks the name and the colours first, in words, and sends nothing", async () => {
    const { actions } = show();
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Write a name for the saree.");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Saree" } });
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Pick one to four colours.");
    expect(actions.save).not.toHaveBeenCalled();
  });

  it("allows at most four colours and four occasions", () => {
    show();
    for (const c of ["Red", "Maroon", "Pink", "Orange"]) fireEvent.click(screen.getByLabelText(c));
    expect(screen.getByLabelText("Yellow")).toBeDisabled();
    expect(screen.getByLabelText("Red")).toBeEnabled();
    for (const o of ["Wedding", "Festival", "Every day", "Party"]) fireEvent.click(screen.getByLabelText(o));
    expect(screen.getAllByRole("checkbox").filter((c) => (c as HTMLInputElement).checked)).toHaveLength(8);
  });

  it("a second press while it works does nothing (one chain of requests), and every control is off meanwhile", async () => {
    let release!: () => void;
    const slowSave = vi.fn(() => new Promise((resolve) => (release = () => resolve({ ok: true, item: item({}, []) }))));
    const { actions } = show({ actions: fakeEditorActions({ save: slowSave }) });
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(slowSave).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
    expect(screen.getByLabelText("Name")).toBeDisabled();
    fireEvent.submit(document.querySelector("form")!);
    expect(actions.save).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
  });
});

describe("changing a saree that exists", () => {
  it("starts from what is saved, and keeps a saree that is shown shown (its details are sent as shown at once)", async () => {
    const { actions, go } = show({ item: item() });
    expect(screen.getByLabelText("Name")).toHaveValue("DEMO Maroon Kanchi pattu");
    expect(screen.getByLabelText("Border")).toHaveValue("Temple border in gold zari");
    expect(screen.getByLabelText("Maroon")).toBeChecked();
    expect(screen.getByLabelText("Show this saree to customers")).toBeChecked();
    expect(tray()).toHaveLength(3);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New name" } });
    await save();
    expect(actions.save).toHaveBeenCalledTimes(1);
    expect(actions.save.mock.calls[0][1]).toMatchObject({ name: "New name", active: true });
    expect(go).toHaveBeenCalledWith(`${BASE}/catalogue/${ID}?saved=1`);
  });

  it("hiding a shown saree sends it hidden first of all", async () => {
    const { actions } = show({ item: item() });
    fireEvent.click(screen.getByLabelText("Show this saree to customers"));
    await save();
    expect(actions.save.mock.calls[0][1].active).toBe(false);
  });

  it("showing a hidden saree is the LAST step, after the photos are in place", async () => {
    const hidden = item({ active: false });
    const { actions } = show({ item: hidden });
    fireEvent.click(screen.getByLabelText("Show this saree to customers"));
    await save();
    expect(actions.save.mock.calls.map((c) => c[1].active)).toEqual([false, true]);
  });

  it("removes the photos the person took off AFTER the new ones are in (a shown saree never has none), then puts the rest in order", async () => {
    const base = item();
    const world = makeWorld(base);
    const order: string[] = [];
    const trace = <F extends (...a: never[]) => unknown>(name: string, fn: F) => (vi.fn((...a: Parameters<F>) => (order.push(name), fn(...a))) as unknown) as F;
    const actions = { save: trace("save", world.actions.save), remove: trace("remove", world.actions.remove), reorder: trace("reorder", world.actions.reorder) } as unknown as typeof world.actions;
    const uploader = trace("upload", world.uploader) as unknown as Uploader;
    show({ item: base, actions, uploader });
    fireEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
    put(choose(), file("new.jpg"));
    fireEvent.click(screen.getByRole("button", { name: "Make photo 3 the cover" }));
    await save();
    expect(order).toEqual(["save", "upload", "remove", "reorder"]);
    expect(actions.remove).toHaveBeenCalledWith(base.photos[0].id);
    expect(world.state.photos).toEqual([photoId(1), base.photos[1].id, base.photos[2].id]);
  });

  it("a photo that was uploaded and then taken off the list in the same visit is removed on the server too", async () => {
    let calls = 0;
    const { world, actions } = show({ wrap: (inner) => vi.fn(async (b: Blob, id: string, p: (n: number) => void) => (++calls === 2 ? { ok: false as const, code: "network" } : inner(b, id, p))) as unknown as Uploader });
    fill();
    put(choose(), file("a.jpg"), file("b.jpg"));
    await save(); // the first photo went up, the second failed
    expect(world.state.photos).toEqual([photoId(1)]);
    fireEvent.click(screen.getByRole("button", { name: "Remove photo 2" })); // the failed one: nothing to take off the server
    fireEvent.click(screen.getByRole("button", { name: "Remove photo 1" })); // the one that went up
    put(choose(), file("c.jpg"));
    await save();
    expect(actions.remove).toHaveBeenCalledWith(photoId(1));
    expect(world.state.photos).toEqual([photoId(3)]);
  });
});

describe("the exact price is the owner's alone", () => {
  it("the owner has the price field, with the second-factor note; an admin has none and is told who can set it", () => {
    show({ item: item({ price_paise: null, price_text: null }) });
    expect(screen.getByLabelText(/Exact price/)).toBeInTheDocument();
    expect(screen.getByText(/needs your authenticator code/)).toBeInTheDocument();
    cleanup();
    show({ item: item(), role: "admin" });
    expect(screen.queryByLabelText(/Exact price/)).toBeNull();
    expect(screen.getByText("Only the owner can set an exact price. Customers are told the price range.")).toBeInTheDocument();
    expect(screen.getByText("₹38,500.00")).toBeInTheDocument();
  });

  it("an admin's save carries no price at all, so the price stays as it is", async () => {
    const { actions } = show({ item: item(), role: "admin" });
    await save();
    expect("price" in actions.save.mock.calls[0][1]).toBe(false);
  });

  it("the owner leaving the field empty keeps the price (no price sent); typing an amount sets it; the box clears it", async () => {
    const { actions } = show({ item: item() });
    expect(screen.getByText("Exact price now: ₹38,500.00")).toBeInTheDocument();
    await save();
    expect("price" in actions.save.mock.calls[0][1]).toBe(false);
    cleanup();
    const second = show({ item: item() });
    fireEvent.change(screen.getByLabelText(/Exact price/), { target: { value: "41,250.50" } });
    await save();
    expect(second.actions.save.mock.calls[0][1].price).toEqual({ rupees: 41250.5 });
    cleanup();
    const third = show({ item: item() });
    fireEvent.click(screen.getByLabelText("Remove the exact price"));
    expect(screen.getByLabelText(/Exact price/)).toBeDisabled();
    await save();
    expect(third.actions.save.mock.calls[0][1].price).toEqual({ clear: true });
  });

  it("an amount that is not between ₹1 and ₹10,00,000 is refused in words before anything is sent", async () => {
    const { actions } = show({ item: item() });
    for (const bad of ["abc", "0", "1000001", "12.345"]) {
      fireEvent.change(screen.getByLabelText(/Exact price/), { target: { value: bad } });
      await save();
      expect(screen.getByRole("alert")).toHaveTextContent("The exact price must be between ₹1 and ₹10,00,000.");
    }
    expect(actions.save).not.toHaveBeenCalled();
  });

  it("without the second factor the owner is told so and shown the Security page; the price is not retried by itself", async () => {
    const actions = fakeEditorActions({ save: vi.fn(async () => ({ ok: false as const, error: "This needs your authenticator app. Nothing was changed.", mfa: true })) });
    show({ item: item(), actions });
    fireEvent.change(screen.getByLabelText(/Exact price/), { target: { value: "40000" } });
    await save();
    expect(within(screen.getByRole("alert")).getByRole("link", { name: "Open Security" })).toBeInTheDocument();
    expect(actions.save).toHaveBeenCalledTimes(1);
  });
});

describe("the extra fields of the business type (job CL)", () => {
  const fields = [
    { code: "size", kind: "text" as const, label: "Size", required: false, pii: "none" as const },
    { code: "selling_unit", kind: "choice" as const, label: "Selling unit", required: true, pii: "none" as const, choices: [{ code: "sqft", label: "sq ft" }, { code: "piece", label: "piece" }] },
  ];
  it("draws nothing extra for a business type with no fields", () => {
    show();
    expect(document.querySelector("[data-part=custom-fields]")).toBeNull();
  });
  it("draws the fields (starting from the item's values), and keeps them right after the details are saved", async () => {
    const world = makeWorld(null);
    const saveCustom = vi.fn(async () => ({ ok: true as const }));
    const { go } = show({ fields, custom: { size: "200x100" }, actions: { ...world.actions, saveCustom } as never });
    expect(screen.getByRole("group", { name: "More details" })).toBeInTheDocument();
    expect(screen.getByLabelText("Size")).toHaveValue("200x100");
    fill();
    fireEvent.change(screen.getByLabelText("Selling unit"), { target: { value: "sqft" } });
    await save();
    expect(saveCustom).toHaveBeenCalledWith(ID, { size: "200x100", selling_unit: "sqft" });
    expect(go).toHaveBeenCalledWith(expect.stringContaining(`/catalogue/${ID}?saved=1`));
  });
  it("when they cannot be kept it stays on the form with the sentence, and the item was saved all the same", async () => {
    const world = makeWorld(null);
    const saveCustom = vi.fn(async () => ({ ok: false as const, error: "Saved, but the extra details were not: this system cannot keep them yet" }));
    const { go } = show({ fields, actions: { ...world.actions, saveCustom } as never });
    fill();
    await save();
    expect(await screen.findByText(/the extra details were not: this system cannot keep them yet/)).toBeInTheDocument();
    expect(go).not.toHaveBeenCalled();
    expect(world.actions.save).toHaveBeenCalled();
  });
});
