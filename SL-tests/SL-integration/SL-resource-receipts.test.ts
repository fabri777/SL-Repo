import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { slCaptureLesson } from "../../SL-src/SL-core/SL-capture.js";
import { slCalculateEfficiencyReport } from "../../SL-src/SL-core/SL-efficiency.js";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import { slRegisterPromotion } from "../../SL-src/SL-core/SL-promotion.js";
import {
  slCreateResourceReceipt,
  slImportResourceReceipts,
  slLoadResourceReceipts,
  slParseResourceReceiptInputs,
  slProjectResourceReceipts,
  slRecordResourceReceipt,
  slResourceReceiptPath,
  slResolveGenerationResourceIdentity,
  slSynchronizeResourceProjection,
  slValidateResourceReceipt,
} from "../../SL-src/SL-core/SL-resource.js";
import {
  slLoadStateCatalog,
  slScopeCatalogEntry,
} from "../../SL-src/SL-core/SL-state.js";
import type { SLChange } from "../../SL-src/SL-core/SL-types.js";
import {
  slArtifactUsageContentHash,
  slFinishUsage,
  slStartUsage,
} from "../../SL-src/SL-core/SL-usage.js";
import {
  slCreateTestRepository,
  slRemoveTestRepository,
} from "../SL-fixtures/SL-test-repository.js";
import { slValidateRepository } from "../../SL-src/SL-validation/SL-validation.js";
import {
  slCreateTestContract,
  slTestContractPath,
  slWriteTestJson,
  slWriteTestPromotedArtifact,
} from "../SL-fixtures/SL-validation-contract.js";

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

