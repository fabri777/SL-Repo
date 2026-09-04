import {
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { slCaptureLesson } from "../../SL-src/SL-core/SL-capture.js";
import {
  slParseMarkdown,
  slStringifyMarkdown,
} from "../../SL-src/SL-core/SL-frontmatter.js";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import { slLoadRegistry } from "../../SL-src/SL-core/SL-registry.js";
import {
  slBuildStateCatalog,
  slScopeCatalogEntry,
  slScopeShardName,
} from "../../SL-src/SL-core/SL-state.js";
import type {
  SLScopeDescriptor,
  SLStateCatalog,
  SLScopeUsageProjection,
} from "../../SL-src/SL-core/SL-types.js";
import {
  slAggregateUsageByScope,
  slAggregateUsageRepository,
  slArtifactUsageContentHash,
  slCreateUsageEvent,
  slLoadUsageEvents,
  slProjectUsage,
  slProjectUsageEvents,
  slSynchronizeUsageProjection,
  slUsageEventPath,
  slWriteUsageEvent,
} from "../../SL-src/SL-core/SL-usage.js";
import { slValidateRepository } from "../../SL-src/SL-validation/SL-validation.js";
import {
  slCreateTestRepository,
  slRemoveTestRepository,
} from "../SL-fixtures/SL-test-repository.js";

const repositories: string[] = [];
const FIXED_NOW = new Date("2026-09-04T08:00:00.000Z");
const SERVICE_A: SLScopeDescriptor = {
  id: "orders",
  path: "services/orders",
};
const SERVICE_B: SLScopeDescriptor = {
  id: "billing",
  path: "services/billing",
};

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(slRemoveTestRepository));
});

function repositoryPath(root: string, relativePath: string): string {
  return join(root, ...relativePath.split("/"));
}

