import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { fixtureTransport } from "@/lib/assistant-work/client";
import { checkFile, fileKindOf, MAX_FILE_MB } from "@/lib/assistant-work/files";
import { appT } from "@/i18n/app";
import { wordsFor } from "@/i18n/app-words";

import { useChatWork } from "./use-chat-work";

afterEach(cleanup);

const words = wordsFor("en", ["bv.work."]);

function Host() {
  const [text, setText] = React.useState("");
  const work = useChatWork({ mode: "mock", role: "owner" }, "/app/tenants/T", words, setText, fixtureTransport());
  return (
    <form {...work.dropProps}>
      <textarea aria-label="box" value={text} onChange={(e) => setText(e.target.value)} onPaste={work.onPaste} />
      {work.cameraInput}
      {work.input}
      <button type="button" onClick={work.pick}>pick</button>
      {work.chips}
    </form>
  );
}

describe("files in the chat: 20 MB, more picture types, paste and camera", () => {
  it("takes up to 20 MB and WebP / GIF pictures", () => {
    expect(MAX_FILE_MB).toBe(20);
    expect(fileKindOf("scan.webp")).toBe("image");
    expect(fileKindOf("a.gif")).toBe("image");
    expect(checkFile({ name: "list.pdf", size: 19 * 1024 * 1024 }, 0)).toBeNull();
    expect(checkFile({ name: "list.pdf", size: 21 * 1024 * 1024 }, 0)).toBe("size");
  });

  it("a screenshot pasted into the box becomes a chip; plain pasted text is left alone", async () => {
    render(<Host />);
    const png = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
    const box = screen.getByLabelText("box");
    fireEvent.paste(box, { clipboardData: { files: [png], getData: () => "" } });
    await waitFor(() => expect(document.querySelector('[data-chat="file-chip"]')).not.toBeNull());
    expect(document.querySelector('[data-chat="file-chip"]')?.textContent).toMatch(/screenshot-\d+-1\.png/);
    cleanup();
    render(<Host />);
    fireEvent.paste(screen.getByLabelText("box"), { clipboardData: { files: [], getData: () => "hello" } });
    expect(document.querySelector('[data-chat="file-chip"]')).toBeNull();
  });

  it("the camera input asks the phone for a picture and goes through the same upload", async () => {
    render(<Host />);
    const cam = document.querySelector('[data-chat="camera-input"]') as HTMLInputElement;
    expect(cam.getAttribute("capture")).toBe("environment");
    expect(cam.accept).toBe("image/*");
    const jpg = new File([new Uint8Array([1, 2, 3])], "IMG_1.jpg", { type: "image/jpeg" });
    await act(async () => {
      fireEvent.change(cam, { target: { files: [jpg] } });
    });
    await waitFor(() => expect(document.querySelector('[data-chat="file-chip"]')).not.toBeNull());
  });

  it("says in words that an unsafe file was not opened, and takes the new camera word", () => {
    const t = appT("en");
    expect(t("bv.work.file.err.unsafe" as "frame.notyet")).toBe("That file looks unsafe, so I did not open it.");
    expect(t("bv.work.file.camera" as "frame.notyet")).toBe("Take photo");
  });
});
