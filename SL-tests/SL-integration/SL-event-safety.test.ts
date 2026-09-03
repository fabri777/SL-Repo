import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  slAppendEvents,
} from "../../SL-src/SL-core/SL-registry.js";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import {
  slCreateTestRepository,
  slRemoveTestRepository,
} from "../SL-fixtures/SL-test-repository.js";

const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(slRemoveTestRepository));
});

describe("SL event safety", () => {
  test("rejects an event directory junction outside the repository", async () => {
    const root = await slCreateTestRepository();
    const outside = await slCreateTestRepository();
    repositories.push(root, outside);
    await slInstall(root, "init", false);

    const learningPath = join(root, ".github", "SL-learning");
    const outsideLearning = join(outside, "outside-learning");
    await mkdir(outsideLearning);
    await writeFile(join(outsideLearning, "SL-events.jsonl"), "", "utf8");
    await rm(learningPath, { recursive: true });
    await symlink(
      outsideLearning,
      learningPath,
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      slAppendEvents(
        root,
        [
          {
            schemaVersion: 1,
            timestamp: "2026-09-03T00:00:00.000Z",
            artifactId: "SL-TEST",
            action: "registered",
          },
        ],
        false,
      ),
    ).rejects.toThrow("Path resolves outside repository root");
  });
});
