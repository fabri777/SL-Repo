import { describe, expect, test } from "vitest";
import {
  slParseMarkdown,
  slStringifyMarkdown,
} from "../../SL-src/SL-core/SL-frontmatter.js";

describe("SL frontmatter", () => {
  test("round trips metadata and body", () => {
    const content = slStringifyMarkdown(
      {
        id: "SL-EXAMPLE",
        trigger: ["one", "two"],
        pinned: false,
      },
      "# Body\n\nEvidence.",
    );

    const parsed = slParseMarkdown<Record<string, unknown>>(content);

    expect(parsed.frontmatter).toEqual({
      id: "SL-EXAMPLE",
      trigger: ["one", "two"],
      pinned: false,
    });
    expect(parsed.body.trim()).toBe("# Body\n\nEvidence.");
  });
});