async function createVerifiedApplication(
  root: string,
  artifactId: string,
  applicationId: string,
  minute: number,
) {
  const usage = await slStartUsage(root, artifactId, {
    applicationId,
    taskRunId: `${applicationId}-task`,
    idempotencyKey: `${applicationId}-start`,
    now: new Date(`2026-09-05T10:${String(minute).padStart(2, "0")}:00.000Z`),
  });
  await slFinishUsage(root, applicationId, {
    outcome: "success",
    verified: true,
    verifierType: "test-suite",
    evidenceRef: `ci:${applicationId}`,
    idempotencyKey: `${applicationId}-finish`,
    now: new Date(`2026-09-05T11:${String(minute).padStart(2, "0")}:00.000Z`),
  });
  return usage;
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
        action: "update",
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
        timestamp: "2026-10-05T09:06:00.000Z",
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

  test("canonicalizes equivalent cross-month merge receipts to the earliest timestamp", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const lesson = await createLesson(root);
    const later = await slRecordResourceReceipt(root, {
      idempotencyKey: "cross-month-generation-resource",
      phase: "generation",
      source: "host",
      quality: "measured",
      provider: "openai",
      modelId: "gpt-5.6-sol",
      tokens: { input: 200, output: 40 },
      wallClockDurationMs: 2000,
      timestamp: "2026-10-05T09:00:00.000Z",
      artifactId: lesson.id,
      artifactContentHash: lesson.contentHash,
      generationRunId: "cross-month-generation-run",
    });
    const earlier = {
      ...later.receipt,
      timestamp: "2026-09-30T23:59:00.000Z",
    };
    await slWriteTestJson(
      root,
      slResourceReceiptPath(earlier),
      earlier,
    );

    const receipts = await slLoadResourceReceipts(root);
    expect(receipts).toEqual([earlier]);
    expect(
      slProjectResourceReceipts([later.receipt, earlier]),
    ).toEqual([
      expect.objectContaining({
        receiptCount: 1,
        totalTokens: 240,
      }),
    ]);

    await slSynchronizeResourceProjection(root, false);
    const report = await slCalculateEfficiencyReport(root, {
      artifactId: lesson.id,
    });
    expect(report.segments).toHaveLength(1);
    expect(report.segments[0]!.generation.totals).toMatchObject({
      receiptCount: 1,
      totalTokens: 240,
    });
    expect(
      (await slValidateRepository(root)).filter(
        (issue) => issue.severity === "error",
      ),
    ).toEqual([]);
  });

  test("rejects conflicting cross-month merge receipts", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const lesson = await createLesson(root);
    const later = await slRecordResourceReceipt(root, {
      idempotencyKey: "cross-month-conflicting-resource",
      phase: "generation",
      source: "host",
      quality: "measured",
      provider: "openai",
      modelId: "gpt-5.6-sol",
      tokens: { input: 200, output: 40 },
      wallClockDurationMs: 2000,
      timestamp: "2026-10-05T09:00:00.000Z",
      artifactId: lesson.id,
      artifactContentHash: lesson.contentHash,
      generationRunId: "cross-month-conflicting-run",
    });
    const conflicting = {
      ...later.receipt,
      tokens: { input: 201, output: 40 },
      timestamp: "2026-09-30T23:59:00.000Z",
    };
    await slWriteTestJson(
      root,
      slResourceReceiptPath(conflicting),
      conflicting,
    );

    await expect(slLoadResourceReceipts(root)).rejects.toThrow(
      "Conflicting SL resource receipt identity",
    );
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
    expect(() =>
      slParseResourceReceiptInputs({
        ...base,
        taskRunId: "forbidden-generation-task",
      }),
    ).toThrow("taskRunId is not allowed for generation");
    expect(() =>
      slCreateResourceReceipt({
        idempotencyKey: "invalid-baseline-role",
        phase: "baseline",
        source: "host",
        quality: "measured",
        provider: "openai",
        modelId: "gpt-5.6-sol",
        tokens: { input: 1, output: 1 },
        wallClockDurationMs: 10,
        timestamp: NOW.toISOString(),
        taskRunId: "baseline-task",
        comparison: {
          comparisonId: "comparison",
          scenarioKey: "scenario",
          role: "treatment",
        },
      }),
    ).toThrow("comparison.role must be baseline");
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

  test("reports a declared resource projection that is missing", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const catalog = await slLoadStateCatalog(root);
    const projectionPath = catalog.scopes[0]!.resourceProjectionPath!;
    await rm(join(root, ...projectionPath.split("/")));

    const issues = await slValidateRepository(root);

    expect(issues).toContainEqual({
      severity: "error",
      code: "missing-resource-projection",
      path: projectionPath,
      message: "Generated scope resource projection is missing.",
    });
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

  test("imports strict provider-neutral receipt envelopes and projects the planned batch", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const lesson = await createLesson(root);
    const input = slParseResourceReceiptInputs({
      schemaVersion: 1,
      receipts: [
        {
          idempotencyKey: "provider-neutral-generation",
          phase: "generation",
          source: "ci",
          quality: "measured",
          provider: "provider-a",
          modelId: "model-a",
          tokens: { input: 200, output: 50 },
          wallClockDurationMs: 3000,
          timestamp: NOW.toISOString(),
          artifactId: lesson.id,
          artifactContentHash: lesson.contentHash,
          generationRunId: "provider-neutral-run",
        },
      ],
    });

    const planned = await slImportResourceReceipts(root, input, true);
    expect(planned.receipts).toHaveLength(1);
    expect(planned.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "create",
          path: expect.stringContaining("SL-resource-receipts"),
        }),
        expect.objectContaining({
          action: "update",
          path: expect.stringContaining("SL-resource-projection.json"),
        }),
      ]),
    );
    expect(await slLoadResourceReceipts(root)).toEqual([]);

    const [first, second] = await Promise.all([
      slImportResourceReceipts(root, input),
      slImportResourceReceipts(root, input),
    ]);
    expect(
      [first, second]
        .flatMap((result) => result.changes)
        .filter((change) => change.path.includes("SL-resource-receipts"))
        .map((change) => change.action)
        .sort(),
    ).toEqual(["create", "skip"]);
    expect(await slLoadResourceReceipts(root)).toHaveLength(1);

    expect(() =>
      slParseResourceReceiptInputs({
        ...input[0],
        sourcePayload: "must-not-be-persisted",
      }),
    ).toThrow("unsupported fields");
    await expect(
      slImportResourceReceipts(root, [
        {
          idempotencyKey: "orphan-baseline",
          phase: "baseline",
          source: "manual",
          quality: "estimated",
          provider: "provider-a",
          modelId: "model-a",
          tokens: { input: 10, output: 1 },
          wallClockDurationMs: 100,
          timestamp: NOW.toISOString(),
          scope: { id: "SL-SCOPE-UNKNOWN", path: "unknown" },
          taskRunId: "orphan-baseline-task",
          comparison: {
            comparisonId: "orphan-comparison",
            scenarioKey: "orphan-scenario",
            role: "baseline",
          },
        },
      ]),
    ).rejects.toThrow("scope is not registered");
  });

  test("calculates segmented verified-success efficiency, strict pairs, negative savings, and break-even", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const lesson = await createLesson(root);
    await slRecordResourceReceipt(root, {
      idempotencyKey: "efficiency-generation",
      phase: "generation",
      source: "host",
      quality: "measured",
      provider: "provider-a",
      modelId: "model-a",
      tokens: { input: 1000, output: 0 },
      wallClockDurationMs: 10000,
      timestamp: NOW.toISOString(),
      artifactId: lesson.id,
      artifactContentHash: lesson.contentHash,
      generationRunId: "efficiency-generation-run",
      reportedCost: {
        amount: "0.1",
        currency: "USD",
        basis: "host-reported",
      },
    });

    for (const [index, values] of [
      {
        applicationId: "efficiency-positive",
        modelId: "model-a",
        input: 100,
        cost: "0.04",
      },
      {
        applicationId: "efficiency-negative",
        modelId: "model-a",
        input: 100,
        cost: "0.02",
      },
      { applicationId: "efficiency-incompatible", modelId: "model-b", input: 90 },
      {
        applicationId: "efficiency-unreported",
        modelId: undefined,
        input: 0,
        cost: undefined,
      },
    ].entries()) {
      const usage = await createVerifiedApplication(
        root,
        lesson.id,
        values.applicationId,
        index,
      );
      if (!values.modelId) {
        continue;
      }
      await slRecordResourceReceipt(root, {
        idempotencyKey: `${values.applicationId}-resource`,
        phase: "application",
        source: "host",
        quality: "measured",
        provider: "provider-a",
        modelId: values.modelId,
        tokens: { input: values.input, output: 0 },
        wallClockDurationMs: 1000,
        timestamp: `2026-09-05T12:${String(index).padStart(2, "0")}:00.000Z`,
        artifactId: lesson.id,
        artifactContentHash: usage.artifactContentHash,
        taskRunId: usage.taskRunId,
        applicationId: usage.applicationId,
        ...(values.cost
          ? {
              reportedCost: {
                amount: values.cost,
                currency: "USD",
                basis: "host-reported" as const,
              },
            }
          : {}),
        comparison: {
          comparisonId: `comparison-${index}`,
          scenarioKey: "same-scenario",
          role: "treatment",
        },
      });
    }

    for (const [index, input] of [
      { tokens: 220, quality: "measured" as const, cost: "0.03" },
      { tokens: 60, quality: "measured" as const, cost: "0.08" },
      { tokens: 200, quality: "estimated" as const, cost: undefined },
    ].entries()) {
      await slRecordResourceReceipt(root, {
        idempotencyKey: `efficiency-baseline-${index}`,
        phase: "baseline",
        source: "manual",
        quality: input.quality,
        provider: "provider-b",
        modelId: "baseline-model",
        tokens: { input: input.tokens, output: 0 },
        wallClockDurationMs: 1500,
        timestamp: `2026-09-05T09:${String(index).padStart(2, "0")}:00.000Z`,
        taskRunId: `baseline-task-${index}`,
        ...(input.cost
          ? {
              reportedCost: {
                amount: input.cost,
                currency: "USD",
                basis: "host-reported" as const,
              },
            }
          : {}),
        comparison: {
          comparisonId: `comparison-${index}`,
          scenarioKey: "same-scenario",
          role: "baseline",
        },
      });
    }

    const report = await slCalculateEfficiencyReport(root, {
      artifactId: lesson.id,
    });
    expect(report.segments).toHaveLength(2);
    const main = report.segments.find(
      (segment) => segment.key.modelId === "model-a",
    );
    expect(main).toBeDefined();
    expect(main!.verifiedSuccessApplications).toMatchObject({
      eligibleCount: 4,
      receiptCount: 2,
      coverage: 0.5,
    });
    expect(main!.verifiedSuccessApplications.average).toMatchObject({
      sampleCount: 2,
      inputTokens: 100,
      totalTokens: 100,
    });
    expect(main!.generation.amortizedPerVerifiedSuccess).toMatchObject({
      sampleCount: 4,
      inputTokens: 250,
      totalTokens: 250,
    });
    expect(
      main!.verifiedSuccessApplications.averageWithAmortizedGeneration,
    ).toMatchObject({
      inputTokens: 350,
      totalTokens: 350,
    });
    expect(main!.pairedBaseline.pairSavings.map((pair) => pair.savings.inputTokens))
      .toEqual([120, -40]);
    expect(
      main!.pairedBaseline.pairSavings.map(
        (pair) => pair.savings.reportedCosts.USD,
      ),
    ).toEqual(["-0.01", "0.06"]);
    expect(main!.pairedBaseline.medianSavings).toMatchObject({
      inputTokens: 40,
      totalTokens: 40,
      reportedCosts: { USD: "0.025" },
    });
    expect(main!.pairedBaseline.breakEvenApplications).toMatchObject({
      inputTokens: 25,
      totalTokens: 25,
      reportedCosts: { USD: 4 },
    });

    const incompatible = report.segments.find(
      (segment) => segment.key.modelId === "model-b",
    );
    expect(incompatible!.pairedBaseline).toMatchObject({
      compatiblePairCount: 0,
      incompatiblePairCount: 1,
      breakEvenApplications: null,
    });
    expect(incompatible!.pairedBaseline.incompatibilities).toEqual([
      expect.objectContaining({ reason: "quality-mismatch" }),
    ]);
    expect(report.unpairedBaselineCount).toBe(1);
  });

  test("rejects incomplete or ambiguous comparison, scenario, and scope pairs", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const lesson = await createLesson(root);
    const stateCatalog = await slLoadStateCatalog(root);
    stateCatalog.scopes.push(
      slScopeCatalogEntry({
        id: "SL-SCOPE-OTHER",
        path: "services/other",
      }),
    );
    await writeFile(
      join(root, ".github", "SL-learning", "SL-state-catalog.json"),
      `${JSON.stringify(stateCatalog, null, 2)}\n`,
      "utf8",
    );
    const treatments = [
      { applicationId: "strict-ambiguous-baseline", comparisonId: "strict-a" },
      { applicationId: "strict-scenario", comparisonId: "strict-b" },
      { applicationId: "strict-scope", comparisonId: "strict-c" },
      { applicationId: "strict-missing", comparisonId: "strict-d" },
      { applicationId: "strict-duplicate-1", comparisonId: "strict-e" },
      { applicationId: "strict-duplicate-2", comparisonId: "strict-e" },
    ];
    for (const [index, treatment] of treatments.entries()) {
      const usage = await createVerifiedApplication(
        root,
        lesson.id,
        treatment.applicationId,
        index,
      );
      await slRecordResourceReceipt(root, {
        idempotencyKey: `${treatment.applicationId}-resource`,
        phase: "application",
        source: "host",
        quality: "measured",
        provider: "provider-a",
        modelId: "model-a",
        tokens: { input: 100, output: 10 },
        wallClockDurationMs: 1000,
        timestamp: `2026-09-05T12:${String(index).padStart(2, "0")}:00.000Z`,
        artifactId: lesson.id,
        artifactContentHash: usage.artifactContentHash,
        taskRunId: usage.taskRunId,
        applicationId: usage.applicationId,
        comparison: {
          comparisonId: treatment.comparisonId,
          scenarioKey: "strict-scenario",
          role: "treatment",
        },
      });
    }
    const baselines = [
      {
        id: "strict-a-1",
        comparisonId: "strict-a",
        scenarioKey: "strict-scenario",
        scope: undefined,
      },
      {
        id: "strict-a-2",
        comparisonId: "strict-a",
        scenarioKey: "strict-scenario",
        scope: undefined,
      },
      {
        id: "strict-b",
        comparisonId: "strict-b",
        scenarioKey: "different-scenario",
        scope: undefined,
      },
      {
        id: "strict-c",
        comparisonId: "strict-c",
        scenarioKey: "strict-scenario",
        scope: { id: "SL-SCOPE-OTHER", path: "services/other" },
      },
      {
        id: "strict-e",
        comparisonId: "strict-e",
        scenarioKey: "strict-scenario",
        scope: undefined,
      },
    ];
    for (const [index, baseline] of baselines.entries()) {
      await slRecordResourceReceipt(root, {
        idempotencyKey: `${baseline.id}-baseline-resource`,
        phase: "baseline",
        source: "manual",
        quality: "measured",
        provider: "provider-b",
        modelId: "model-b",
        tokens: { input: 150, output: 20 },
        wallClockDurationMs: 1500,
        timestamp: `2026-09-05T09:${String(index).padStart(2, "0")}:00.000Z`,
        taskRunId: `${baseline.id}-baseline-task`,
        ...(baseline.scope ? { scope: baseline.scope } : {}),
        comparison: {
          comparisonId: baseline.comparisonId,
          scenarioKey: baseline.scenarioKey,
          role: "baseline",
        },
      });
    }

    const report = await slCalculateEfficiencyReport(root, {
      artifactId: lesson.id,
    });
    expect(report.segments).toHaveLength(1);
    expect(report.segments[0]!.pairedBaseline).toMatchObject({
      compatiblePairCount: 0,
      incompatiblePairCount: 6,
      medianSavings: null,
      breakEvenApplications: null,
    });
    expect(
      report.segments[0]!.pairedBaseline.incompatibilities
        .map((entry) => entry.reason)
        .sort(),
    ).toEqual([
      "ambiguous-baseline",
      "ambiguous-treatment",
      "ambiguous-treatment",
      "missing-baseline",
      "scenario-mismatch",
      "scope-mismatch",
    ]);
  });

  test("reports promotion direct, source, and combined resource lineage", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    const source = await createLesson(root);
    await slRecordResourceReceipt(root, {
      idempotencyKey: "lineage-source-generation",
      phase: "generation",
      source: "host",
      quality: "measured",
      provider: "provider-a",
      modelId: "model-a",
      tokens: { input: 100, output: 0 },
      wallClockDurationMs: 1000,
      timestamp: NOW.toISOString(),
      artifactId: source.id,
      artifactContentHash: source.contentHash,
      generationRunId: "lineage-source-run",
    });

    const promotedId = "SL-EFFICIENCY-LINEAGE";
    const artifactPath = `.github/skills/${promotedId.toLowerCase()}/SKILL.md`;
    const contractPath = slTestContractPath(promotedId);
    await slWriteTestPromotedArtifact({
      root,
      artifactId: promotedId,
      artifactType: "skill",
      artifactPath,
      contractPath,
    });
    await slWriteTestJson(
      root,
      contractPath,
      slCreateTestContract({
        artifactId: promotedId,
        artifactType: "skill",
        artifactPath,
        sourceIds: [source.id],
      }),
    );
    await slRegisterPromotion(
      root,
      source.id,
      artifactPath,
      false,
      NOW,
    );
    const promoted = await slResolveGenerationResourceIdentity(
      root,
      promotedId,
    );
    await slRecordResourceReceipt(root, {
      idempotencyKey: "lineage-direct-generation",
      phase: "generation",
      source: "host",
      quality: "measured",
      provider: "provider-a",
      modelId: "model-a",
      tokens: { input: 50, output: 0 },
      wallClockDurationMs: 500,
      timestamp: "2026-09-05T09:30:00.000Z",
      ...promoted,
      generationRunId: "lineage-direct-run",
    });

    const report = await slCalculateEfficiencyReport(root, {
      artifactId: promotedId,
    });
    expect(report.promotionLineage).toEqual([
      expect.objectContaining({
        artifactId: promotedId,
        directArtifactIds: [promotedId],
        sourceArtifactIds: [source.id],
        direct: expect.objectContaining({
          combined: expect.objectContaining({ inputTokens: 50 }),
        }),
        source: expect.objectContaining({
          combined: expect.objectContaining({ inputTokens: 100 }),
        }),
        combined: expect.objectContaining({
          combined: expect.objectContaining({ inputTokens: 150 }),
          segments: expect.arrayContaining([
            expect.objectContaining({
              key: expect.objectContaining({
                artifactId: promotedId,
                artifactVersion: `sha256:${promoted.artifactContentHash}`,
                provider: "provider-a",
                modelId: "model-a",
                quality: "measured",
                phase: "generation",
              }),
            }),
            expect.objectContaining({
              key: expect.objectContaining({
                artifactId: source.id,
                provider: "provider-a",
                modelId: "model-a",
                quality: "measured",
                phase: "generation",
              }),
            }),
          ]),
        }),
      }),
    ]);
  });
});
