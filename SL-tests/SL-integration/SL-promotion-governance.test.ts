import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { afterEach, describe, expect, test } from "vitest";
import { slCaptureLesson } from "../../SL-src/SL-core/SL-capture.js";
import { SL_DEFAULT_CONFIG } from "../../SL-src/SL-core/SL-constants.js";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import {
  slDefaultPromotionTargetScope,
  slCreatePromotionGovernanceContext,
  slEvaluatePromotionGovernance,
  slEvaluateScopedGuidanceConflicts,
  slPromotionGovernanceRecordIsCurrent,
  type SLPromotionGovernanceContext,
  type SLPromotionGovernanceInput,
  type SLScopedGuidance,
} from "../../SL-src/SL-core/SL-promotion-governance.js";
import { slBuildPromotionGovernanceContext } from "../../SL-src/SL-core/SL-promotion-context.js";
import {
  slActivatePromotion,
  slEvaluatePromotionReadiness,
  slRegisterPromotion,
} from "../../SL-src/SL-core/SL-promotion.js";
import {
  slPromotionArtifactContentHash,
  slPromotionArtifactVersion,
} from "../../SL-src/SL-core/SL-promotion-lifecycle.js";
import { slLoadRegistry } from "../../SL-src/SL-core/SL-registry.js";
import {
  slLoadScopeCatalog,
  slPromotionScopeRef,
  slScopeDescriptor,
} from "../../SL-src/SL-core/SL-scope.js";
import type {
  SLPromotionPolicy,
  SLPromotionScopeRef,
} from "../../SL-src/SL-core/SL-types.js";
import {
  slFinishUsage,
  slStartUsage,
} from "../../SL-src/SL-core/SL-usage.js";
import { slValidateRepository } from "../../SL-src/SL-validation/SL-validation.js";
import {
  slCreateTestRepository,
  slRemoveTestRepository,
} from "../SL-fixtures/SL-test-repository.js";
import {
  slCreateTestContract,
  slTestContractPath,
  slWriteTestJson,
  slWriteTestPromotedArtifact,
} from "../SL-fixtures/SL-validation-contract.js";

const repositories: string[] = [];
const FIXED_NOW = new Date("2026-09-04T08:00:00.000Z");
const SOURCE_VERSION = `sha256:${"a".repeat(64)}`;
const INTEGRATION_SCOPE_ID = "SL-SCOPE-SERVICE-A";

const ROOT_SCOPE: SLPromotionScopeRef = {
  id: "repo:root",
  kind: "repository",
  root: true,
  precedence: 0,
  ancestorScopeIds: [],
  ownerSetId: "owners:root",
};

const SERVICE_A_SCOPE: SLPromotionScopeRef = {
  id: "service:a",
  kind: "service",
  root: false,
  precedence: 1,
  ancestorScopeIds: [ROOT_SCOPE.id],
  ownerSetId: "owners:service-a",
};

const SERVICE_B_SCOPE: SLPromotionScopeRef = {
  id: "service:b",
  kind: "service",
  root: false,
  precedence: 1,
  ancestorScopeIds: [ROOT_SCOPE.id],
  ownerSetId: "owners:service-b",
};

function slMonorepoPolicy(): SLPromotionPolicy {
  return {
    ...structuredClone(SL_DEFAULT_CONFIG.promotion),
    mode: "monorepo",
  };
}

function slBaseInput(
  targetScope: SLPromotionScopeRef = SERVICE_A_SCOPE,
): SLPromotionGovernanceInput {
  return {
    policy: slMonorepoPolicy(),
    targetScope,
    sourceScopes: [
      {
        artifactId: "SL-SOURCE",
        artifactVersion: SOURCE_VERSION,
        scope: SERVICE_A_SCOPE,
      },
    ],
    artifactScope: {
      artifactId: "SL-PROMOTED",
      scope: targetScope,
    },
    evidence: [
      {
        sourceArtifactId: "SL-SOURCE",
        artifactVersion: SOURCE_VERSION,
        applicationScope: SERVICE_A_SCOPE,
        outcome: "verified-success",
        evidenceRef: "run:service-a-success",
      },
    ],
    approvals: [
      {
        kind: "owner-set-approval",
        scopeId: targetScope.id,
        ownerSetId: targetScope.ownerSetId,
        evidenceRef: "review:target-owner",
      },
    ],
  };
}