describe("SL scope-sharded state", () => {
  test("normalizes scope shards deterministically across path separators and traversal order", () => {
    expect(
      slScopeShardName({ id: "orders", path: "services\\orders\\" }),
    ).toBe(slScopeShardName(SERVICE_A));

    const forward = slBuildStateCatalog([SERVICE_A, SERVICE_B]);
    const reverse = slBuildStateCatalog([SERVICE_B, SERVICE_A]);

    expect(reverse).toEqual(forward);
    expect(forward.scopes.map((entry) => entry.scope)).toEqual([
      SERVICE_B,
      SERVICE_A,
    ]);
  });

  test("updates one service shard without rewriting another service or the root catalog", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const orders = await slCaptureLesson(root, {
      title: "Orders shard learning",
      kind: "win",
      scope: "orders",
      stateScope: SERVICE_A,
      triggers: ["orders shard"],
      dryRun: false,
      now: FIXED_NOW,
    });
    await slCaptureLesson(root, {
      title: "Billing shard learning",
      kind: "win",
      scope: "billing",
      stateScope: SERVICE_B,
      triggers: ["billing shard"],
      dryRun: false,
      now: FIXED_NOW,
    });
    const billingEntry = slScopeCatalogEntry(SERVICE_B);
    const catalogPath = repositoryPath(
      root,
      ".github/SL-learning/SL-state-catalog.json",
    );
    const before = await Promise.all([
      readFile(catalogPath, "utf8"),
      readFile(repositoryPath(root, billingEntry.registryPath), "utf8"),
      readFile(repositoryPath(root, billingEntry.indexPath), "utf8"),
      readFile(repositoryPath(root, billingEntry.projectionPath), "utf8"),
    ]);

    const registry = await slLoadRegistry(root);
    const artifact = registry.artifacts.find(
      (candidate) => candidate.id === orders.id,
    );
    expect(artifact?.scope).toEqual(SERVICE_A);
    const content = await readFile(repositoryPath(root, orders.path), "utf8");
    const event = slCreateUsageEvent({
      artifactId: orders.id,
      artifactContentHash: slArtifactUsageContentHash(content),
      taskRunId: "orders-task",
      applicationId: "orders-application",
      stage: "verified",
      outcome: "success",
      verifierType: "test-suite",
      timestamp: FIXED_NOW.toISOString(),
      idempotencyKey: "orders-service-vote",
      scope: SERVICE_A,
    });
    await slWriteUsageEvent(root, event, false);
    await slSynchronizeUsageProjection(root, false);

    const after = await Promise.all([
      readFile(catalogPath, "utf8"),
      readFile(repositoryPath(root, billingEntry.registryPath), "utf8"),
      readFile(repositoryPath(root, billingEntry.indexPath), "utf8"),
      readFile(repositoryPath(root, billingEntry.projectionPath), "utf8"),
    ]);
    expect(after).toEqual(before);
    expect(slUsageEventPath(event)).toContain(
      `${slScopeCatalogEntry(SERVICE_A).usageEventsPath}/SL-`,
    );
  });

  test("reads legacy state and migrates counters and unscoped events without loss", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const lesson = await slCaptureLesson(root, {
      title: "Legacy state migration",
      kind: "win",
      scope: "legacy",
      triggers: ["legacy state"],
      dryRun: false,
      now: FIXED_NOW,
    });
    const registry = await slLoadRegistry(root);
    const legacyRegistry = structuredClone(registry);
    const artifact = legacyRegistry.artifacts.find(
      (candidate) => candidate.id === lesson.id,
    );
    expect(artifact).toBeDefined();
    if (!artifact) {
      return;
    }
    delete artifact.scope;
    artifact.hits = 2;
    artifact.retrievals = 3;
    artifact.notUsefulVotes = 1;
    const legacyRegistryPath = repositoryPath(
      root,
      ".github/SL-learning/SL-registry.json",
    );
    await writeFile(
      legacyRegistryPath,
      `${JSON.stringify(legacyRegistry, null, 2)}\n`,
      "utf8",
    );
    await rm(repositoryPath(root, ".github/SL-learning/SL-scopes"), {
      recursive: true,
      force: true,
    });
    await rm(
      repositoryPath(root, ".github/SL-learning/SL-state-catalog.json"),
      { force: true },
    );
    const legacyBefore = await readFile(legacyRegistryPath, "utf8");
    const lessonContent = await readFile(
      repositoryPath(root, lesson.path),
      "utf8",
    );
    const legacyEvent = slCreateUsageEvent({
      artifactId: lesson.id,
      artifactContentHash: slArtifactUsageContentHash(lessonContent),
      taskRunId: "legacy-unscoped-task",
      applicationId: "legacy-unscoped-application",
      stage: "verified",
      outcome: "success",
      verifierType: "test-suite",
      timestamp: "2026-09-04T09:00:00.000Z",
      idempotencyKey: "legacy-unscoped-event",
    });
    delete legacyEvent.scope;
    await slWriteUsageEvent(root, legacyEvent, false);
    expect(slUsageEventPath(legacyEvent)).toMatch(
      /^\.github\/SL-learning\/SL-usage-events\//,
    );

    await slSynchronizeUsageProjection(root, false);

    expect(await readFile(legacyRegistryPath, "utf8")).toBe(legacyBefore);
    expect(await slProjectUsage(root, lesson.id)).toEqual([
      expect.objectContaining({
        scope: { id: "repo", path: "." },
        retrievalCount: 4,
        applicationCount: 4,
        verifiedSuccessCount: 3,
        verifiedFailureCount: 1,
      }),
    ]);
    expect(
      (await slLoadUsageEvents(root)).some(
        (event) => event.eventType === "legacy-baseline",
      ),
    ).toBe(true);
  });

  test("projects per-scope rates and exposes repository aggregates as counts only", () => {
    const hash = "a".repeat(64);
    const events = [
      slCreateUsageEvent({
        artifactId: "SL-ORDERS-RULE",
        artifactContentHash: hash,
        taskRunId: "orders-task",
        applicationId: "orders-app",
        stage: "verified",
        outcome: "success",
        verifierType: "test-suite",
        timestamp: "2026-09-04T08:00:00.000Z",
        idempotencyKey: "orders-success",
        scope: SERVICE_A,
      }),
      slCreateUsageEvent({
        artifactId: "SL-BILLING-RULE",
        artifactContentHash: hash,
        taskRunId: "billing-task",
        applicationId: "billing-app",
        stage: "verified",
        outcome: "failure",
        verifierType: "test-suite",
        timestamp: "2026-09-04T09:00:00.000Z",
        idempotencyKey: "billing-failure",
        scope: SERVICE_B,
      }),
    ];
    const projections = slProjectUsageEvents(events);

    expect(slAggregateUsageByScope(projections)).toEqual([
      expect.objectContaining({
        scope: SERVICE_B,
        verifiedSuccessRate: 0,
      }),
      expect.objectContaining({
        scope: SERVICE_A,
        verifiedSuccessRate: 1,
      }),
    ]);
    expect(slAggregateUsageRepository(projections)).toMatchObject({
      aggregation: "repository-counts-only",
      scopeCount: 2,
      verifiedSuccessCount: 1,
      verifiedFailureCount: 1,
      successRate: null,
      successRateReason: "rates-are-reported-per-scope",
    });
  });

  test("tracks the current artifact version separately from older scope metrics", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const lesson = await slCaptureLesson(root, {
      title: "Current version projection",
      kind: "win",
      scope: "orders",
      stateScope: SERVICE_A,
      triggers: ["current version"],
      dryRun: false,
      now: FIXED_NOW,
    });
    const lessonPath = repositoryPath(root, lesson.path);
    const originalContent = await readFile(lessonPath, "utf8");
    const originalHash = slArtifactUsageContentHash(originalContent);
    const event = slCreateUsageEvent({
      artifactId: lesson.id,
      artifactContentHash: originalHash,
      taskRunId: "old-version-task",
      applicationId: "old-version-app",
      stage: "verified",
      outcome: "success",
      verifierType: "test-suite",
      timestamp: FIXED_NOW.toISOString(),
      idempotencyKey: "old-version-success",
      scope: SERVICE_A,
    });
    await slWriteUsageEvent(root, event, false);
    await slSynchronizeUsageProjection(root, false);
    const parsed = slParseMarkdown<Record<string, unknown>>(originalContent);
    const updatedContent = slStringifyMarkdown(
      parsed.frontmatter,
      `${parsed.body}\n\nNew semantic guidance.`,
    );
    await writeFile(lessonPath, updatedContent, "utf8");

    await slSynchronizeUsageProjection(root, false);

    const artifact = (await slLoadRegistry(root)).artifacts.find(
      (candidate) => candidate.id === lesson.id,
    );
    expect(artifact?.usageProjection).toMatchObject({
      artifactContentHash: slArtifactUsageContentHash(updatedContent),
      verifiedSuccessCount: 0,
    });
    expect(artifact?.usageProjection?.artifactContentHash).not.toBe(
      originalHash,
    );
    const projectionShard = JSON.parse(
      await readFile(
        repositoryPath(
          root,
          slScopeCatalogEntry(SERVICE_A).projectionPath,
        ),
        "utf8",
      ),
    ) as SLScopeUsageProjection;
    expect(projectionShard.projections).toHaveLength(2);
  });

  test("writes concurrent immutable events to independent scope and artifact shards", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const hash = "b".repeat(64);
    const first = slCreateUsageEvent({
      artifactId: "SL-ORDERS-RULE",
      artifactContentHash: hash,
      taskRunId: "orders-task",
      applicationId: "orders-app",
      stage: "verified",
      outcome: "success",
      verifierType: "test-suite",
      timestamp: "2026-09-04T08:00:00.000Z",
      idempotencyKey: "orders-concurrent",
      scope: SERVICE_A,
    });
    const second = slCreateUsageEvent({
      artifactId: "SL-BILLING-RULE",
      artifactContentHash: hash,
      taskRunId: "billing-task",
      applicationId: "billing-app",
      stage: "verified",
      outcome: "success",
      verifierType: "test-suite",
      timestamp: "2026-09-04T08:00:00.000Z",
      idempotencyKey: "billing-concurrent",
      scope: SERVICE_B,
    });

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

  test("validates duplicate events, scope mismatches, and stale projections", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const lesson = await slCaptureLesson(root, {
      title: "Validate state shards",
      kind: "win",
      scope: "orders",
      stateScope: SERVICE_A,
      triggers: ["validate shards"],
      dryRun: false,
      now: FIXED_NOW,
    });
    const content = await readFile(repositoryPath(root, lesson.path), "utf8");
    const correct = slCreateUsageEvent({
      artifactId: lesson.id,
      artifactContentHash: slArtifactUsageContentHash(content),
      taskRunId: "correct-task",
      applicationId: "correct-app",
      stage: "verified",
      outcome: "success",
      verifierType: "test-suite",
      timestamp: FIXED_NOW.toISOString(),
      idempotencyKey: "correct-event",
      scope: SERVICE_A,
    });
    await slWriteUsageEvent(root, correct, false);
    await slSynchronizeUsageProjection(root, false);
    const mismatched = slCreateUsageEvent({
      artifactId: lesson.id,
      artifactContentHash: slArtifactUsageContentHash(content),
      taskRunId: "mismatch-task",
      applicationId: "mismatch-app",
      stage: "verified",
      outcome: "success",
      verifierType: "test-suite",
      timestamp: "2026-09-04T09:00:00.000Z",
      idempotencyKey: "mismatch-event",
    });
    await slWriteUsageEvent(root, mismatched, false);
    const sourcePath = repositoryPath(root, slUsageEventPath(correct));
    const duplicatePath = repositoryPath(
      root,
      `${slScopeCatalogEntry(SERVICE_B).usageEventsPath}/SL-duplicate/2026-09/SL-usage-${correct.eventId.slice("SL-USE-".length)}.json`,
    );
    await mkdir(join(duplicatePath, ".."), { recursive: true });
    await copyFile(sourcePath, duplicatePath);
    const projectionEntry = slScopeCatalogEntry(SERVICE_A);
    const projectionPath = repositoryPath(
      root,
      projectionEntry.projectionPath,
    );
    const projection = JSON.parse(
      await readFile(projectionPath, "utf8"),
    ) as SLScopeUsageProjection;
    projection.projections[0]!.retrievalCount += 1;
    await writeFile(
      projectionPath,
      `${JSON.stringify(projection, null, 2)}\n`,
      "utf8",
    );

    const issues = await slValidateRepository(root);

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "usage-event-duplicate-id",
        "usage-event-scope",
        "usage-projection-drift",
      ]),
    );
  });

  test("validates catalog shard collisions and path containment", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const catalogPath = repositoryPath(
      root,
      ".github/SL-learning/SL-state-catalog.json",
    );
    const catalog = JSON.parse(
      await readFile(catalogPath, "utf8"),
    ) as SLStateCatalog;
    const duplicate = structuredClone(catalog.scopes[0]!);
    duplicate.scope = SERVICE_A;
    duplicate.registryPath = "../outside.json";
    catalog.scopes.push(duplicate);
    await writeFile(
      catalogPath,
      `${JSON.stringify(catalog, null, 2)}\n`,
      "utf8",
    );

    const issues = await slValidateRepository(root);
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "scope-state-load",
        "scope-shard-collision",
        "scope-shard-containment",
      ]),
    );
  });
});
