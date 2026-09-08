import { afterEach, describe, expect, test } from "vitest";
import { slCaptureLesson } from "../../SL-src/SL-core/SL-capture.js";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import { slLoadRegistry } from "../../SL-src/SL-core/SL-registry.js";
import { slValidateRepository } from "../../SL-src/SL-validation/SL-validation.js";
import {
  slCreateTestRepository,
  slRemoveTestRepository,
} from "../SL-fixtures/SL-test-repository.js";

const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(slRemoveTestRepository));
});

describe("SL capture and index", () => {
  test("creates deterministic registered evidence", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);

    const result = await slCaptureLesson(root, {
      title: "Command timeout must match busy timeout",
      kind: "pitfall",
      scope: "database",
      triggers: ["sqlite busy timeout", "command timeout"],
      dryRun: false,
      now: new Date("2026-09-03T10:00:00.000Z"),
    });

    expect(result.id).toBe("SL-20260903-COMMAND-TIMEOUT-MUST-MATCH-BUSY-TIMEOUT");
    expect(result.path).toBe(
      ".github/sl-learning/sl-lessons/2026-09/sl-2026-09-03-command-timeout-must-match-busy-timeout.md",
    );
    const registry = await slLoadRegistry(root);
    const lesson = registry.artifacts.find((artifact) => artifact.id === result.id);
    expect(lesson).toMatchObject({
      classification: "evidence",
      status: "raw",
      pinned: false,
    });

    const issues = await slValidateRepository(root);
    expect(issues).toEqual([]);
  });
});
