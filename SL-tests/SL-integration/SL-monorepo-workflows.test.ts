import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { afterEach, describe, expect, test } from "vitest";
import { slCaptureLesson } from "../../SL-src/SL-core/SL-capture.js";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import { slBuildPromotionGovernanceContext } from "../../SL-src/SL-core/SL-promotion-context.js";
import {
  slActivatePromotion,
  slEvaluatePromotionReadiness,
  slRegisterPromotion,
} from "../../SL-src/SL-core/SL-promotion.js";
import { slRetrieveArtifacts } from "../../SL-src/SL-core/SL-retrieval.js";
import { slForgetArtifact } from "../../SL-src/SL-forgetting/SL-forgetting.js";
import { slScopeCatalogEntry } from "../../SL-src/SL-core/SL-state.js";
import {
  slFinishUsage,
  slProjectUsage,
  slStartUsage,
} from "../../SL-src/SL-core/SL-usage.js";
import { slValidateRepository } from "../../SL-src/SL-validation/SL-validation.js";
import {
  slCreateTestContract,
  slTestContractPath,
  slWriteTestJson,
  slWriteTestPromotedArtifact,
} from "../SL-fixtures/SL-validation-contract.js";
import {
  slCreateTestRepository,
  slRemoveTestRepository,
} from "../SL-fixtures/SL-test-repository.js";

const repositories: string[] = [];
const FIXED_NOW = new Date("2026-09-04T10:00:00.000Z");

const ROOT_SCOPE = {
  id: "SL-SCOPE-ROOT",
  displayName: "Repository",
  kind: "repository",
  includePaths: ["**"],
  excludePaths: [],
  dependencyScopeIds: [],
  ownerAliases: ["@example/root"],
} as const;

const SOLUTION_SCOPE = {
  id: "SL-SCOPE-ORDERS-SOLUTION",
  displayName: "Orders solution",
  kind: "solution",
  includePaths: ["solutions/orders/**"],
  excludePaths: [],
  parentScopeId: ROOT_SCOPE.id,
  dependencyScopeIds: [],
  ownerAliases: ["@example/orders"],
} as const;

const LIBRARY_SCOPE = {
  id: "SL-SCOPE-COMMON-LIBRARY",
  displayName: "Common library",
  kind: "library",
  includePaths: ["libraries/common/**"],
  excludePaths: [],
  parentScopeId: ROOT_SCOPE.id,
  dependencyScopeIds: [],
  ownerAliases: ["@example/common"],
} as const;

const SERVICE_SCOPE = {
  id: "SL-SCOPE-ORDERS-SERVICE",
  displayName: "Orders service",
  kind: "service",
  includePaths: ["services/orders/**"],
  excludePaths: ["services/orders/generated/**"],
  parentScopeId: SOLUTION_SCOPE.id,
  dependencyScopeIds: [LIBRARY_SCOPE.id],
  ownerAliases: ["@example/orders"],
} as const;

const BILLING_SCOPE = {
  id: "SL-SCOPE-BILLING-SERVICE",
  displayName: "Billing service",
  kind: "service",
  includePaths: ["services/billing/**"],
  excludePaths: [],
  parentScopeId: ROOT_SCOPE.id,
  dependencyScopeIds: [LIBRARY_SCOPE.id],
  ownerAliases: ["@example/billing"],
} as const;

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(slRemoveTestRepository));
});

