import {
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  slAppendEvents,
  slCreateLifecycleEvent,
  slLifecycleEventPath,
} from "../../SL-src/SL-core/SL-registry.js";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import {
  SL_DEFAULT_SCOPE,
  slScopeCatalogEntry,
} from "../../SL-src/SL-core/SL-state.js";
import {
  slCreateUsageEvent,
  slLoadUsageEvents,
  slUsageEventPath,
  slWriteUsageEvent,
} from "../../SL-src/SL-core/SL-usage.js";
import { slValidateRepository } from "../../SL-src/SL-validation/SL-validation.js";
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

    const learningPath = join(root, ".github", "sl-learning");
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

  test("rejects a usage event directory junction outside the repository", async () => {
    const root = await slCreateTestRepository();
    const outside = await slCreateTestRepository();
    repositories.push(root, outside);
    await slInstall(root, "init", false);

    const usagePath = join(
      root,
      ...slScopeCatalogEntry(SL_DEFAULT_SCOPE).usageEventsPath.split("/"),
    );
    const outsideUsage = join(outside, "outside-usage");
    await mkdir(outsideUsage);
    await symlink(
      outsideUsage,
      usagePath,
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(slLoadUsageEvents(root)).rejects.toThrow(
      "Path resolves outside repository root",
    );
    expect(await slValidateRepository(root)).toContainEqual(
      expect.objectContaining({
        code: "scope-shard-containment",
        path: ".github/sl-learning/sl-state-catalog.json",
      }),
    );
  });

  test("replays immutable lifecycle and usage events after CRLF checkout conversion", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const lifecycleSource = {
      schemaVersion: 1 as const,
      timestamp: "2026-09-03T00:00:00.000Z",
      artifactId: "SL-TEST-CRLF",
      action: "registered" as const,
    };
    const lifecycleEvent = slCreateLifecycleEvent(lifecycleSource);
    const usageEvent = slCreateUsageEvent({
      artifactId: "SL-TEST-CRLF",
      artifactContentHash: "a".repeat(64),
      taskRunId: "crlf-task",
      applicationId: "crlf-application",
      stage: "verified",
      outcome: "success",
      verifierType: "test-suite",
      timestamp: "2026-09-03T01:00:00.000Z",
      idempotencyKey: "crlf-usage",
    });

    await slAppendEvents(root, [lifecycleSource], false);
    await slWriteUsageEvent(root, usageEvent, false);
    for (const relativePath of [
      slLifecycleEventPath(lifecycleEvent),
      slUsageEventPath(usageEvent),
    ]) {
      const path = join(root, relativePath);
      const content = await readFile(path, "utf8");
      await writeFile(path, content.replaceAll("\n", "\r\n"), "utf8");
    }

    await expect(
      slAppendEvents(root, [lifecycleSource], false),
    ).resolves.toBeUndefined();
    await expect(
      slWriteUsageEvent(root, usageEvent, false),
    ).resolves.toEqual({
      action: "skip",
      path: slUsageEventPath(usageEvent),
      detail: "idempotent event already recorded",
    });
  });
});
