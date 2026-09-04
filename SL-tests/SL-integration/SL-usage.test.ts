import {
  access,
  mkdir,
  readFile,
  utimes,
  writeFile,
} from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  slArtifactUsageContentHash,
  slCreateUsageEvent,
  slFinishUsage,
  slLoadUsageEvents,
  slProjectUsage,
  slProjectUsageEvents,
  slStartUsage,
  slSynchronizeUsageProjection,
  slUsageEventPath,
  slWriteUsageEvent,
} from "../../SL-src/SL-core/SL-usage.js";
import {
  SL_DEFAULT_SCOPE,
  slScopeCatalogEntry,
} from "../../SL-src/SL-core/SL-state.js";
import { slCaptureLesson } from "../../SL-src/SL-core/SL-capture.js";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import {
  slParseMarkdown,
  slStringifyMarkdown,
} from "../../SL-src/SL-core/SL-frontmatter.js";
import {
  SL_REPOSITORY_MUTATION_LOCK_OWNER,
  SL_REPOSITORY_MUTATION_LOCK_PATH,
  slWithRepositoryMutationLock,
} from "../../SL-src/SL-core/SL-mutation-lock.js";
import { slLoadRegistry } from "../../SL-src/SL-core/SL-registry.js";
import { slVoteOnLesson } from "../../SL-src/SL-core/SL-vote.js";
import type {
  SLUsageOutcome,
  SLUsageStage,
} from "../../SL-src/SL-core/SL-types.js";
import {
  slCreateTestRepository,
  slRemoveTestRepository,
} from "../SL-fixtures/SL-test-repository.js";

const repositories: string[] = [];
const CONTENT_HASH_A = "a".repeat(64);
const CONTENT_HASH_B = "b".repeat(64);
const FIXED_NOW = new Date("2026-09-03T10:00:00.000Z");

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(slRemoveTestRepository));
});

function createEvent(
  applicationId: string,
  stage: SLUsageStage,
  outcome: SLUsageOutcome,
  sequence: number,
  artifactContentHash = CONTENT_HASH_A,
) {
  return slCreateUsageEvent({
    artifactId: "SL-TEST-ARTIFACT",
    artifactContentHash,
    taskRunId: `task-${applicationId}`,
    applicationId,
    stage,
    outcome,
    verifierType:
      stage === "selected" || stage === "applied" ? "unverified" : "test",
    timestamp: `2026-09-03T0${sequence}:00:00.000Z`,
    idempotencyKey: `${applicationId}-${stage}-${sequence}`,
  });
}