describe("SL integrated monorepo workflows", () => {
  test("retrieves local, dependency, ancestor, and root artifacts in precedence order", async () => {
    const root = await createMonorepo();
    const rootLesson = await capture(root, "Root guidance", ROOT_SCOPE.id, "root");
    const solutionLesson = await capture(
      root,
      "Solution guidance",
      SOLUTION_SCOPE.id,
      "solution",
    );
    const libraryLesson = await capture(
      root,
      "Library guidance",
      LIBRARY_SCOPE.id,
      "library",
    );
    const serviceLesson = await capture(
      root,
      "Service guidance",
      SERVICE_SCOPE.id,
      "service",
    );

    const result = await slRetrieveArtifacts(
      root,
      "services\\orders\\src\\handler.ts",
    );

    expect(result.orderedScopeIds).toEqual([
      SERVICE_SCOPE.id,
      LIBRARY_SCOPE.id,
      SOLUTION_SCOPE.id,
      ROOT_SCOPE.id,
    ]);
    expect(result.artifacts.map((artifact) => artifact.id)).toEqual([
      serviceLesson.id,
      libraryLesson.id,
      solutionLesson.id,
      rootLesson.id,
    ]);
    expect(result.artifacts.map((artifact) => artifact.relation)).toEqual([
      "local",
      "dependency",
      "ancestor",
      "root",
    ]);
  });

  test("records dependency use in the consuming source scope shard", async () => {
    const root = await createMonorepo();
    const libraryLesson = await capture(
      root,
      "Reusable library guidance",
      LIBRARY_SCOPE.id,
      "library-use",
    );
    const started = await slStartUsage(root, libraryLesson.id, {
      applicationId: "orders-library-application",
      taskRunId: "orders-library-task",
      idempotencyKey: "orders-library-start",
      scope: {
        id: SERVICE_SCOPE.id,
        path: "services/orders",
      },
      now: FIXED_NOW,
    });
    await slFinishUsage(root, started.receiptId, {
      outcome: "success",
      verified: true,
      verifierType: "test-suite",
      evidenceRef: "run:orders-library",
      idempotencyKey: "orders-library-finish",
      now: new Date("2026-09-04T10:01:00.000Z"),
    });

    const projections = await slProjectUsage(root, libraryLesson.id);
    expect(projections).toHaveLength(1);
    expect(projections[0]).toMatchObject({
      scope: {
        id: SERVICE_SCOPE.id,
        path: "services/orders",
      },
      verifiedSuccessCount: 1,
    });
    const eventPath = slScopeCatalogEntry({
      id: SERVICE_SCOPE.id,
      path: "services/orders",
    }).usageEventsPath;
    expect(started.changes[0]?.path).toContain(eventPath);
  });

  test("infers capture scope and diagnoses orphaned scope state", async () => {
    const root = await createMonorepo();
    const lesson = await slCaptureLesson(root, {
      title: "Inferred orders scope",
      kind: "win",
      scope: "orders",
      triggers: ["scope-inference"],
      targetPath: "services/orders/src/order.ts",
      dryRun: false,
      now: FIXED_NOW,
    });
    expect(
      (await slRetrieveArtifacts(root, "services/orders/src/order.ts"))
        .artifacts[0]?.id,
    ).toBe(lesson.id);

    await writeScopeCatalog(root, [
      ROOT_SCOPE,
      SOLUTION_SCOPE,
      LIBRARY_SCOPE,
      BILLING_SCOPE,
    ]);
    const issues = await slValidateRepository(root);
    expect(
      issues.some(
        (issue) =>
          issue.code === "artifact-scope-invalid" ||
          issue.code === "scope-state-orphan",
      ),
    ).toBe(true);
  });

  test("activates a shared promotion only with two-scope evidence and target-owner approval", async () => {
    const root = await createMonorepo(true);
    const source = await capture(
      root,
      "Cross-service promotion source",
      SERVICE_SCOPE.id,
      "cross-service",
    );
    await recordVerifiedUse(root, source.id, SERVICE_SCOPE.id, "services/orders", "orders");
    await recordVerifiedUse(root, source.id, BILLING_SCOPE.id, "services/billing", "billing");

    const artifactId = "SL-MONOREPO-GUIDANCE";
    const artifactPath =
      ".github/instructions/sl-monorepo-guidance.instructions.md";
    const contractPath = slTestContractPath(artifactId);
    await slWriteTestJson(
      root,
      contractPath,
      slCreateTestContract({
        artifactId,
        artifactType: "instruction",
        artifactPath,
        sourceIds: [source.id],
      }),
    );
    await slWriteTestPromotedArtifact({
      root,
      artifactId,
      artifactType: "instruction",
      artifactPath,
      contractPath,
    });
    await slRegisterPromotion(
      root,
      source.id,
      artifactPath,
      false,
      FIXED_NOW,
      { targetScopeId: ROOT_SCOPE.id },
    );
    const governance = await slBuildPromotionGovernanceContext(
      root,
      artifactId,
      {
        targetScopeId: ROOT_SCOPE.id,
        ownerApprovalRefs: ["review:root-owners"],
      },
    );
    const readiness = await slEvaluatePromotionReadiness(root, artifactId, {
      governance,
      now: new Date("2026-09-04T10:05:00.000Z"),
    });
    expect(readiness.evaluation.status).toBe("passed");

    await slActivatePromotion(
      root,
      artifactId,
      false,
      new Date("2026-09-04T10:06:00.000Z"),
      { governance },
    );
    expect(
      (await slRetrieveArtifacts(root, "services/orders/src/order.ts"))
        .artifacts.some((artifact) => artifact.id === artifactId),
    ).toBe(true);
    await expect(
      slForgetArtifact(root, source.id, "irrelevant", false, FIXED_NOW),
    ).rejects.toThrow("active dependent");
    expect(await slValidateRepository(root)).toEqual([]);
  });
});

async function createMonorepo(monorepoPromotion = false): Promise<string> {
  const root = await slCreateTestRepository();
  repositories.push(root);
  await slInstall(root, "init", false);
  await writeScopeCatalog(root, [
    ROOT_SCOPE,
    SOLUTION_SCOPE,
    LIBRARY_SCOPE,
    SERVICE_SCOPE,
    BILLING_SCOPE,
  ]);
  if (monorepoPromotion) {
    const configPath = join(root, ".github", "sl-learning", "sl-config.yml");
    const config = parse(await readFile(configPath, "utf8"));
    config.promotion.mode = "monorepo";
    await writeFile(configPath, stringify(config), "utf8");
  }
  return root;
}

async function writeScopeCatalog(
  root: string,
  scopes: readonly unknown[],
): Promise<void> {
  const learningRoot = join(root, ".github", "sl-learning");
  await rm(join(learningRoot, "sl-scope-catalog.yml"), { force: true });
  await writeFile(
    join(learningRoot, "sl-scope-catalog.json"),
    `${JSON.stringify({ schemaVersion: 1, scopes }, null, 2)}\n`,
    "utf8",
  );
}

async function capture(
  root: string,
  title: string,
  scopeId: string,
  trigger: string,
) {
  return slCaptureLesson(root, {
    title,
    kind: "win",
    scope: scopeId,
    triggers: [trigger],
    scopeId,
    dryRun: false,
    now: FIXED_NOW,
  });
}

async function recordVerifiedUse(
  root: string,
  artifactId: string,
  scopeId: string,
  scopePath: string,
  suffix: string,
): Promise<void> {
  const started = await slStartUsage(root, artifactId, {
    applicationId: `${suffix}-application`,
    taskRunId: `${suffix}-task`,
    idempotencyKey: `${suffix}-start`,
    scope: { id: scopeId, path: scopePath },
    now: FIXED_NOW,
  });
  await slFinishUsage(root, started.receiptId, {
    outcome: "success",
    verified: true,
    verifierType: "test-suite",
    evidenceRef: `run:${suffix}`,
    idempotencyKey: `${suffix}-finish`,
    now: new Date("2026-09-04T10:01:00.000Z"),
  });
}