function slGuidance(options: {
  artifactId: string;
  scope: SLPromotionScopeRef;
  value: string;
  override?: NonNullable<
    SLScopedGuidance["declarations"][number]["override"]
  >;
}): SLScopedGuidance {
  return {
    artifactId: options.artifactId,
    scope: options.scope,
    applicability: {
      kind: "paths",
      paths: ["SL-src/**/*.ts"],
    },
    declarations: [
      {
        key: "tests.runner",
        value: options.value,
        ...(options.override ? { override: options.override } : {}),
      },
    ],
  };
}

async function slPrepareGovernedPromotion(): Promise<{
  root: string;
  artifactId: string;
  sourceId: string;
  sourceVersion: string;
  configPath: string;
  governance: SLPromotionGovernanceContext;
}> {
  const root = await slCreateTestRepository();
  repositories.push(root);
  await slInstall(root, "init", false);
  const configPath = join(
    root,
    ".github",
    "sl-learning",
    "sl-config.yml",
  );
  const config = parse(await readFile(configPath, "utf8"));
  config.promotion.mode = "monorepo";
  await writeFile(configPath, stringify(config), "utf8");
  await writeFile(
    join(root, ".github", "sl-learning", "sl-scope-catalog.yml"),
    stringify({
      schemaVersion: 1,
      scopes: [
        {
          id: "SL-SCOPE-ROOT",
          displayName: "Repository",
          kind: "repository",
          includePaths: ["**"],
          excludePaths: [],
          dependencyScopeIds: [],
          ownerAliases: ["@example/platform"],
        },
        {
          id: INTEGRATION_SCOPE_ID,
          displayName: "Service A",
          kind: "service",
          includePaths: ["services/a/**"],
          excludePaths: [],
          parentScopeId: "SL-SCOPE-ROOT",
          dependencyScopeIds: [],
          ownerAliases: ["@example/service-a"],
        },
      ],
    }),
    "utf8",
  );
  const catalog = await slLoadScopeCatalog(root);

  const source = await slCaptureLesson(root, {
    title: "Scoped integration source",
    kind: "win",
    scope: SERVICE_A_SCOPE.id,
    scopeId: INTEGRATION_SCOPE_ID,
    triggers: ["scoped-governance"],
    dryRun: false,
    now: FIXED_NOW,
  });
  const sourceContent = await readFile(
    join(root, ...source.path.split("/")),
    "utf8",
  );
  const sourceVersion = slPromotionArtifactVersion(
    slPromotionArtifactContentHash(sourceContent),
  );
  const usage = await slStartUsage(root, source.id, {
    applicationId: "scoped-integration-application",
    taskRunId: "scoped-integration-task",
    idempotencyKey: "scoped-integration-start",
    scope: slScopeDescriptor(
      catalog.scopes.find(
        (scope) => scope.id === INTEGRATION_SCOPE_ID,
      )!,
    ),
    now: new Date("2026-09-04T08:10:00.000Z"),
  });
  await slFinishUsage(root, usage.receiptId, {
    outcome: "success",
    verified: true,
    verifierType: "test-suite",
    evidenceRef: "run:scoped-integration",
    idempotencyKey: "scoped-integration-finish",
    now: new Date("2026-09-04T08:20:00.000Z"),
  });
  const artifactId = "SL-SCOPED-INTEGRATION";
  const artifactPath =
    `.github/instructions/${artifactId.toLowerCase()}.instructions.md`;
  const contractPath = slTestContractPath(artifactId);
  await slWriteTestPromotedArtifact({
    root,
    artifactId,
    artifactType: "instruction",
    artifactPath,
    contractPath,
  });
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
  await slRegisterPromotion(
    root,
    source.id,
    artifactPath,
    false,
    FIXED_NOW,
    { targetScopeId: INTEGRATION_SCOPE_ID },
  );
  const governance = await slBuildPromotionGovernanceContext(
    root,
    artifactId,
    {
      targetScopeId: INTEGRATION_SCOPE_ID,
      ownerApprovalRefs: ["review:scoped-integration"],
    },
  );
  await slEvaluatePromotionReadiness(root, artifactId, {
    governance,
    now: new Date("2026-09-04T09:00:00.000Z"),
  });
  return {
    root,
    artifactId,
    sourceId: source.id,
    sourceVersion,
    configPath,
    governance,
  };
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(slRemoveTestRepository));
});

