import { describe, expect, it } from "vitest";
import { AmtError } from "./errors.js";
import { fail, text } from "./mcp.js";

describe("tool result helpers", () => {
  it("serialises objects as pretty JSON", () => {
    const result = text({ a: 1 });
    expect(result.content[0].text).toBe('{\n  "a": 1\n}');
  });

  it("keeps plain strings untouched", () => {
    expect(text("hello").content[0].text).toBe("hello");
  });

  it("adds detail and hint to an error result", () => {
    const result = fail(new AmtError("Ed is not connected.", { detail: "no token", hint: "Run login ed." }));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Ed is not connected.\n\nDetails: no token\n\nRun login ed.");
  });

  it("handles non-Error throws", () => {
    const result = fail("boom");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("boom");
  });
});
