import { describe, expect, it } from "vitest";

import { avatarOf, AVATAR_COLOURS, chatTime } from "./display";

const NOW = Date.parse("2026-11-13T06:00:00Z"); // 11:30 on Friday 13 Nov, India

describe("the chat list's avatars", () => {
  it("the first letter in capitals, and the same colour for the same name every time, always one of six", () => {
    expect(avatarOf("  kavya").letter).toBe("K");
    expect(avatarOf("Kavya")).toEqual(avatarOf("kavya"));
    for (const n of ["Kavya", "Anitha", "Lakshmi", "Ravi", "Sunitha", "Meena", "అనిత", ""]) expect(avatarOf(n).colour).toBeLessThan(AVATAR_COLOURS);
    expect(avatarOf("అనిత").letter).toBe("అ");
    expect(avatarOf("").letter).toBe("?");
  });
});

describe("the time of the last message", () => {
  it("the clock today, Yesterday, the weekday this week, the day after that", () => {
    expect(chatTime("2026-11-13T04:14:00Z", NOW, "Yesterday")).toBe("9:44");
    expect(chatTime("2026-11-12T18:00:00Z", NOW, "Yesterday")).toBe("Yesterday"); // 23:30 on the 12th in India
    expect(chatTime("2026-11-12T05:00:00Z", NOW, "Yesterday")).toBe("Yesterday");
    expect(chatTime("2026-11-09T05:00:00Z", NOW, "Yesterday")).toBe("Mon");
    expect(chatTime("2026-11-02T05:00:00Z", NOW, "Yesterday")).toBe("2 Nov");
    expect(chatTime("not a time", NOW, "Yesterday")).toBe("");
  });
});
