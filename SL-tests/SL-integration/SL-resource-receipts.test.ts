import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { slCaptureLesson } from "../../SL-src/SL-core/SL-capture.js";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import {
  slCreateResourceReceipt,
  slLoadResourceReceipts,
  slProjectResourceReceipts,
  slRecordResourceReceipt,
  slResourceReceiptPath,
  slSynchronizeResourceProjection,
  slValidateResourceReceipt,
} from "../../SL-src/SL-core/SL-resource.js";
import { slLoadStateCatalog } from "../../SL-src/SL-core/SL-state.js";
import type { SLChange } from "../../SL-src/SL-core/SL-types.js";
import {
  slArtifactUsageContentHash,
  slStartUsage,
} from "../../SL-src/SL-core/SL-usage.js";
import {
  slCreateTestRepository,
  slRemoveTestRepository,
} from "../SL-fixtures/SL-test-repository.js";
import { slValidateRepository } from "../../SL-src/SL-validation/SL-validation.js";

const repositories: string[] = [];
const NOW = new Date("2026-09-05T09:00:00.000Z");

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(slRemoveTestRepository));
});

async function createLesson(root: string) {
  await slInstall(root, "init", false);
  const lesson = await slCaptureLesson(root, {
    title: "Resource receipt identity",
    kind: "win",
    scope: "tests",
    triggers: ["resource receipt identity"],
    dryRun: false,
    now: NOW,
  });
  const content = await readFile(join(root, ...lesson.path.split("/")), "utf8");
  return {
    ...lesson,
    contentHash: slArtifactUsageContentHash(content),
  };
}

