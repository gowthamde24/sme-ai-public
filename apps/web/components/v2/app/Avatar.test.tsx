import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Avatar } from "./Avatar";

describe("the round mark of a person", () => {
  it("always has the letters, and no picture element when there is no link", () => {
    const { container } = render(<Avatar url={null} letters="LP" className="x" />);
    expect(container).toHaveTextContent("LP");
    expect(container.querySelector("img,[style]")).toBeNull();
  });
  it("draws the picture as a background (never an <img>: a link that ran out would show the browser's broken-picture mark), with the link quoted", () => {
    const { container } = render(<Avatar url={'https://lh3.googleusercontent.com/a/x=s96-c"); color:red; ("'} letters="LP" className="x" />);
    expect(container.querySelector("img")).toBeNull();
    const bg = container.querySelector<HTMLElement>("[style]")!;
    expect(bg.getAttribute("style")).toContain('url("https://lh3.googleusercontent.com/a/x=s96-c\\"); color:red; (\\"")');
    expect(bg.style.color).toBe(""); // the quote cannot be closed from inside the link
  });
});
