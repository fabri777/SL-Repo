import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { slCaptureLesson } from "../../SL-src/SL-core/SL-capture.js";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import { slBuildPromotionGovernanceContext } from "../../SL-src/SL-core/SL-promotion-context.js";
import {
  slActivatePromotion,
  slEvaluatePromotionReadiness,
  slRegisterPromotion,
} from "../../SL-src/SL-core/SL-promotion.js";
import { slLoadRegistry } from "../../SL-src/SL-core/SL-registry.js";
import { slScopeDescriptor } from "../../SL-src/SL-core/SL-scope.js";
import type {
  SLRegistryArtifact,
  SLScopeDefinition,
} from "../../SL-src/SL-core/SL-types.js";
import {
  slArtifactUsageContentHash,
  slCreateUsageEvent,
  slFinishUsage,
  slStartUsage,
  slWriteUsageEvent,
} from "../../SL-src/SL-core/SL-usage.js";
import { slForgetArtifact } from "../../SL-src/SL-forgetting/SL-forgetting.js";
import {
  slCreateTestContract,
  slTestContractPath,
  slWriteTestJson,
  slWriteTestPromotedArtifact,
} from "./SL-validation-contract.js";
import { slCreateTestRepository } from "./SL-test-repository.js";

const FIXED_NOW = new Date("2026-09-04T12:00:00.000Z");

export const SL_MONOREPO_SCOPES = {
  root: {
    id: "SL-SCOPE-ROOT",
    displayName: "Repository",
    kind: "repository",
    includePaths: ["**"],
    excludePaths: [],
    dependencyScopeIds: [],
    ownerAliases: ["@example/platform"],
  },
  shared: {
    id: "SL-SCOPE-SHARED",
    displayName: "Shared platform",
    kind: "shared",
    includePaths: ["shared/**", "packages/shared/**"],
    excludePaths: ["packages/shared/private/**"],
    parentScopeId: "SL-SCOPE-ROOT",
    dependencyScopeIds: [],
    ownerAliases: ["@example/platform"],
  },
  commonLibrary: {
    id: "SL-SCOPE-COMMON-LIBRARY",
    displayName: "Common library",
    kind: "library",
    includePaths: ["packages/shared/common/**"],
    excludePaths: ["packages/shared/common/generated/**"],
    parentScopeId: "SL-SCOPE-SHARED",
    dependencyScopeIds: [],
    ownerAliases: ["@example/common"],
  },
  ordersSolution: {
    id: "SL-SCOPE-ORDERS-SOLUTION",
    displayName: "Orders solution",
    kind: "solution",
    includePaths: ["services/orders/**"],
    excludePaths: ["services/orders/generated/**"],
    parentScopeId: "SL-SCOPE-ROOT",
    dependencyScopeIds: ["SL-SCOPE-COMMON-LIBRARY"],
    ownerAliases: ["@example/orders"],
  },
  ordersService: {
    id: "SL-SCOPE-ORDERS-SERVICE",
    displayName: "Orders service",
    kind: "service",
    includePaths: ["services/orders/src/**", "services/orders/tests/**"],
    excludePaths: ["services/orders/src/generated/**"],
    parentScopeId: "SL-SCOPE-ORDERS-SOLUTION",
    dependencyScopeIds: ["SL-SCOPE-COMMON-LIBRARY"],
    ownerAliases: ["@example/orders-api"],
  },
  billingSolution: {
    id: "SL-SCOPE-BILLING-SOLUTION",
    displayName: "Billing solution",
    kind: "solution",
    includePaths: ["services/billing/**"],
    excludePaths: ["services/billing/generated/**"],
    parentScopeId: "SL-SCOPE-ROOT",
    dependencyScopeIds: ["SL-SCOPE-COMMON-LIBRARY"],
    ownerAliases: ["@example/billing"],
  },
  billingService: {
    id: "SL-SCOPE-BILLING-SERVICE",
    displayName: "Billing service",
    kind: "service",
    includePaths: ["services/billing/src/**", "services/billing/tests/**"],
    excludePaths: ["services/billing/src/generated/**"],
    parentScopeId: "SL-SCOPE-BILLING-SOLUTION",
    dependencyScopeIds: ["SL-SCOPE-COMMON-LIBRARY"],
    ownerAliases: ["@example/billing-api"],
  },
} as const satisfies Record<string, SLScopeDefinition>;