describe("SL immutable resource receipts", () => {
  test("records generation, application, and baseline receipts in scope shards", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const lesson = await createLesson(root);

    const generation = await slRecordResourceReceipt(root, {
      idempotencyKey: "generation-resource-1",
      phase: "generation",
      source: "host",
      quality: "measured",
      provider: "openai",
      modelId: "gpt-5.6-sol",
      tokens: {
        input: 1200,
        output: 300,
        cacheRead: 400,
        cacheWrite: 20,
      },
      wallClockDurationMs: 8000,
      modelDurationMs: 5000,
      toolDurationMs: 2000,
      attemptCount: 2,
      timestamp: NOW.toISOString(),
      artifactId: lesson.id,
      artifactContentHash: lesson.contentHash,
      generationRunId: "generation-run-1",
      reportedCost: {
        amount: "0.0125",
        currency: "USD",
        basis: "host-reported",
      },
    });

    const usage = await slStartUsage(root, lesson.id, {
      applicationId: "resource-application-1",
      taskRunId: "resource-task-1",
      now: new Date("2026-09-05T10:00:00.000Z"),
    });
    const application = await slRecordResourceReceipt(root, {
      idempotencyKey: "application-resource-1",
      phase: "application",
      source: "host",
      quality: "measured",
      provider: "openai",
      modelId: "gpt-5.6-sol",
      tokens: { input: 500, output: 100, reasoning: 50 },
      wallClockDurationMs: 4000,
      timestamp: "2026-09-05T10:05:00.000Z",
      artifactId: lesson.id,
      artifactContentHash: usage.artifactContentHash,
      taskRunId: usage.taskRunId,
      applicationId: usage.applicationId,
      comparison: {
        comparisonId: "comparison-1",
        scenarioKey: "scenario-order-fix",
        role: "treatment",
      },
    });
    const baseline = await slRecordResourceReceipt(root, {
      idempotencyKey: "baseline-resource-1",
      phase: "baseline",
      source: "manual",
      quality: "estimated",
      provider: "openai",
      modelId: "gpt-5.6-sol",
      tokens: { input: 900, output: 250 },
      wallClockDurationMs: 9000,
      timestamp: "2026-09-05T08:00:00.000Z",
      taskRunId: "baseline-task-1",
      comparison: {
        comparisonId: "comparison-1",
        scenarioKey: "scenario-order-fix",
        role: "baseline",
      },
    });

    const receipts = await slLoadResourceReceipts(root);
    expect(receipts).toHaveLength(3);
    expect(generation.change.path).toBe(slResourceReceiptPath(generation.receipt));
    expect(application.receipt.phase).toBe("application");
    expect(baseline.receipt.phase).toBe("baseline");

    const projections = slProjectResourceReceipts(receipts);
    expect(projections).toHaveLength(3);
    expect(
      projections.find((projection) => projection.phase === "generation"),
    ).toMatchObject({
      receiptCount: 1,
      totalTokens: 1920,
      wallClockDurationMs: 8000,
      attemptCount: 2,
      reportedCosts: { USD: "0.0125" },
    });

    const changes: SLChange[] = [];
    await slSynchronizeResourceProjection(root, false, changes);
    const catalog = await slLoadStateCatalog(root);
    const projectionPath = catalog.scopes[0]!.resourceProjectionPath!;
    const projection = JSON.parse(
      await readFile(join(root, ...projectionPath.split("/")), "utf8"),
    );
    expect(projection).toEqual({
      schemaVersion: 1,
      scope: catalog.scopes[0]!.scope,
      projections,
    });
    expect(changes).toEqual([
      {
        action: "create",
        path: projectionPath,
        detail: "written",
      },
    ]);
  });

  test("deduplicates retries and rejects cross-identity application receipts", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const lesson = await createLesson(root);
    const usage = await slStartUsage(root, lesson.id, {
      applicationId: "resource-application-retry",
      taskRunId: "resource-task-retry",
      now: NOW,
    });
    const input = {
      idempotencyKey: "application-resource-retry",
      phase: "application" as const,
      source: "ci" as const,
      quality: "measured" as const,
      provider: "openai",
      modelId: "gpt-5.6-sol",
      tokens: { input: 100, output: 20 },
      wallClockDurationMs: 1000,
      timestamp: "2026-09-05T09:05:00.000Z",
      artifactId: lesson.id,
      artifactContentHash: usage.artifactContentHash,
      taskRunId: usage.taskRunId,
      applicationId: usage.applicationId,
    };

    const [first, second] = await Promise.all([
      slRecordResourceReceipt(root, input),
      slRecordResourceReceipt(root, {
        ...input,
        timestamp: "2026-09-05T09:06:00.000Z",
      }),
    ]);
    expect([first.change.action, second.change.action].sort()).toEqual([
      "create",
      "skip",
    ]);
    expect(await slLoadResourceReceipts(root)).toHaveLength(1);

    await expect(
      slRecordResourceReceipt(root, {
        ...input,
        idempotencyKey: "conflicting-application-resource",
        tokens: { input: 101, output: 20 },
      }),
    ).rejects.toThrow("collision");
  });

  test("fails closed for invalid resource accounting and unsafe metadata", () => {
    const base = {
      idempotencyKey: "invalid-resource",
      phase: "generation" as const,
      source: "host" as const,
      quality: "measured" as const,
      provider: "openai",
      modelId: "gpt-5.6-sol",
      tokens: { input: 1, output: 1 },
      wallClockDurationMs: 10,
      timestamp: NOW.toISOString(),
      artifactId: "SL-TEST",
      artifactContentHash: "a".repeat(64),
      generationRunId: "generation-run",
    };

    expect(() =>
      slCreateResourceReceipt({
        ...base,
        tokens: { input: -1, output: 1 },
      }),
    ).toThrow("tokens.input");
    expect(() =>
      slCreateResourceReceipt({
        ...base,
        modelDurationMs: 11,
      }),
    ).toThrow("cannot exceed");
    expect(() =>
      slCreateResourceReceipt({
        ...base,
        modelId: "token=abcdefghijklmnop",
      }),
    ).toThrow("secrets");
    expect(() =>
      slCreateResourceReceipt({
        ...base,
        reportedCost: {
          amount: "0.1234567890123",
          currency: "USD",
          basis: "host-reported",
        },
      }),
    ).toThrow("reportedCost.amount");
  });

  test("keeps dry-run side effect free", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const lesson = await createLesson(root);
    const result = await slRecordResourceReceipt(
      root,
      {
        idempotencyKey: "generation-resource-dry-run",
        phase: "generation",
        source: "manual",
        quality: "estimated",
        provider: "openai",
        modelId: "gpt-5.6-sol",
        tokens: { input: 200, output: 40 },
        wallClockDurationMs: 2000,
        timestamp: NOW.toISOString(),
        artifactId: lesson.id,
        artifactContentHash: lesson.contentHash,
        generationRunId: "generation-dry-run",
      },
      true,
    );

    expect(result.change.action).toBe("create");
    expect(await slLoadResourceReceipts(root)).toEqual([]);
  });

  test("reports stale resource projections without rewriting receipts", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const lesson = await createLesson(root);
    await slRecordResourceReceipt(root, {
      idempotencyKey: "generation-resource-validation",
      phase: "generation",
      source: "host",
      quality: "measured",
      provider: "openai",
      modelId: "gpt-5.6-sol",
      tokens: { input: 200, output: 40 },
      wallClockDurationMs: 2000,
      timestamp: NOW.toISOString(),
      artifactId: lesson.id,
      artifactContentHash: lesson.contentHash,
      generationRunId: "generation-run-validation",
    });
    await slSynchronizeResourceProjection(root, false);
    const catalog = await slLoadStateCatalog(root);
    const projectionPath = catalog.scopes[0]!.resourceProjectionPath!;
    const absoluteProjectionPath = join(
      root,
      ...projectionPath.split("/"),
    );
    const projection = JSON.parse(
      await readFile(absoluteProjectionPath, "utf8"),
    );
    projection.projections[0].totalTokens += 1;
    await writeFile(
      absoluteProjectionPath,
      `${JSON.stringify(projection, null, 2)}\n`,
      "utf8",
    );

    const issues = await slValidateRepository(root);
    expect(issues).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "resource-projection-drift",
        path: projectionPath,
      }),
    );
    expect(await slLoadResourceReceipts(root)).toHaveLength(1);
  });

  test("validates baseline role and exact decimal accounting", () => {
    const receipt = slCreateResourceReceipt({
      idempotencyKey: "baseline-validation",
      phase: "baseline",
      source: "manual",
      quality: "estimated",
      provider: "openai",
      modelId: "gpt-5.6-sol",
      tokens: { input: 10, output: 2 },
      wallClockDurationMs: 100,
      timestamp: NOW.toISOString(),
      taskRunId: "baseline-task",
      comparison: {
        comparisonId: "comparison-validation",
        scenarioKey: "scenario-validation",
        role: "baseline",
      },
    });
    expect(() => slValidateResourceReceipt(receipt)).not.toThrow();
  });
});
