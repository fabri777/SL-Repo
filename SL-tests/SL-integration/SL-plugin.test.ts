import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("SL plugin package", () => {
  test("contains the manifest and all milestone skills", async () => {
    const manifest = JSON.parse(
      await readFile(resolve("SL-plugin/plugin.json"), "utf8"),
    ) as { name: string; version: string };

    expect(manifest).toMatchObject({ name: "sl-repo", version: "0.1.0" });
    for (const skill of [
      "SL-bootstrap",
      "SL-lesson-curator",
      "SL-learning-audit",
    ]) {
      const content = await readFile(
        resolve("SL-plugin", "skills", skill, "SKILL.md"),
        "utf8",
      );
      expect(content).toContain(`name: ${skill}`);
    }
  });
});