describe("SL monorepo promotion governance", () => {
  test("defaults promotion target to the source scope", () => {
    expect(slDefaultPromotionTargetScope(SERVICE_A_SCOPE)).toEqual(
      SERVICE_A_SCOPE,
    );
    const base = slBaseInput();
    const context = slCreatePromotionGovernanceContext({
      artifactId: base.artifactScope.artifactId,
      sourceScopes: base.sourceScopes,
      evidence: base.evidence,
      approvals: base.approvals,
    });
    expect(context.targetScope).toEqual(SERVICE_A_SCOPE);
  });

  test("requires direct local evidence from the source artifact", () => {
    const input = slBaseInput();
    input.evidence = [
      {
        sourceArtifactId: "SL-DEPENDENCY",
        artifactVersion: SOURCE_VERSION,
        applicationScope: SERVICE_A_SCOPE,
        outcome: "verified-success",
        evidenceRef: "run:dependency-success",
      },
    ];

    const dependencyOnly = slEvaluatePromotionGovernance(input);
    expect(dependencyOnly.evidencePassed).toBe(false);

    input.evidence.push({
      sourceArtifactId: "SL-SOURCE",
      artifactVersion: SOURCE_VERSION,
      applicationScope: SERVICE_A_SCOPE,
      outcome: "verified-success",
      evidenceRef: "run:direct-success",
    });
    const direct = slEvaluatePromotionGovernance(input);
    expect(direct.record.status).toBe("passed");
    expect(direct.record.targetScope.id).toBe(SERVICE_A_SCOPE.id);
  });

  test("does not count duplicate evidence references toward local gates", () => {
    const input = slBaseInput();
    input.policy.local.minimumVerifiedSuccesses = 2;
    input.evidence = [
      input.evidence[0]!,
      structuredClone(input.evidence[0]!),
    ];

    const evaluation = slEvaluatePromotionGovernance(input);

    expect(evaluation.evidencePassed).toBe(false);
    expect(evaluation.record.evidenceSummary).toEqual([
      expect.objectContaining({
        verifiedSuccessCount: 1,
        evidenceRefs: ["run:service-a-success"],
      }),
    ]);
  });

  test("rejects repeated shared evidence from only one non-root scope", () => {
    const input = slBaseInput(ROOT_SCOPE);
    input.evidence = [1, 2, 3].map((index) => ({
      sourceArtifactId: "SL-SOURCE",
      artifactVersion: SOURCE_VERSION,
      applicationScope: SERVICE_A_SCOPE,
      outcome: "verified-success" as const,
      evidenceRef: `run:service-a-${index}`,
    }));

    const evaluation = slEvaluatePromotionGovernance(input);

    expect(evaluation.evidencePassed).toBe(false);
    expect(evaluation.record.reasons[0]).toBe(
      "Shared promotion requires 2 distinct non-root scopes with at least 1 verified successful application(s) each; found 1.",
    );
  });

  test("accepts shared promotion with verified applications in two scopes", () => {
    const input = slBaseInput(ROOT_SCOPE);
    input.evidence.push({
      sourceArtifactId: "SL-SOURCE",
      artifactVersion: SOURCE_VERSION,
      applicationScope: SERVICE_B_SCOPE,
      outcome: "verified-success",
      evidenceRef: "run:service-b-success",
    });

    const evaluation = slEvaluatePromotionGovernance(input);

    expect(evaluation.record.status).toBe("passed");
    expect(evaluation.record.evidenceSummary).toEqual([
      expect.objectContaining({
        scopeId: SERVICE_A_SCOPE.id,
        artifactVersion: SOURCE_VERSION,
        verifiedSuccessCount: 1,
      }),
      expect.objectContaining({
        scopeId: SERVICE_B_SCOPE.id,
        artifactVersion: SOURCE_VERSION,
        verifiedSuccessCount: 1,
      }),
    ]);
  });

  test("requires approval from the exact target owner set", () => {
    const input = slBaseInput();
    input.approvals = [
      {
        kind: "owner-set-approval",
        scopeId: SERVICE_A_SCOPE.id,
        ownerSetId: SERVICE_B_SCOPE.ownerSetId,
        evidenceRef: "review:wrong-owner",
      },
    ];

    const rejected = slEvaluatePromotionGovernance(input);
    expect(rejected.approvalPassed).toBe(false);
    expect(rejected.record.ownerApprovals).toEqual([]);

    input.approvals = [
      {
        kind: "owner-set-approval",
        scopeId: SERVICE_A_SCOPE.id,
        ownerSetId: SERVICE_A_SCOPE.ownerSetId,
        evidenceRef: "review:service-a-owner",
      },
    ];
    expect(slEvaluatePromotionGovernance(input).approvalPassed).toBe(true);
  });

  test("allows an audited narrower-scope override", () => {
    const policy = slMonorepoPolicy();
    const broader = slGuidance({
      artifactId: "SL-SHARED",
      scope: ROOT_SCOPE,
      value: "vitest",
    });
    const narrower = slGuidance({
      artifactId: "SL-SERVICE-A",
      scope: SERVICE_A_SCOPE,
      value: "jest",
      override: {
        kind: "narrower-scope",
        overriddenArtifactId: broader.artifactId,
        overriddenScopeId: ROOT_SCOPE.id,
        declarationKey: "tests.runner",
        reason: "Service A requires its existing runner.",
        approvalRef: "review:service-a-override",
      },
    });

    const explicit = slEvaluateScopedGuidanceConflicts(policy, [
      broader,
      narrower,
    ]);
    expect(explicit).toMatchObject({
      status: "passed",
      resolutions: [
        {
          status: "explicit-override",
          declarationKey: "tests.runner",
          narrowerArtifactId: "SL-SERVICE-A",
          broaderArtifactId: "SL-SHARED",
        },
      ],
    });
  });

  test("blocks an undeclared narrower-scope contradiction", () => {
    const policy = slMonorepoPolicy();
    const broader = slGuidance({
      artifactId: "SL-SHARED",
      scope: ROOT_SCOPE,
      value: "vitest",
    });
    const narrower = slGuidance({
      artifactId: "SL-SERVICE-A",
      scope: SERVICE_A_SCOPE,
      value: "jest",
    });
    const undeclared = structuredClone(narrower);
    expect(
      slEvaluateScopedGuidanceConflicts(policy, [broader, undeclared]).status,
    ).toBe("failed");
  });

  test("blocks same-precedence contradictory declarations", () => {
    const policy = slMonorepoPolicy();
    const narrower = slGuidance({
      artifactId: "SL-SERVICE-A",
      scope: SERVICE_A_SCOPE,
      value: "jest",
    });
    const samePrecedence = slGuidance({
      artifactId: "SL-SERVICE-B",
      scope: SERVICE_B_SCOPE,
      value: "mocha",
      override: {
        kind: "narrower-scope",
        overriddenArtifactId: narrower.artifactId,
        overriddenScopeId: SERVICE_A_SCOPE.id,
        declarationKey: "tests.runner",
        reason: "Invalid peer override.",
        approvalRef: "review:peer-override",
      },
    });
    expect(
      slEvaluateScopedGuidanceConflicts(policy, [
        narrower,
        samePrecedence,
      ]).status,
    ).toBe("failed");
  });

  test("invalidates a gate record when policy changes", () => {
    const input = slBaseInput();
    const record = slEvaluatePromotionGovernance(input).record;

    expect(slPromotionGovernanceRecordIsCurrent(record, input)).toBe(true);

    const changedPolicy = structuredClone(input);
    changedPolicy.policy.policyVersion = "2";
    expect(
      slPromotionGovernanceRecordIsCurrent(record, changedPolicy),
    ).toBe(false);
  });

  test("invalidates a gate record when evidence changes", () => {
    const input = slBaseInput();
    const record = slEvaluatePromotionGovernance(input).record;
    const changedEvidence = structuredClone(input);
    changedEvidence.evidence[0]!.evidenceRef = "run:replacement-success";
    expect(
      slPromotionGovernanceRecordIsCurrent(record, changedEvidence),
    ).toBe(false);
  });

  test("preserves repository approval behavior without synthetic scopes", () => {
    const input = slBaseInput(ROOT_SCOPE);
    input.policy.mode = "single-repository";
    input.sourceScopes[0]!.scope = ROOT_SCOPE;
    input.evidence = [];
    input.approvals = [
      {
        kind: "repository-review",
        evidenceRef: "review:repository-root",
      },
    ];

    const evaluation = slEvaluatePromotionGovernance(input);

    expect(evaluation.record.status).toBe("passed");
    expect(evaluation.evidencePassed).toBe(true);
    expect(evaluation.record.repositoryApproval).toEqual({
      kind: "repository-review",
      evidenceRef: "review:repository-root",
    });
  });

  test("persists an auditable scoped promotion gate record", async () => {
    const prepared = await slPrepareGovernedPromotion();
    const registry = await slLoadRegistry(prepared.root);
    const evaluation = registry.artifacts.find(
      (artifact) => artifact.id === prepared.artifactId,
    )?.promotionEvaluation;

    expect(evaluation?.status).toBe("passed");
    expect(evaluation?.governance).toMatchObject({
      targetScope: { id: INTEGRATION_SCOPE_ID },
      sourceScopes: [
        {
          artifactId: prepared.sourceId,
          artifactVersion: prepared.sourceVersion,
          scope: { id: INTEGRATION_SCOPE_ID },
        },
      ],
      ownerApprovals: [
        {
          evidenceRef: "review:scoped-integration",
        },
      ],
    });
    expect(await slValidateRepository(prepared.root)).toEqual([]);
  });

  test("rejects a requested governance target that differs from persisted artifact scope", async () => {
    const prepared = await slPrepareGovernedPromotion();

    await expect(
      slBuildPromotionGovernanceContext(
        prepared.root,
        prepared.artifactId,
        { targetScopeId: "SL-SCOPE-ROOT" },
      ),
    ).rejects.toThrow(
      `Promotion target scope SL-SCOPE-ROOT does not match persisted artifact scope ${INTEGRATION_SCOPE_ID}.`,
    );
  });

  test("rejects evaluation governance that differs from persisted artifact scope", async () => {
    const prepared = await slPrepareGovernedPromotion();
    const rootScope = slPromotionScopeRef(
      await slLoadScopeCatalog(prepared.root),
      "SL-SCOPE-ROOT",
    );
    const mismatched = structuredClone(prepared.governance);
    mismatched.targetScope = rootScope;
    mismatched.artifactScope.scope = rootScope;

    await expect(
      slEvaluatePromotionReadiness(
        prepared.root,
        prepared.artifactId,
        {
          governance: mismatched,
          now: new Date("2026-09-04T09:30:00.000Z"),
        },
      ),
    ).rejects.toThrow(
      `Promotion target scope SL-SCOPE-ROOT does not match persisted artifact scope ${INTEGRATION_SCOPE_ID}.`,
    );
  });

  test("rejects activation governance that differs from persisted artifact scope", async () => {
    const prepared = await slPrepareGovernedPromotion();
    const rootScope = slPromotionScopeRef(
      await slLoadScopeCatalog(prepared.root),
      "SL-SCOPE-ROOT",
    );
    const mismatched = structuredClone(prepared.governance);
    mismatched.targetScope = rootScope;
    mismatched.artifactScope.scope = rootScope;

    await expect(
      slActivatePromotion(
        prepared.root,
        prepared.artifactId,
        false,
        new Date("2026-09-04T10:00:00.000Z"),
        { governance: mismatched },
      ),
    ).rejects.toThrow(
      `Promotion target scope SL-SCOPE-ROOT does not match persisted artifact scope ${INTEGRATION_SCOPE_ID}.`,
    );
    expect(
      (await slLoadRegistry(prepared.root)).artifacts.find(
        (artifact) => artifact.id === prepared.artifactId,
      ),
    ).toMatchObject({
      status: "probation",
      scope: { id: INTEGRATION_SCOPE_ID, path: "services/a" },
    });
  });

  test("invalidates activation after promotion policy changes", async () => {
    const prepared = await slPrepareGovernedPromotion();
    const config = parse(await readFile(prepared.configPath, "utf8"));
    config.promotion.policyVersion = "2";
    await writeFile(prepared.configPath, stringify(config), "utf8");
    await expect(
      slActivatePromotion(
        prepared.root,
        prepared.artifactId,
        false,
        new Date("2026-09-04T10:00:00.000Z"),
        { governance: prepared.governance },
      ),
    ).rejects.toThrow(
      `Artifact ${prepared.artifactId} governance inputs changed and it remains in probation.`,
    );
    const registry = await slLoadRegistry(prepared.root);
    expect(
      registry.artifacts.find(
        (artifact) => artifact.id === prepared.artifactId,
      )
        ?.promotionEvaluation?.gates,
    ).toContainEqual({
      id: "policy-current",
      status: "failed",
      message:
        "Promotion policy, scope, evidence, approvals, or active scoped guidance changed after evaluation.",
    });
  });
});
