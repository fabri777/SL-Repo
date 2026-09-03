import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { slCaptureLesson } from "../../SL-src/SL-core/SL-capture.js";
import {
  slParseMarkdown,
  slStringifyMarkdown,
} from "../../SL-src/SL-core/SL-frontmatter.js";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import {
  slLoadRegistry,
  slSaveRegistry,
} from "../../SL-src/SL-core/SL-registry.js";
import {
  slLoadUsageEvents,
  slProjectUsage,
} from "../../SL-src/SL-core/SL-usage.js";
import { slVoteOnLesson } from "../../SL-src/SL-core/SL-vote.js";
import {
  slCreateTestRepository,
  slRemoveTestRepository,
} from "../SL-fixtures/SL-test-repository.js";

const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(slRemoveTestRepository));
});

describe("SL reuse voting", () => {
  test("promotes repeatedly useful evidence to a promotion candidate", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const lesson = await slCaptureLesson(root, {
      title: "Reusable hard-won outcome",
      kind: "win",
      scope: "tests",
      triggers: ["hard-won outcome"],
      dryRun: false,
      now: new Date("2026-09-03T08:00:00.000Z"),
    });

    await slVoteOnLesson(
      root,
      lesson.id,
      "useful",
      false,
      new Date("2026-09-03T09:00:00.000Z"),
      {
        taskRunId: "task-1",
        applicationId: "application-1",
        idempotencyKey: "vote-1",
      },
    );
    await slVoteOnLesson(
      root,
      lesson.id,
      "useful",
      false,
      new Date("2026-09-03T10:00:00.000Z"),
      {
        taskRunId: "task-2",
        applicationId: "application-2",
        idempotencyKey: "vote-2",
      },
    );
    await slVoteOnLesson(
      root,
      lesson.id,
      "useful",
      false,
      new Date("2026-09-03T11:00:00.000Z"),
      {
        taskRunId: "task-3",
        applicationId: "application-3",
        idempotencyKey: "vote-3",
      },
    );

    const registry = await slLoadRegistry(root);
    expect(
      registry.artifacts.find((artifact) => artifact.id === lesson.id),
    ).toMatchObject({
      status: "promotion-candidate",
      hits: 0,
      retrievals: 0,
      notUsefulVotes: 0,
    });
    expect(await slProjectUsage(root, lesson.id)).toEqual([
      expect.objectContaining({
        retrievalCount: 3,
        applicationCount: 3,
        verifiedSuccessCount: 3,
        verifiedFailureCount: 0,
        unknownCount: 0,
        verifiedSuccessRate: 1,
        lastVerifiedSuccessAt: "2026-09-03T11:00:00.000Z",
      }),
    ]);
  });

  test("records an unhelpful retrieval without extending successful reuse", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const lesson = await slCaptureLesson(root, {
      title: "Unhelpful retrieved lesson",
      kind: "pitfall",
      scope: "tests",
      triggers: ["unhelpful lesson"],
      dryRun: false,
      now: new Date("2026-09-03T08:00:00.000Z"),
    });

    await slVoteOnLesson(
      root,
      lesson.id,
      "not-useful",
      false,
      new Date("2026-09-03T09:00:00.000Z"),
      {
        taskRunId: "task-unhelpful",
        applicationId: "application-unhelpful",
        idempotencyKey: "vote-unhelpful",
      },
    );

    const registry = await slLoadRegistry(root);
    const artifact = registry.artifacts.find(
      (candidate) => candidate.id === lesson.id,
    );
    expect(artifact).toMatchObject({
      status: "raw",
      hits: 0,
      retrievals: 0,
      notUsefulVotes: 0,
    });
    expect(artifact?.lastSuccessfulUseAt).toBeUndefined();
    expect(await slProjectUsage(root, lesson.id)).toEqual([
      expect.objectContaining({
        retrievalCount: 1,
        applicationCount: 1,
        verifiedSuccessCount: 0,
        verifiedFailureCount: 1,
        unknownCount: 0,
        verifiedSuccessRate: 0,
      }),
    ]);
  });

  test("deduplicates retried votes with the same application identity", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const lesson = await slCaptureLesson(root, {
      title: "Retry-safe lesson",
      kind: "win",
      scope: "tests",
      triggers: ["retry safe"],
      dryRun: false,
      now: new Date("2026-09-03T08:00:00.000Z"),
    });
    const context = {
      taskRunId: "task-retry",
      applicationId: "application-retry",
      idempotencyKey: "stable-retry-key",
    };

    await slVoteOnLesson(
      root,
      lesson.id,
      "useful",
      false,
      new Date("2026-09-03T09:00:00.000Z"),
      context,
    );
    const retryChanges = await slVoteOnLesson(
      root,
      lesson.id,
      "useful",
      false,
      new Date("2026-09-03T10:00:00.000Z"),
      context,
    );

    expect(retryChanges).toContainEqual(
      expect.objectContaining({
        action: "skip",
        detail: "idempotent event already recorded",
      }),
    );
    expect(await slProjectUsage(root, lesson.id)).toEqual([
      expect.objectContaining({
        retrievalCount: 1,
        applicationCount: 1,
        verifiedSuccessCount: 1,
        lastVerifiedSuccessAt: "2026-09-03T09:00:00.000Z",
      }),
    ]);
    await expect(
      slVoteOnLesson(
        root,
        lesson.id,
        "not-useful",
        false,
        new Date("2026-09-03T11:00:00.000Z"),
        context,
      ),
    ).rejects.toThrow("Immutable SL usage event collision");
  });

  test("rejects application ID reuse when voting on another artifact", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const firstLesson = await slCaptureLesson(root, {
      title: "First globally identified vote",
      kind: "win",
      scope: "tests",
      triggers: ["first global vote"],
      dryRun: false,
      now: new Date("2026-09-03T08:00:00.000Z"),
    });
    const secondLesson = await slCaptureLesson(root, {
      title: "Second globally identified vote",
      kind: "win",
      scope: "tests",
      triggers: ["second global vote"],
      dryRun: false,
      now: new Date("2026-09-03T08:01:00.000Z"),
    });
    await slVoteOnLesson(
      root,
      firstLesson.id,
      "useful",
      false,
      new Date("2026-09-03T09:00:00.000Z"),
      {
        taskRunId: "shared-vote-task",
        applicationId: "shared-vote-application",
        idempotencyKey: "first-shared-vote",
      },
    );
    const registryPath = join(
      root,
      ".github",
      "SL-learning",
      "SL-registry.json",
    );
    const indexPath = join(root, ".github", "SL-learning", "SL-index.json");
    const beforeRegistry = await readFile(registryPath, "utf8");
    const beforeIndex = await readFile(indexPath, "utf8");
    const beforeSecondLesson = await readFile(
      join(root, secondLesson.path),
      "utf8",
    );

    await expect(
      slVoteOnLesson(
        root,
        secondLesson.id,
        "useful",
        false,
        new Date("2026-09-03T10:00:00.000Z"),
        {
          taskRunId: "shared-vote-task",
          applicationId: "shared-vote-application",
          idempotencyKey: "second-shared-vote",
        },
      ),
    ).rejects.toThrow("already bound to different usage identity data");

    expect(await slLoadUsageEvents(root)).toHaveLength(1);
    expect(await readFile(registryPath, "utf8")).toBe(beforeRegistry);
    expect(await readFile(indexPath, "utf8")).toBe(beforeIndex);
    expect(await readFile(join(root, secondLesson.path), "utf8")).toBe(
      beforeSecondLesson,
    );
  });

  test("rejects voting after managedBy is removed without partial writes", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const lesson = await slCaptureLesson(root, {
      title: "Removed ownership vote",
      kind: "win",
      scope: "tests",
      triggers: ["removed ownership vote"],
      dryRun: false,
      now: new Date("2026-09-03T08:00:00.000Z"),
    });
    const lessonPath = join(root, lesson.path);
    const markdown = slParseMarkdown<Record<string, unknown>>(
      await readFile(lessonPath, "utf8"),
    );
    delete markdown.frontmatter.managedBy;
    await writeFile(
      lessonPath,
      slStringifyMarkdown(markdown.frontmatter, markdown.body),
      "utf8",
    );
    const registryPath = join(
      root,
      ".github",
      "SL-learning",
      "SL-registry.json",
    );
    const indexPath = join(root, ".github", "SL-learning", "SL-index.json");
    const beforeLesson = await readFile(lessonPath, "utf8");
    const beforeRegistry = await readFile(registryPath, "utf8");
    const beforeIndex = await readFile(indexPath, "utf8");

    await expect(
      slVoteOnLesson(
        root,
        lesson.id,
        "useful",
        false,
        new Date("2026-09-03T09:00:00.000Z"),
        {
          taskRunId: "removed-owner-task",
          applicationId: "removed-owner-application",
          idempotencyKey: "removed-owner-vote",
        },
      ),
    ).rejects.toThrow("file ownership does not match the registry");

    expect(await slLoadUsageEvents(root)).toEqual([]);
    expect(await readFile(lessonPath, "utf8")).toBe(beforeLesson);
    expect(await readFile(registryPath, "utf8")).toBe(beforeRegistry);
    expect(await readFile(indexPath, "utf8")).toBe(beforeIndex);
  });

  test("migrates existing counters into an immutable baseline", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const lesson = await slCaptureLesson(root, {
      title: "Legacy counter lesson",
      kind: "win",
      scope: "tests",
      triggers: ["legacy counter"],
      dryRun: false,
      now: new Date("2026-09-01T08:00:00.000Z"),
    });
    const registry = await slLoadRegistry(root);
    const artifact = registry.artifacts.find(
      (candidate) => candidate.id === lesson.id,
    );
    if (!artifact) {
      throw new Error("Captured lesson was not registered.");
    }
    artifact.hits = 2;
    artifact.retrievals = 3;
    artifact.notUsefulVotes = 1;
    artifact.lastRetrievedAt = "2026-09-02T10:00:00.000Z";
    artifact.lastSuccessfulUseAt = "2026-09-02T09:00:00.000Z";
    await slSaveRegistry(root, registry, false, []);

    await slVoteOnLesson(
      root,
      lesson.id,
      "useful",
      false,
      new Date("2026-09-03T09:00:00.000Z"),
      {
        taskRunId: "task-after-migration",
        applicationId: "application-after-migration",
        idempotencyKey: "vote-after-migration",
      },
    );

    const updatedRegistry = await slLoadRegistry(root);
    expect(
      updatedRegistry.artifacts.find(
        (candidate) => candidate.id === lesson.id,
      ),
    ).toMatchObject({
      status: "promotion-candidate",
      hits: 2,
      retrievals: 3,
      notUsefulVotes: 1,
    });
    expect(await slProjectUsage(root, lesson.id)).toEqual([
      expect.objectContaining({
        retrievalCount: 4,
        applicationCount: 4,
        verifiedSuccessCount: 3,
        verifiedFailureCount: 1,
        unknownCount: 0,
        verifiedSuccessRate: 0.75,
        lastVerifiedSuccessAt: "2026-09-03T09:00:00.000Z",
      }),
    ]);
    expect(
      (await slLoadUsageEvents(root)).filter(
        (event) => event.eventType === "legacy-baseline",
      ),
    ).toHaveLength(1);
  });
});
