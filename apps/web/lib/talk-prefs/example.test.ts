import { describe, expect, it } from "vitest";

import { callFor, exampleFor } from "./example";

const word = (name: string) => `${name} garu`;
describe("the live example line of How it talks to you", () => {
  it("how it calls the person: by name, name + garu, sir / madam and anna / akka alone; no first name leaves out what needs one", () => {
    expect(callFor("by_name", "Gowtham Reddy", word)).toBe("Gowtham");
    expect(callFor("garu", "Gowtham", word)).toBe("Gowtham garu");
    expect(callFor("sir_madam", "Gowtham", () => "Sir / Madam")).toBe("Sir / Madam");
    expect(callFor("anna_akka", null, () => "Anna / Akka")).toBe("Anna / Akka");
    expect(callFor("by_name", null, word)).toBe("");
    expect(callFor("garu", "", word)).toBe("");
  });
  it("the friendly sample greets with the call in the name's place, the others get it in front, nothing is left over when there is no name", () => {
    expect(exampleFor("en", "friendly", "Gowtham garu")).toBe("Hi Gowtham garu! Three new enquiries came in. Want me to call them?");
    expect(exampleFor("en", "friendly", "")).toBe("Hi! Three new enquiries came in. Want me to call them?");
    expect(exampleFor("en", "short_direct", "Sir / Madam")).toBe("Sir / Madam, Three new enquiries. Call them?");
    expect(exampleFor("en", "respectful", "")).toBe("Good morning. Three new enquiries have come in. Shall I call them?");
    expect(exampleFor("te", "friendly", "Gowtham")).not.toMatch(/[{}]/);
  });
});
