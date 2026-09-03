import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import { slValidateRepository } from "../../SL-src/SL-validation/SL-validation.js";
import {
  slCreateTestRepository,
  slRemoveTestRepository,
} from "../SL-fixtures/SL-test-repository.js";

const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(slRemoveTestRepository));
});

describe("SL validation", () => {
  test("rejects unregistered lessons", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const lessonDirectory = join(
      root,
      ".github",
      "SL-learning",
      "SL-lessons",
      "2026-09",
    );
    await mkdir(lessonDirectory, { recursive: true });
    await writeFile(
      join(lessonDirectory, "SL-2026-09-03-unregistered.md"),
      "---\nid: SL-UNREGISTERED\n---\n",
      "utf8",
    );

    const issues = await slValidateRepository(root);

    expect(issues).toContainEqual(
      expect.objectContaining({ code: "unregistered-lesson" }),
    );
  });
});