export interface SLMonorepoFixture {
  root: string;
  artifacts: {
    rootLesson: SLRegistryArtifact;
    ordersLesson: SLRegistryArtifact;
    billingLesson: SLRegistryArtifact;
    sharedLesson: SLRegistryArtifact;
    inactiveLesson: SLRegistryArtifact;
    rootPromotion: SLRegistryArtifact;
    ordersPromotion: SLRegistryArtifact;
  };
}

function repositoryPath(root: string, relativePath: string): string {
  return join(root, ...relativePath.split("/"));
}

async function writeRepositoryFile(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const path = repositoryPath(root, relativePath);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf8");
}

async function writeMonorepoCatalog(root: string): Promise<void> {
  const learningRoot = repositoryPath(root, ".github/sl-learning");
  await rm(join(learningRoot, "sl-scope-catalog.yml"), { force: true });
  await writeFile(
    join(learningRoot, "sl-scope-catalog.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        scopes: Object.values(SL_MONOREPO_SCOPES),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const configPath = join(learningRoot, "sl-config.yml");
  const config = parse(await readFile(configPath, "utf8"));
  config.promotion.mode = "monorepo";
  await writeFile(configPath, stringify(config), "utf8");
}

async function recordVerifiedUse(
  root: string,
  artifactId: string,
  scope: SLScopeDefinition,
  suffix: string,
): Promise<void> {
  const started = await slStartUsage(root, artifactId, {
    applicationId: `${suffix}-application`,
    taskRunId: `${suffix}-task`,
    idempotencyKey: `${suffix}-start`,
    scope: slScopeDescriptor(scope),
    now: FIXED_NOW,
  });
  await slFinishUsage(root, started.receiptId, {
    outcome: "success",
    verified: true,
    verifierType: "test-suite",
    evidenceRef: `ci:${suffix}`,
    idempotencyKey: `${suffix}-finish`,
    now: new Date(FIXED_NOW.getTime() + 60_000),
  });
}

async function activatePromotion(options: {
  root: string;
  sourceId: string;
  artifactId: string;
  targetScopeId: string;
  ownerApprovalRef: string;
  declarations: NonNullable<
    ReturnType<typeof slCreateTestContract>["declarations"]
  >;
}): Promise<void> {
  const artifactPath =
    `.github/instructions/${options.artifactId.toLowerCase()}.instructions.md`;
  const contractPath = slTestContractPath(options.artifactId);
  await slWriteTestJson(
    options.root,
    contractPath,
    slCreateTestContract({
      artifactId: options.artifactId,
      artifactType: "instruction",
      artifactPath,
      sourceIds: [options.sourceId],
      declarations: options.declarations,
    }),
  );
  await slWriteTestPromotedArtifact({
    root: options.root,
    artifactId: options.artifactId,
    artifactType: "instruction",
    artifactPath,
    contractPath,
  });
  await slRegisterPromotion(
    options.root,
    options.sourceId,
    artifactPath,
    false,
    FIXED_NOW,
    { targetScopeId: options.targetScopeId },
  );
  const governance = await slBuildPromotionGovernanceContext(
    options.root,
    options.artifactId,
    {
      targetScopeId: options.targetScopeId,
      ownerApprovalRefs: [options.ownerApprovalRef],
    },
  );
  const readiness = await slEvaluatePromotionReadiness(
    options.root,
    options.artifactId,
    {
      governance,
      now: new Date(FIXED_NOW.getTime() + 120_000),
    },
  );
  if (readiness.evaluation.status !== "passed") {
    throw new Error(
      `Fixture promotion ${options.artifactId} failed: ${readiness.evaluation.gates
        .filter((gate) => gate.status === "failed")
        .map((gate) => gate.message)
        .join("; ")}`,
    );
  }
  await slActivatePromotion(
    options.root,
    options.artifactId,
    false,
    new Date(FIXED_NOW.getTime() + 180_000),
    { governance },
  );
}

export async function slCreateMonorepoFixture(): Promise<SLMonorepoFixture> {
  const root = await slCreateTestRepository();
  await Promise.all([
    writeRepositoryFile(
      root,
      "services/orders/src/order.ts",
      "export const ORDER = 1;\n",
    ),
    writeRepositoryFile(
      root,
      "services/orders/src/generated/client.ts",
      "export const GENERATED_ORDER = 1;\n",
    ),
    writeRepositoryFile(
      root,
      "services/billing/src/invoice.ts",
      "export const INVOICE = 1;\n",
    ),
    writeRepositoryFile(
      root,
      "services/billing/src/generated/client.ts",
      "export const GENERATED_BILLING = 1;\n",
    ),
    writeRepositoryFile(
      root,
      "packages/shared/common/src/result.ts",
      "export type Result<T> = { value: T };\n",
    ),
    writeRepositoryFile(
      root,
      "packages/shared/common/generated/client.ts",
      "export const GENERATED_COMMON = 1;\n",
    ),
    writeRepositoryFile(
      root,
      "shared/build/README.md",
      "# Shared build\n",
    ),
  ]);
  await slInstall(root, "init", false);
  await writeMonorepoCatalog(root);

  const rootLesson = await slCaptureLesson(root, {
    title: "Repository fallback",
    kind: "win",
    scope: "repository",
    scopeId: SL_MONOREPO_SCOPES.root.id,
    triggers: ["fixture"],
    dryRun: false,
    now: FIXED_NOW,
  });
  const ordersLesson = await slCaptureLesson(root, {
    title: "Orders local behavior",
    kind: "win",
    scope: "orders",
    scopeId: SL_MONOREPO_SCOPES.ordersService.id,
    triggers: ["fixture"],
    dryRun: false,
    now: FIXED_NOW,
  });
  const billingLesson = await slCaptureLesson(root, {
    title: "Billing local behavior",
    kind: "win",
    scope: "billing",
    scopeId: SL_MONOREPO_SCOPES.billingService.id,
    triggers: ["fixture"],
    dryRun: false,
    now: FIXED_NOW,
  });
  const sharedLesson = await slCaptureLesson(root, {
    title: "Common library behavior",
    kind: "win",
    scope: "shared",
    scopeId: SL_MONOREPO_SCOPES.commonLibrary.id,
    triggers: ["fixture"],
    dryRun: false,
    now: FIXED_NOW,
  });
  const inactiveLesson = await slCaptureLesson(root, {
    title: "Inactive orders behavior",
    kind: "pitfall",
    scope: "orders",
    scopeId: SL_MONOREPO_SCOPES.ordersService.id,
    triggers: ["fixture"],
    dryRun: false,
    now: FIXED_NOW,
  });

  await recordVerifiedUse(
    root,
    ordersLesson.id,
    SL_MONOREPO_SCOPES.ordersService,
    "orders-local",
  );
  await recordVerifiedUse(
    root,
    sharedLesson.id,
    SL_MONOREPO_SCOPES.ordersService,
    "orders-shared",
  );
  await recordVerifiedUse(
    root,
    sharedLesson.id,
    SL_MONOREPO_SCOPES.billingService,
    "billing-shared",
  );

  await activatePromotion({
    root,
    sourceId: sharedLesson.id,
    artifactId: "SL-SHARED-TEST-RUNNER",
    targetScopeId: SL_MONOREPO_SCOPES.root.id,
    ownerApprovalRef: "review:platform-owners",
    declarations: [{ key: "tests.runner", value: "vitest" }],
  });
  await activatePromotion({
    root,
    sourceId: ordersLesson.id,
    artifactId: "SL-ORDERS-TEST-RUNNER",
    targetScopeId: SL_MONOREPO_SCOPES.ordersService.id,
    ownerApprovalRef: "review:orders-owners",
    declarations: [
      {
        key: "tests.runner",
        value: "jest",
        override: {
          kind: "narrower-scope",
          overriddenArtifactId: "SL-SHARED-TEST-RUNNER",
          overriddenScopeId: SL_MONOREPO_SCOPES.root.id,
          declarationKey: "tests.runner",
          reason: "Orders retains its existing runner.",
          approvalRef: "review:orders-override",
        },
      },
    ],
  });
  await slForgetArtifact(
    root,
    inactiveLesson.id,
    "irrelevant",
    false,
    new Date(FIXED_NOW.getTime() + 240_000),
  );

  const registry = await slLoadRegistry(root);
  const find = (id: string): SLRegistryArtifact => {
    const artifact = registry.artifacts.find((candidate) => candidate.id === id);
    if (!artifact) {
      throw new Error(`Fixture artifact is missing: ${id}`);
    }
    return artifact;
  };
  return {
    root,
    artifacts: {
      rootLesson: find(rootLesson.id),
      ordersLesson: find(ordersLesson.id),
      billingLesson: find(billingLesson.id),
      sharedLesson: find(sharedLesson.id),
      inactiveLesson: find(inactiveLesson.id),
      rootPromotion: find("SL-SHARED-TEST-RUNNER"),
      ordersPromotion: find("SL-ORDERS-TEST-RUNNER"),
    },
  };
}