describe("SL usage events", () => {
  test("generates safe correlated IDs and records selected and applied stages", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const lesson = await slCaptureLesson(root, {
      title: "Generated usage identity",
      kind: "win",
      scope: "usage",
      triggers: ["generated usage identity"],
      dryRun: false,
      now: FIXED_NOW,
    });

    const result = await slStartUsage(root, lesson.id, { now: FIXED_NOW });
    const events = await slLoadUsageEvents(root);

    expect(result.applicationId).toMatch(
      /^usage-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(result.taskRunId).toBe(result.applicationId);
    expect(result.receiptId).toBe(result.eventIds.applied);
    expect(events.map((event) => event.stage).sort()).toEqual([
      "applied",
      "selected",
    ]);
    expect(new Set(events.map((event) => event.applicationId))).toEqual(
      new Set([result.applicationId]),
    );
    expect(await slProjectUsage(root, lesson.id)).toEqual([
      expect.objectContaining({
        retrievalCount: 1,
        applicationCount: 1,
        resolvedCount: 0,
        unknownCount: 1,
        verifiedSuccessRate: null,
      }),
    ]);
  });

  test("supplied usage IDs make start and finish retries idempotent", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const lesson = await slCaptureLesson(root, {
      title: "Idempotent supplied usage identity",
      kind: "win",
      scope: "usage",
      triggers: ["idempotent supplied identity"],
      dryRun: false,
      now: FIXED_NOW,
    });
    const startOptions = {
      applicationId: "application-supplied",
      taskRunId: "task-supplied",
      idempotencyKey: "start-supplied",
      now: FIXED_NOW,
    };

    const firstStart = await slStartUsage(root, lesson.id, startOptions);
    const retryStart = await slStartUsage(root, lesson.id, {
      ...startOptions,
      now: new Date("2026-09-03T11:00:00.000Z"),
    });
    const firstFinish = await slFinishUsage(root, firstStart.receiptId, {
      outcome: "success",
      verified: true,
      verifierType: "integration-test",
      evidenceRef: "test:usage-idempotency",
      idempotencyKey: "finish-supplied",
      now: FIXED_NOW,
    });
    const retryFinish = await slFinishUsage(root, "application-supplied", {
      outcome: "success",
      verified: true,
      verifierType: "integration-test",
      evidenceRef: "test:usage-idempotency",
      idempotencyKey: "finish-supplied",
      now: new Date("2026-09-03T12:00:00.000Z"),
    });

    expect(
      firstStart.changes.filter((change) => change.action === "create"),
    ).toEqual([
      expect.objectContaining({ path: expect.stringContaining("SL-usage-events") }),
      expect.objectContaining({ path: expect.stringContaining("SL-usage-events") }),
    ]);
    expect(firstStart.changes).toContainEqual(
      expect.objectContaining({
        action: "update",
        path: expect.stringContaining("SL-registry.json"),
      }),
    );
    expect(firstStart.changes).toContainEqual(
      expect.objectContaining({
        action: "update",
        path: expect.stringContaining("SL-usage-projection.json"),
      }),
    );
    expect(retryStart.changes.every((change) => change.action === "skip")).toBe(
      true,
    );
    expect(firstFinish.change.action).toBe("create");
    expect(retryFinish.change.action).toBe("skip");
    expect(await slLoadUsageEvents(root)).toHaveLength(3);
  });

  test("recovers an exact selected-only start by appending only applied", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const lesson = await slCaptureLesson(root, {
      title: "Selected-only start recovery",
      kind: "win",
      scope: "usage",
      triggers: ["selected-only start recovery"],
      dryRun: false,
      now: FIXED_NOW,
    });
    const lessonContent = await readFile(join(root, lesson.path), "utf8");
    const selected = slCreateUsageEvent({
      artifactId: lesson.id,
      artifactContentHash: slArtifactUsageContentHash(lessonContent),
      taskRunId: "selected-only-task",
      applicationId: "selected-only-application",
      stage: "selected",
      outcome: "unknown",
      verifierType: "unverified",
      timestamp: FIXED_NOW.toISOString(),
      idempotencyKey: "selected-only-start:selected",
    });
    await slWriteUsageEvent(root, selected, false);
    const selectedPath = join(root, ...slUsageEventPath(selected).split("/"));
    const selectedBeforeRetry = await readFile(selectedPath, "utf8");

    const result = await slStartUsage(root, lesson.id, {
      applicationId: "selected-only-application",
      taskRunId: "selected-only-task",
      idempotencyKey: "selected-only-start",
      now: new Date("2026-09-03T11:00:00.000Z"),
    });

    expect(result.changes.slice(0, 2).map((change) => change.action)).toEqual([
      "skip",
      "create",
    ]);
    expect(result.changes).toContainEqual(
      expect.objectContaining({
        action: "update",
        path: expect.stringContaining("SL-registry.json"),
      }),
    );
    expect(await readFile(selectedPath, "utf8")).toBe(selectedBeforeRetry);
    const events = await slLoadUsageEvents(root);
    expect(events).toHaveLength(2);
    expect(events).toContainEqual(selected);
    expect(events).toContainEqual(
      expect.objectContaining({
        eventId: result.eventIds.applied,
        stage: "applied",
      }),
    );
    expect(await slProjectUsage(root, lesson.id)).toEqual([
      expect.objectContaining({
        retrievalCount: 1,
        applicationCount: 1,
        unknownCount: 1,
      }),
    ]);
  });

  test("rejects a conflicting selected-only start without appending applied", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const lesson = await slCaptureLesson(root, {
      title: "Conflicting selected-only start",
      kind: "win",
      scope: "usage",
      triggers: ["conflicting selected-only start"],
      dryRun: false,
      now: FIXED_NOW,
    });
    const lessonContent = await readFile(join(root, lesson.path), "utf8");
    const selected = slCreateUsageEvent({
      artifactId: lesson.id,
      artifactContentHash: slArtifactUsageContentHash(lessonContent),
      taskRunId: "conflicting-selected-task",
      applicationId: "conflicting-selected-application",
      stage: "selected",
      outcome: "unknown",
      verifierType: "unverified",
      timestamp: FIXED_NOW.toISOString(),
      idempotencyKey: "conflicting-selected-first:selected",
    });
    await slWriteUsageEvent(root, selected, false);

    await expect(
      slStartUsage(root, lesson.id, {
        applicationId: "conflicting-selected-application",
        taskRunId: "conflicting-selected-task",
        idempotencyKey: "conflicting-selected-second",
        now: new Date("2026-09-03T11:00:00.000Z"),
      }),
    ).rejects.toThrow(
      "can only retry the exact selected and applied event identities",
    );
    expect(await slLoadUsageEvents(root)).toEqual([selected]);
  });

  test("rejects a duplicate start with a different idempotency identity without writes", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const lesson = await slCaptureLesson(root, {
      title: "Reject different retry identity",
      kind: "win",
      scope: "usage",
      triggers: ["different retry identity"],
      dryRun: false,
      now: FIXED_NOW,
    });
    const first = await slStartUsage(root, lesson.id, {
      applicationId: "duplicate-start-application",
      taskRunId: "duplicate-start-task",
      idempotencyKey: "duplicate-start-first",
      now: FIXED_NOW,
    });
    const registryPath = join(
      root,
      ".github",
      "SL-learning",
      "SL-registry.json",
    );
    const indexPath = join(root, ".github", "SL-learning", "SL-index.json");
    const beforeRegistry = await readFile(registryPath, "utf8");
    const beforeIndex = await readFile(indexPath, "utf8");

    await expect(
      slStartUsage(root, lesson.id, {
        applicationId: first.applicationId,
        taskRunId: first.taskRunId,
        idempotencyKey: "duplicate-start-second",
        now: new Date("2026-09-03T11:00:00.000Z"),
      }),
    ).rejects.toThrow(
      "can only retry the exact selected and applied event identities",
    );

    expect(await slLoadUsageEvents(root)).toHaveLength(2);
    expect(await readFile(registryPath, "utf8")).toBe(beforeRegistry);
    expect(await readFile(indexPath, "utf8")).toBe(beforeIndex);
  });

  test("preflights all start event collisions before writing either stage", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const lesson = await slCaptureLesson(root, {
      title: "Atomic start preflight",
      kind: "win",
      scope: "usage",
      triggers: ["atomic start preflight"],
      dryRun: false,
      now: FIXED_NOW,
    });
    const lessonContent = await readFile(join(root, lesson.path), "utf8");
    const artifactContentHash = slArtifactUsageContentHash(lessonContent);
    const collidingApplied = slCreateUsageEvent({
      artifactId: lesson.id,
      artifactContentHash,
      taskRunId: "other-task",
      applicationId: "other-application",
      stage: "applied",
      outcome: "unknown",
      verifierType: "unverified",
      timestamp: FIXED_NOW.toISOString(),
      idempotencyKey: "atomic-start:applied",
    });
    await slWriteUsageEvent(root, collidingApplied, false);

    await expect(
      slStartUsage(root, lesson.id, {
        applicationId: "atomic-start-application",
        taskRunId: "atomic-start-task",
        idempotencyKey: "atomic-start",
        now: FIXED_NOW,
      }),
    ).rejects.toThrow("Immutable SL usage event collision");

    expect(await slLoadUsageEvents(root)).toEqual([collidingApplied]);
  });

  test.each([
    {
      name: "modified managedBy",
      mutate: (frontmatter: Record<string, unknown>) => {
        frontmatter.managedBy = "Other";
      },
    },
    {
      name: "mismatched ID",
      mutate: (frontmatter: Record<string, unknown>) => {
        frontmatter.id = "SL-DIFFERENT-ID";
      },
    },
    {
      name: "mismatched status",
      mutate: (frontmatter: Record<string, unknown>) => {
        frontmatter.status = "distilled";
      },
    },
    {
      name: "mismatched pin state",
      mutate: (frontmatter: Record<string, unknown>) => {
        frontmatter.pinned = true;
      },
    },
  ])(
    "rejects $name before starting usage and preserves every repository file",
    async ({ mutate }) => {
      const root = await slCreateTestRepository();
      repositories.push(root);
      await slInstall(root, "init", false);
      const lesson = await slCaptureLesson(root, {
        title: "Ownership protected start",
        kind: "win",
        scope: "usage",
        triggers: ["ownership protected start"],
        dryRun: false,
        now: FIXED_NOW,
      });
      await mutateLessonFrontmatter(root, lesson.path, mutate);
      const registryPath = join(
        root,
        ".github",
        "SL-learning",
        "SL-registry.json",
      );
      const indexPath = join(root, ".github", "SL-learning", "SL-index.json");
      const beforeLesson = await readFile(join(root, lesson.path), "utf8");
      const beforeRegistry = await readFile(registryPath, "utf8");
      const beforeIndex = await readFile(indexPath, "utf8");

      await expect(
        slStartUsage(root, lesson.id, {
          applicationId: "ownership-start-application",
          taskRunId: "ownership-start-task",
          idempotencyKey: "ownership-start",
          now: FIXED_NOW,
        }),
      ).rejects.toThrow("file ownership does not match the registry");

      expect(await slLoadUsageEvents(root)).toEqual([]);
      expect(await readFile(join(root, lesson.path), "utf8")).toBe(
        beforeLesson,
      );
      expect(await readFile(registryPath, "utf8")).toBe(beforeRegistry);
      expect(await readFile(indexPath, "utf8")).toBe(beforeIndex);
    },
  );

  test("fails before start writes when another projected artifact is unowned", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const target = await slCaptureLesson(root, {
      title: "Valid start target",
      kind: "win",
      scope: "usage",
      triggers: ["valid start target"],
      dryRun: false,
      now: FIXED_NOW,
    });
    const unowned = await slCaptureLesson(root, {
      title: "Unowned projected artifact",
      kind: "win",
      scope: "usage",
      triggers: ["unowned projected artifact"],
      dryRun: false,
      now: new Date("2026-09-03T10:01:00.000Z"),
    });
    await slStartUsage(root, unowned.id, {
      applicationId: "unowned-existing-application",
      taskRunId: "unowned-existing-task",
      idempotencyKey: "unowned-existing-start",
      now: FIXED_NOW,
    });
    await mutateLessonFrontmatter(
      root,
      unowned.path,
      (frontmatter) => {
        frontmatter.managedBy = "Other";
      },
    );
    const beforeEvents = await slLoadUsageEvents(root);
    const registryPath = join(
      root,
      ".github",
      "SL-learning",
      "SL-registry.json",
    );
    const indexPath = join(root, ".github", "SL-learning", "SL-index.json");
    const beforeRegistry = await readFile(registryPath, "utf8");
    const beforeIndex = await readFile(indexPath, "utf8");

    await expect(
      slStartUsage(root, target.id, {
        applicationId: "valid-target-application",
        taskRunId: "valid-target-task",
        idempotencyKey: "valid-target-start",
        now: FIXED_NOW,
      }),
    ).rejects.toThrow("file ownership does not match the registry");

    expect(await slLoadUsageEvents(root)).toEqual(beforeEvents);
    expect(await readFile(registryPath, "utf8")).toBe(beforeRegistry);
    expect(await readFile(indexPath, "utf8")).toBe(beforeIndex);
  });

  test("rejects an unowned legacy baseline before creating its event", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const lesson = await slCaptureLesson(root, {
      title: "Unowned legacy baseline",
      kind: "win",
      scope: "usage",
      triggers: ["unowned legacy baseline"],
      dryRun: false,
      now: FIXED_NOW,
    });
    await mutateLessonFrontmatter(
      root,
      lesson.path,
      (frontmatter) => {
        frontmatter.hits = 1;
        frontmatter.retrievals = 1;
        frontmatter.managedBy = "Other";
      },
    );
    const registryPath = join(
      root,
      ".github",
      "SL-learning",
      "SL-registry.json",
    );
    const indexPath = join(root, ".github", "SL-learning", "SL-index.json");
    const beforeLesson = await readFile(join(root, lesson.path), "utf8");
    const beforeRegistry = await readFile(registryPath, "utf8");
    const beforeIndex = await readFile(indexPath, "utf8");

    await expect(
      slSynchronizeUsageProjection(root, false),
    ).rejects.toThrow("file ownership does not match the registry");

    expect(await slLoadUsageEvents(root)).toEqual([]);
    expect(await readFile(join(root, lesson.path), "utf8")).toBe(beforeLesson);
    expect(await readFile(registryPath, "utf8")).toBe(beforeRegistry);
    expect(await readFile(indexPath, "utf8")).toBe(beforeIndex);
  });

  test("returns complete side-effect-free dry-run events and projection changes", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const lesson = await slCaptureLesson(root, {
      title: "Complete usage dry run",
      kind: "win",
      scope: "usage",
      triggers: ["complete usage dry run"],
      dryRun: false,
      now: FIXED_NOW,
    });
    const registryBeforeStart = await slLoadRegistry(root);

    const plannedStart = await slStartUsage(root, lesson.id, {
      applicationId: "dry-run-application",
      taskRunId: "dry-run-task",
      idempotencyKey: "dry-run-start",
      now: FIXED_NOW,
      dryRun: true,
    });

    expect(plannedStart.events).toEqual({
      selected: expect.objectContaining({
        eventId: plannedStart.eventIds.selected,
        stage: "selected",
        timestamp: FIXED_NOW.toISOString(),
      }),
      applied: expect.objectContaining({
        eventId: plannedStart.eventIds.applied,
        stage: "applied",
        timestamp: FIXED_NOW.toISOString(),
      }),
    });
    expect(plannedStart.changes).toEqual(
      expect.arrayContaining([
        {
          action: "create",
          path: expect.stringContaining("SL-usage-events"),
          detail: "planned",
        },
        {
          action: "update",
          path: expect.stringContaining("SL-registry.json"),
          detail: "planned",
        },
        {
          action: "update",
          path: expect.stringContaining("SL-usage-projection.json"),
          detail: "planned",
        },
      ]),
    );
    expect(
      plannedStart.changes.filter(
        (change) =>
          change.action === "create" &&
          change.path.includes("SL-usage-events"),
      ),
    ).toHaveLength(2);
    expect(await slLoadUsageEvents(root)).toEqual([]);
    expect(await slLoadRegistry(root)).toEqual(registryBeforeStart);

    const started = await slStartUsage(root, lesson.id, {
      applicationId: "dry-run-application",
      taskRunId: "dry-run-task",
      idempotencyKey: "dry-run-start",
      now: FIXED_NOW,
    });
    const registryBeforeFinish = await slLoadRegistry(root);
    const plannedFinish = await slFinishUsage(root, started.receiptId, {
      outcome: "success",
      verified: true,
      verifierType: "test-suite",
      evidenceRef: "ci:dry-run",
      idempotencyKey: "dry-run-finish",
      now: new Date("2026-09-03T11:00:00.000Z"),
      dryRun: true,
    });

    expect(plannedFinish.event).toMatchObject({
      eventId: plannedFinish.receiptId,
      stage: "verified",
      outcome: "success",
      timestamp: "2026-09-03T11:00:00.000Z",
    });
    expect(plannedFinish.changes).toEqual(
      expect.arrayContaining([
        {
          action: "create",
          path: expect.stringContaining("SL-usage-events"),
          detail: "planned",
        },
        {
          action: "update",
          path: expect.stringContaining("SL-registry.json"),
          detail: "planned",
        },
        {
          action: "update",
          path: expect.stringContaining("SL-usage-projection.json"),
          detail: "planned",
        },
      ]),
    );
    expect(await slLoadUsageEvents(root)).toHaveLength(2);
    expect(await slLoadRegistry(root)).toEqual(registryBeforeFinish);
  });

  test("enforces valid finish transitions and explicit verified declarations", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const lesson = await slCaptureLesson(root, {
      title: "Usage finish transitions",
      kind: "win",
      scope: "usage",
      triggers: ["finish transitions"],
      dryRun: false,
      now: FIXED_NOW,
    });

    const started = await slStartUsage(root, lesson.id, {
      applicationId: "application-transition",
      now: FIXED_NOW,
    });

    await expect(
      slFinishUsage(root, started.applicationId, {
        outcome: "success",
        verified: true,
        now: FIXED_NOW,
      }),
    ).rejects.toThrow(
      "--verified requires an explicit --verifier-type declaration.",
    );
    await expect(
      slFinishUsage(root, started.applicationId, {
        outcome: "success",
        verified: true,
        verifierType: "self-report",
        now: FIXED_NOW,
      }),
    ).rejects.toThrow(
      "A verified outcome requires a trustworthy verifier type.",
    );

    const unverified = await slFinishUsage(root, started.receiptId, {
      outcome: "success",
      verifierType: "self-report",
      now: FIXED_NOW,
    });
    expect(unverified.verified).toBe(false);
    expect(await slProjectUsage(root, lesson.id)).toEqual([
      expect.objectContaining({
        resolvedCount: 0,
        unknownCount: 1,
        verifiedSuccessCount: 0,
        verifiedFailureCount: 0,
        verifiedSuccessRate: null,
      }),
    ]);

    await slFinishUsage(root, started.applicationId, {
      outcome: "success",
      verified: true,
      verifierType: "test-suite",
      evidenceRef: "ci:run-123",
      now: new Date("2026-09-03T11:00:00.000Z"),
    });
    expect(await slProjectUsage(root, lesson.id)).toEqual([
      expect.objectContaining({
        resolvedCount: 1,
        unknownCount: 0,
        verifiedSuccessCount: 1,
        verifiedFailureCount: 0,
        verifiedSuccessRate: 1,
      }),
    ]);
    await expect(
      slFinishUsage(root, started.applicationId, {
        outcome: "failure",
        verified: true,
        verifierType: "test-suite",
        now: new Date("2026-09-03T12:00:00.000Z"),
      }),
    ).rejects.toThrow("already has a conflicting outcome");
    await expect(
      slFinishUsage(root, "missing-application", {
        outcome: "unknown",
        now: FIXED_NOW,
      }),
    ).rejects.toThrow("Usage application or receipt not found");
  });

  test("serializes conflicting concurrent finishes for one application", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const lesson = await slCaptureLesson(root, {
      title: "Concurrent finish serialization",
      kind: "win",
      scope: "usage",
      triggers: ["concurrent finish serialization"],
      dryRun: false,
      now: FIXED_NOW,
    });
    const started = await slStartUsage(root, lesson.id, {
      applicationId: "concurrent-finish-application",
      now: FIXED_NOW,
    });

    const results = await Promise.allSettled([
      slFinishUsage(root, started.applicationId, {
        outcome: "success",
        verified: true,
        verifierType: "test-suite",
        evidenceRef: "ci:concurrent-finish-success",
        now: new Date("2026-09-03T11:00:00.000Z"),
      }),
      slFinishUsage(root, started.applicationId, {
        outcome: "failure",
        verified: true,
        verifierType: "test-suite",
        evidenceRef: "ci:concurrent-finish-failure",
        now: new Date("2026-09-03T11:00:00.000Z"),
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(
      1,
    );
    const events = await slLoadUsageEvents(root);
    expect(events).toHaveLength(3);
    expect(
      events.filter((event) =>
        event.eventType === "usage" &&
        ["outcome", "verified"].includes(event.stage),
      ),
    ).toHaveLength(1);
  });

  test.each([
    { outcome: "failure", resolvedCount: 0 },
    { outcome: "partial", resolvedCount: 0 },
    { outcome: "unknown", resolvedCount: 0 },
  ] as const)(
    "records an unverified $outcome finish outcome",
    async ({ outcome, resolvedCount }) => {
      const root = await slCreateTestRepository();
      repositories.push(root);
      await slInstall(root, "init", false);
      const lesson = await slCaptureLesson(root, {
        title: `Usage ${outcome} outcome`,
        kind: "win",
        scope: "usage",
        triggers: [`${outcome} outcome`],
        dryRun: false,
        now: FIXED_NOW,
      });
      const started = await slStartUsage(root, lesson.id, {
        applicationId: `application-${outcome}`,
        now: FIXED_NOW,
      });

      const finished = await slFinishUsage(root, started.applicationId, {
        outcome,
        now: FIXED_NOW,
      });

      expect(finished).toMatchObject({
        outcome,
        verified: false,
        verifierType: "unverified",
      });
      expect(await slProjectUsage(root, lesson.id)).toEqual([
        expect.objectContaining({
          resolvedCount,
          unknownCount: 1,
          verifiedSuccessCount: 0,
          verifiedFailureCount: 0,
          verifiedSuccessRate: null,
        }),
      ]);
    },
  );

  test("concurrent applications create distinct immutable event files", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const first = createEvent("application-1", "verified", "success", 1);
    const second = createEvent("application-2", "verified", "failure", 2);

    const changes = await Promise.all([
      slWriteUsageEvent(root, first, false),
      slWriteUsageEvent(root, second, false),
    ]);

    expect(changes.map((change) => change.action)).toEqual([
      "create",
      "create",
    ]);
    expect(new Set(changes.map((change) => change.path)).size).toBe(2);
    expect(await slLoadUsageEvents(root)).toHaveLength(2);
  });

  test("serializes concurrent usage projection updates without registry, index, or frontmatter regression", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const lesson = await slCaptureLesson(root, {
      title: "Concurrent usage projections",
      kind: "win",
      scope: "usage",
      triggers: ["concurrent usage projections"],
      dryRun: false,
      now: FIXED_NOW,
    });
    const applicationCount = 8;

    await Promise.all(
      Array.from({ length: applicationCount }, (_, index) =>
        slVoteOnLesson(
          root,
          lesson.id,
          "useful",
          false,
          new Date(`2026-09-03T${String(index + 11).padStart(2, "0")}:00:00.000Z`),
          {
            taskRunId: `concurrent-task-${index}`,
            applicationId: `concurrent-application-${index}`,
            idempotencyKey: `concurrent-vote-${index}`,
          },
        ),
      ),
    );

    const registry = await slLoadRegistry(root);
    const artifact = registry.artifacts.find(
      (candidate) => candidate.id === lesson.id,
    );
    expect(artifact).toMatchObject({
      status: "promotion-candidate",
    });
    expect(await slProjectUsage(root, lesson.id)).toEqual([
      expect.objectContaining({
        retrievalCount: applicationCount,
        applicationCount,
        resolvedCount: applicationCount,
        verifiedSuccessCount: applicationCount,
        verifiedFailureCount: 0,
        unknownCount: 0,
        verifiedSuccessRate: 1,
      }),
    ]);
    const scopeEntry = slScopeCatalogEntry(SL_DEFAULT_SCOPE);
    const index = JSON.parse(
      await readFile(
        join(root, ...scopeEntry.indexPath.split("/")),
        "utf8",
      ),
    ) as {
      artifacts: Array<{
        id: string;
        status: string;
      }>;
    };
    expect(
      index.artifacts.find((candidate) => candidate.id === lesson.id),
    ).toMatchObject({
      status: "promotion-candidate",
    });
    const markdown = slParseMarkdown<{ status: string }>(
      await readFile(join(root, lesson.path), "utf8"),
    );
    expect(markdown.frontmatter.status).toBe("promotion-candidate");
  });

  test("recovers a demonstrably stale repository mutation lock before synchronizing", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const lesson = await slCaptureLesson(root, {
      title: "Stale projection lock",
      kind: "win",
      scope: "usage",
      triggers: ["stale projection lock"],
      dryRun: false,
      now: FIXED_NOW,
    });
    const lockPath = join(root, ...SL_REPOSITORY_MUTATION_LOCK_PATH.split("/"));
    await mkdir(lockPath);
    await writeFile(
      join(root, ...SL_REPOSITORY_MUTATION_LOCK_OWNER.split("/")),
      `${JSON.stringify({
        schemaVersion: 1,
        token: "abandoned-owner",
        pid: 2_147_483_647,
        hostname: hostname(),
        acquiredAt: "2026-09-03T00:00:00.000Z",
      })}\n`,
      "utf8",
    );
    const staleTime = new Date("2026-09-03T00:00:00.000Z");
    await utimes(lockPath, staleTime, staleTime);

    await slStartUsage(root, lesson.id, {
      applicationId: "stale-lock-application",
      now: FIXED_NOW,
    });

    await expect(access(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await slProjectUsage(root, lesson.id)).toEqual([
      expect.objectContaining({
        retrievalCount: 1,
        applicationCount: 1,
      }),
    ]);
  });

  test("does not steal an old lock owned by a live process", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const lockPath = join(root, ...SL_REPOSITORY_MUTATION_LOCK_PATH.split("/"));
    const ownerPath = join(
      root,
      ...SL_REPOSITORY_MUTATION_LOCK_OWNER.split("/"),
    );
    await mkdir(lockPath, { recursive: true });
    await writeFile(
      ownerPath,
      `${JSON.stringify({
        schemaVersion: 1,
        token: "live-owner",
        pid: process.pid,
        hostname: hostname(),
        acquiredAt: "2026-09-03T00:00:00.000Z",
      })}\n`,
      "utf8",
    );
    const staleTime = new Date("2026-09-03T00:00:00.000Z");
    await utimes(lockPath, staleTime, staleTime);

    await expect(
      slWithRepositoryMutationLock(
        root,
        async () => "not-acquired",
        { retryMs: 5, staleMs: 10, timeoutMs: 50 },
      ),
    ).rejects.toThrow("Timed out waiting for SL repository mutation lock");
    expect(JSON.parse(await readFile(ownerPath, "utf8"))).toMatchObject({
      token: "live-owner",
      pid: process.pid,
    });
  });

  test("reclaims an expired foreign-host repository mutation lease", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const lockPath = join(root, ...SL_REPOSITORY_MUTATION_LOCK_PATH.split("/"));
    await mkdir(lockPath, { recursive: true });
    await writeFile(
      join(root, ...SL_REPOSITORY_MUTATION_LOCK_OWNER.split("/")),
      `${JSON.stringify({
        schemaVersion: 1,
        token: "expired-foreign-owner",
        pid: process.pid,
        hostname: "foreign-host.example",
        acquiredAt: "2026-09-03T00:00:00.000Z",
      })}\n`,
      "utf8",
    );
    const staleTime = new Date("2026-09-03T00:00:00.000Z");
    await utimes(lockPath, staleTime, staleTime);

    await expect(
      slWithRepositoryMutationLock(
        root,
        async () => "acquired",
        { retryMs: 5, staleMs: 10, timeoutMs: 100 },
      ),
    ).resolves.toBe("acquired");
    await expect(access(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("does not steal a foreign-host repository mutation lease with a live heartbeat", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const lockPath = join(root, ...SL_REPOSITORY_MUTATION_LOCK_PATH.split("/"));
    const ownerPath = join(
      root,
      ...SL_REPOSITORY_MUTATION_LOCK_OWNER.split("/"),
    );
    await mkdir(lockPath, { recursive: true });
    await writeFile(
      ownerPath,
      `${JSON.stringify({
        schemaVersion: 1,
        token: "live-foreign-owner",
        pid: process.pid,
        hostname: "foreign-host.example",
        acquiredAt: "2026-09-03T00:00:00.000Z",
      })}\n`,
      "utf8",
    );
    const heartbeatTime = new Date();
    await utimes(lockPath, heartbeatTime, heartbeatTime);

    await expect(
      slWithRepositoryMutationLock(
        root,
        async () => "not-acquired",
        { retryMs: 5, staleMs: 60_000, timeoutMs: 50 },
      ),
    ).rejects.toThrow("Timed out waiting for SL repository mutation lock");
    expect(JSON.parse(await readFile(ownerPath, "utf8"))).toMatchObject({
      token: "live-foreign-owner",
      hostname: "foreign-host.example",
    });
  });

  test("projects a concurrent branch union deterministically regardless of input order", () => {
    const branchEvents = [
      createEvent("application-a", "selected", "unknown", 1),
      createEvent("application-a", "applied", "unknown", 2),
      createEvent("application-a", "verified", "success", 3),
      createEvent("application-b", "verified", "failure", 4),
    ];
    const unionWithRetry = [
      branchEvents[3]!,
      branchEvents[0]!,
      branchEvents[2]!,
      branchEvents[1]!,
      branchEvents[2]!,
    ];

    const forward = slProjectUsageEvents(branchEvents);
    const merged = slProjectUsageEvents(unionWithRetry);

    expect(merged).toEqual(forward);
    expect(merged).toEqual([
      {
        scope: SL_DEFAULT_SCOPE,
        artifactId: "SL-TEST-ARTIFACT",
        artifactVersion: `sha256:${CONTENT_HASH_A}`,
        artifactContentHash: CONTENT_HASH_A,
        retrievalCount: 2,
        applicationCount: 2,
        applicationRate: 1,
        outcomeCount: 2,
        outcomeSuccessCount: 1,
        outcomeFailureCount: 1,
        outcomePartialCount: 0,
        outcomeUnknownCount: 0,
        outcomeSuccessRate: 0.5,
        verifiedCount: 2,
        resolvedCount: 2,
        verifiedSuccessCount: 1,
        verifiedFailureCount: 1,
        unknownCount: 0,
        verifiedSuccessRate: 0.5,
        lastRetrievedAt: "2026-09-03T04:00:00.000Z",
        lastAppliedAt: "2026-09-03T04:00:00.000Z",
        lastVerifiedSuccessAt: "2026-09-03T03:00:00.000Z",
        lastVerifiedFailureAt: "2026-09-03T04:00:00.000Z",
      },
    ]);
  });

  test("deduplicates retries and duplicate application IDs", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const original = createEvent(
      "application-retry",
      "verified",
      "success",
      1,
    );
    const duplicateApplication = createEvent(
      "application-retry",
      "verified",
      "success",
      2,
    );

    expect(await slWriteUsageEvent(root, original, false)).toMatchObject({
      action: "create",
    });
    expect(await slWriteUsageEvent(root, original, false)).toMatchObject({
      action: "skip",
    });
    await slWriteUsageEvent(root, duplicateApplication, false);

    expect(await slProjectUsage(root, "SL-TEST-ARTIFACT")).toEqual([
      expect.objectContaining({
        retrievalCount: 1,
        applicationCount: 1,
        verifiedSuccessCount: 1,
        verifiedFailureCount: 0,
        unknownCount: 0,
      }),
    ]);
  });

  test.each([
    "mailto:person@example.com",
    "file:C:\\Users\\example\\proof.txt",
    "host:10.0.0.1",
    `token:ghp_${"a".repeat(24)}`,
  ])("rejects unsafe evidence reference %s", (evidenceRef) => {
    expect(() =>
      slCreateUsageEvent({
        artifactId: "SL-TEST-ARTIFACT",
        artifactContentHash: CONTENT_HASH_A,
        taskRunId: "unsafe-evidence-task",
        applicationId: "unsafe-evidence-application",
        stage: "verified",
        outcome: "success",
        verifierType: "test-suite",
        timestamp: FIXED_NOW.toISOString(),
        idempotencyKey: `unsafe-evidence-${evidenceRef.length}`,
        evidenceRef,
      }),
    ).toThrow(
      "evidenceRef must be an opaque, non-PII reference without embedded source content.",
    );
  });

  test("separates projections by artifact content version", () => {
    const projections = slProjectUsageEvents([
      createEvent("application-a", "verified", "success", 1, CONTENT_HASH_A),
      createEvent("application-b", "verified", "failure", 2, CONTENT_HASH_B),
    ]);

    expect(projections).toHaveLength(2);
    expect(projections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactContentHash: CONTENT_HASH_A,
          resolvedCount: 1,
          verifiedSuccessCount: 1,
          verifiedFailureCount: 0,
          verifiedSuccessRate: 1,
        }),
        expect.objectContaining({
          artifactContentHash: CONTENT_HASH_B,
          resolvedCount: 1,
          verifiedSuccessCount: 0,
          verifiedFailureCount: 1,
          verifiedSuccessRate: 0,
        }),
      ]),
    );
  });

  test("uses only verified success and failure in the success-rate denominator", () => {
    const projections = slProjectUsageEvents([
      createEvent("application-success", "verified", "success", 1),
      createEvent("application-failure", "verified", "failure", 2),
      createEvent("application-partial", "verified", "partial", 3),
      createEvent("application-unverified", "applied", "unknown", 4),
    ]);

    expect(projections).toEqual([
      expect.objectContaining({
        retrievalCount: 4,
        applicationCount: 4,
        resolvedCount: 2,
        verifiedSuccessCount: 1,
        verifiedFailureCount: 1,
        unknownCount: 2,
        verifiedSuccessRate: 0.5,
      }),
    ]);
  });
});

async function mutateLessonFrontmatter(
  root: string,
  relativePath: string,
  mutate: (frontmatter: Record<string, unknown>) => void,
): Promise<void> {
  const path = join(root, relativePath);
  const markdown = slParseMarkdown<Record<string, unknown>>(
    await readFile(path, "utf8"),
  );
  mutate(markdown.frontmatter);
  await writeFile(
    path,
    slStringifyMarkdown(markdown.frontmatter, markdown.body),
    "utf8",
  );
}
