import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { slLoadRegistry } from "../../SL-src/SL-core/SL-registry.js";
import {
  slCreateTestRepository,
  slRemoveTestRepository,
} from "../SL-fixtures/SL-test-repository.js";

const repositories: string[] = [];
const cliPath = resolve("dist/SL-src/SL-cli/SL-cli.js");

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(slRemoveTestRepository));
});

function runCli(argumentsList: string[]): string {
  return execFileSync(process.execPath, [cliPath, ...argumentsList], {
    encoding: "utf8",
  });
}

describe("sl-repo CLI", () => {
  test(
    "installs, captures, and validates a repository",
    async () => {
      const root = await slCreateTestRepository();
      repositories.push(root);

      expect(runCli(["init", root])).toContain(
        ".github/SL-learning/SL-config.yml",
      );
      const captureOutput = runCli([
          "capture",
          root,
          "--title",
          "CLI verified lesson",
          "--kind",
          "win",
          "--scope",
          "tests",
          "--trigger",
          "cli verification",
        ]);
      expect(captureOutput).toContain("SL-");
      const lessonId = captureOutput.split(/\s+/).find((value) =>
        value.startsWith("SL-202"),
      );
      if (!lessonId) {
        throw new Error("CLI output did not contain a lesson ID.");
      }
      expect(runCli(["vote", lessonId, root, "--useful"])).toContain(
        ".github/SL-learning/SL-lessons",
      );
      expect(runCli(["validate", root])).toContain("SL validation passed.");

      const registry = await slLoadRegistry(root);
      expect(
        registry.artifacts.some(
          (artifact) => artifact.classification === "evidence",
        ),
      ).toBe(true);
    },
    120_000,
  );
});
