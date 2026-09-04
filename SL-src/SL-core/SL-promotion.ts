import { basename, resolve } from "node:path";
import {
  SL_ACTIVE_STATUSES,
  SL_PATHS,
  SL_SECRET_PATTERNS,
  SL_USER_PATH_PATTERN,
} from "./SL-constants.js";
import { slLoadConfig } from "./SL-config.js";
import { slParseMarkdown, slStringifyMarkdown } from "./SL-frontmatter.js";
import { slWithRepositoryMutationLock } from "./SL-mutation-lock.js";
import {
  slEvaluatePromotionGovernance,
  type SLPromotionGovernanceContext,
  type SLPromotionGovernanceInput,
  type SLScopedGuidance,
} from "./SL-promotion-governance.js";
import {
  slPromotionEvaluationIsCurrent,
  slPromotionArtifactContentHash,
  slPromotionArtifactVersion,
} from "./SL-promotion-lifecycle.js";
import {
  slAppendEvents,
  slAssertEventPathSafe,
  slFindArtifact,
  slLoadRegistry,
  slSaveRegistry,
  slUpsertArtifact,
} from "./SL-registry.js";
import type {
  SLChange,
  SLEvent,
  SLPromotionApprovalEvidence,
  SLPromotionEvaluation,
  SLPromotionGateResult,
  SLRegistry,
  SLRegistryArtifact,
} from "./SL-types.js";
import { SL_DEFAULT_SCOPE, slNormalizeScope } from "./SL-state.js";
import { slResolveScopeDescriptor } from "./SL-scope.js";
import { slArtifactContentHash } from "./SL-usage.js";
import {
  slAssertRealPathInside,
  slCanonicalJson,
  slExists,
  slMove,
  slNormalizePath,
  slReadContainedText,
  slResolveInside,
  slWriteText,
} from "./SL-utils.js";
import { slWriteIndex } from "../SL-index/SL-index.js";
import {
  slEvaluateValidationContract,
  slFindValidationContractConflicts,
  slPromotedContractTarget,
  type SLActiveValidationContract,
  type SLEvaluationCheckResult,
  type SLPromotedArtifactType,
} from "../SL-validation/SL-validation-contract.js";

const SL_APPROVAL_REF_PATTERN =
  /^(?:[A-Za-z][A-Za-z0-9+.-]*:[^\s@\\]{1,240}|[A-Za-z0-9][A-Za-z0-9._/#:-]{0,255})$/;
const SL_IP_ADDRESS_PATTERN =
  /(?:^|[^0-9])(?:\d{1,3}\.){3}\d{1,3}(?:$|[^0-9])|(?:^|[^A-F0-9])(?:[A-F0-9]{0,4}:){2,7}[A-F0-9]{0,4}(?:$|[^A-F0-9])/i;
const slDryRunPromotionEvaluations = new Map<string, SLPromotionEvaluation>();

export interface SLEvaluatePromotionReadinessOptions {
  approval?: SLPromotionApprovalEvidence;
  governance?: SLPromotionGovernanceContext;
  executeCommands?: boolean;
  dryRun?: boolean;
  now?: Date;
}

export interface SLPromotionReadinessResult {
  evaluation: SLPromotionEvaluation;
  changes: SLChange[];
}

interface SLBuildPromotionEvaluationOptions
  extends SLEvaluatePromotionReadinessOptions {
  executableFallback?: SLPromotionEvaluation;
}

export interface SLActivatePromotionOptions {
  governance?: SLPromotionGovernanceContext;
}

export interface SLRegisterPromotionOptions {
  targetScopeId?: string;
}

function slDryRunEvaluationKey(root: string, artifactId: string): string {
  return `${resolve(root)}\0${artifactId}`;
}

function slPromotionType(path: string): SLPromotedArtifactType {
  if (path.startsWith(".github/instructions/") && path.endsWith(".instructions.md")) {
    return "instruction";
  }
  if (path.startsWith(".github/skills/") && path.endsWith("/SKILL.md")) {
    return "skill";
  }
  throw new Error(
    "Promoted path must be .github/instructions/SL-*.instructions.md or .github/skills/SL-*/SKILL.md.",
  );
}

function slProbationPath(
  artifactId: string,
  artifactType: SLPromotedArtifactType,
  targetPath: string,
): string {
  return artifactType === "instruction"
    ? `${SL_PATHS.probation}/${artifactId}/${basename(targetPath)}`
    : `${SL_PATHS.probation}/${artifactId}/SKILL.md`;
}

function slGate(
  id: SLPromotionGateResult["id"],
  passed: boolean,
  passedMessage: string,
  failedMessage: string,
): SLPromotionGateResult {
  return {
    id,
    status: passed ? "passed" : "failed",
    message: passed ? passedMessage : failedMessage,
  };
}

function slChecksPassed(
  checks: SLEvaluationCheckResult[],
  predicate: (check: SLEvaluationCheckResult) => boolean,
): boolean {
  return checks.filter(predicate).every((check) => check.status === "passed");
}

function slApprovalValid(
  approval: SLPromotionApprovalEvidence | undefined,
): boolean {
  if (
    !approval ||
    approval.kind !== "repository-review" ||
    !SL_APPROVAL_REF_PATTERN.test(approval.evidenceRef) ||
    SL_USER_PATH_PATTERN.test(approval.evidenceRef) ||
    SL_IP_ADDRESS_PATTERN.test(approval.evidenceRef)
  ) {
    return false;
  }
  return !SL_SECRET_PATTERNS.some(({ pattern }) => {
    pattern.lastIndex = 0;
    return pattern.test(approval.evidenceRef);
  });
}

async function slCurrentSourceScopes(
  root: string,
  registry: SLRegistry,
  artifact: SLRegistryArtifact,
  governance: SLPromotionGovernanceContext,
): Promise<SLPromotionGovernanceContext["sourceScopes"]> {
  const expectedSourceIds = [...(artifact.dependsOn ?? [])].sort();
  const suppliedSourceIds = governance.sourceScopes
    .map((source) => source.artifactId)
    .sort();
  if (
    expectedSourceIds.length !== suppliedSourceIds.length ||
    expectedSourceIds.some(
      (sourceId, index) => sourceId !== suppliedSourceIds[index],
    )
  ) {
    throw new Error(
      "Promotion governance source scopes must exactly match direct promotion evidence.",
    );
  }
  const current = [];
  for (const sourceScope of governance.sourceScopes) {
    const source = registry.artifacts.find(
      (candidate) => candidate.id === sourceScope.artifactId,
    );
    if (!source?.path) {
      current.push(sourceScope);
      continue;
    }
    try {
      const contentHash = slPromotionArtifactContentHash(
        await slReadContainedText(root, source.path),
      );
      current.push({
        ...sourceScope,
        artifactVersion: slPromotionArtifactVersion(contentHash),
      });
    } catch {
      current.push(sourceScope);
    }
  }
  return current;
}

function slGovernedActiveGuidance(
  registry: SLRegistry,
  activeContracts: SLActiveValidationContract[],
): {
  governed: SLScopedGuidance[];
  legacy: SLActiveValidationContract[];
} {
  const governed: SLScopedGuidance[] = [];
  const legacy: SLActiveValidationContract[] = [];
  for (const active of activeContracts) {
    const artifact = registry.artifacts.find(
      (candidate) => candidate.id === active.artifactId,
    );
    const scope = artifact?.promotionEvaluation?.governance?.targetScope;
    if (!scope) {
      legacy.push(active);
      continue;
    }
    governed.push({
      artifactId: active.artifactId,
      scope,
      applicability: active.contract.scope,
      declarations: active.contract.declarations ?? [],
    });
  }
  return { governed, legacy };
}

async function slBuildGovernanceInput(
  root: string,
  registry: SLRegistry,
  artifact: SLRegistryArtifact,
  contract: NonNullable<
    Awaited<ReturnType<typeof slEvaluateValidationContract>>["contract"]
  >,
  context: SLPromotionGovernanceContext,
  activeContracts: SLActiveValidationContract[],
): Promise<{
  input: SLPromotionGovernanceInput;
  legacyConflictsPassed: boolean;
}> {
  const config = await slLoadConfig(root);
  if (config.promotion.mode !== "monorepo") {
    throw new Error(
      "Scoped promotion governance requires promotion.mode: monorepo.",
    );
  }
  if (context.artifactScope.artifactId !== artifact.id) {
    throw new Error(
      "Promotion artifact scope must identify the probationary artifact.",
    );
  }
  const sourceScopes = await slCurrentSourceScopes(
    root,
    registry,
    artifact,
    context,
  );
  const active = slGovernedActiveGuidance(registry, activeContracts);
  const candidate: SLScopedGuidance = {
    artifactId: artifact.id,
    scope: context.targetScope,
    applicability: contract.scope,
    declarations: contract.declarations ?? [],
  };
  const callerGuidance = context.activeGuidance ?? [];
  const combined = new Map<string, SLScopedGuidance>();
  for (const guidance of [
    ...active.governed,
    ...callerGuidance,
    candidate,
  ]) {
    const existing = combined.get(guidance.artifactId);
    if (
      existing &&
      slArtifactContentHash(slCanonicalJson(existing)) !==
        slArtifactContentHash(slCanonicalJson(guidance))
    ) {
      throw new Error(
        `Scoped guidance ${guidance.artifactId} has contradictory active definitions.`,
      );
    }
    combined.set(guidance.artifactId, guidance);
  }
  const legacyConflictsPassed =
    slFindValidationContractConflicts([
      ...active.legacy,
      { artifactId: artifact.id, contract },
    ]).length === 0;
  return {
    input: {
      policy: config.promotion,
      ...context,
      sourceScopes,
      activeGuidance: [...combined.values()],
    },
    legacyConflictsPassed,
  };
}

async function slArtifactSourcesValid(
  root: string,
  registry: SLRegistry,
  artifact: SLRegistryArtifact,
): Promise<boolean> {
  const sourceIds = artifact.dependsOn ?? [];
  if (sourceIds.length === 0) {
    return false;
  }
  for (const sourceId of sourceIds) {
    const source = registry.artifacts.find(
      (candidate) => candidate.id === sourceId,
    );
    if (
      !source ||
      source.classification !== "evidence" ||
      !source.path ||
      !SL_ACTIVE_STATUSES.has(source.status)
    ) {
      return false;
    }
    const sourcePath = slResolveInside(root, source.path);
    if (!(await slExists(sourcePath))) {
      return false;
    }
    try {
      await slAssertRealPathInside(root, source.path);
    } catch {
      return false;
    }
  }
  return true;
}

async function slLoadActiveContracts(
  root: string,
  registry: SLRegistry,
  candidateId: string,
): Promise<{
  contracts: SLActiveValidationContract[];
  valid: boolean;
}> {
  const contracts: SLActiveValidationContract[] = [];
  for (const artifact of registry.artifacts) {
    if (
      artifact.id === candidateId ||
      artifact.classification !== "promoted" ||
      !["active", "promoted"].includes(artifact.status) ||
      !artifact.path
    ) {
      continue;
    }
    if (
      artifact.status === "active" &&
      !(await slPromotionEvaluationIsCurrent(root, artifact))
    ) {
      return { contracts, valid: false };
    }
    let frontmatter: Record<string, unknown>;
    try {
      frontmatter = slParseMarkdown<Record<string, unknown>>(
        await slReadContainedText(root, artifact.path),
      ).frontmatter;
    } catch {
      return { contracts, valid: false };
    }
    const target = slPromotedContractTarget(artifact, frontmatter);
    if (!target) {
      if (
        artifact.status === "promoted" &&
        typeof frontmatter.validationContract !== "string"
      ) {
        continue;
      }
      return { contracts, valid: false };
    }
    const evaluation = await slEvaluateValidationContract(root, target);
    if (evaluation.status === "failed" || !evaluation.contract) {
      return { contracts, valid: false };
    }
    contracts.push({
      artifactId: artifact.id,
      contract: evaluation.contract,
    });
  }
  return { contracts, valid: true };
}

async function slContractContentHash(
  root: string,
  contractPath: string | null,
): Promise<string | null> {
  if (!contractPath) {
    return null;
  }
  try {
    const absolutePath = slResolveInside(root, contractPath);
    if (!(await slExists(absolutePath))) {
      return null;
    }
    return slArtifactContentHash(
      await slReadContainedText(root, contractPath),
    );
  } catch {
    return null;
  }
}

async function slPersistEvaluation(
  root: string,
  registry: SLRegistry,
  artifact: SLRegistryArtifact,
  evaluation: SLPromotionEvaluation,
  dryRun: boolean,
  changes: SLChange[],
  action: "promotion-evaluated" | "promotion-invalidated",
): Promise<void> {
  artifact.promotionEvaluation = evaluation;
  await slSaveRegistry(root, registry, dryRun, changes);
  await slWriteIndex(root, registry, dryRun, changes);
  const event: SLEvent = {
    schemaVersion: 1,
    timestamp: evaluation.evaluatedAt,
    artifactId: artifact.id,
    action,
    fromStatus: "probation",
    toStatus: "probation",
    fromPath: artifact.path,
    toPath: artifact.path,
    reason:
      evaluation.status === "passed"
        ? "Promotion activation gates passed."
        : "Promotion activation gates failed.",
  };
  await slAppendEvents(root, [event], dryRun);
}

export async function slRegisterPromotion(
  root: string,
  sourceId: string,
  promotedPathValue: string,
  dryRun: boolean,
  now = new Date(),
  options: SLRegisterPromotionOptions = {},
): Promise<SLChange[]> {
  return slWithRepositoryMutationLock(root, () =>
    slRegisterPromotionUnlocked(
      root,
      sourceId,
      promotedPathValue,
      dryRun,
      now,
      options,
    ),
    { dryRun },
  );
}

async function slRegisterPromotionUnlocked(
  root: string,
  sourceId: string,
  promotedPathValue: string,
  dryRun: boolean,
  now: Date,
  options: SLRegisterPromotionOptions,
): Promise<SLChange[]> {
  const promotedPath = slNormalizePath(promotedPathValue);
  await slAssertEventPathSafe(root);
  const artifactType = slPromotionType(promotedPath);
  const registry = await slLoadRegistry(root);
  const registeredTarget = registry.artifacts.find(
    (artifact) => artifact.promotionTargetPath === promotedPath,
  );
  if (
    registeredTarget &&
    (
      registeredTarget.dependsOn?.length !== 1 ||
      registeredTarget.dependsOn[0] !== sourceId
    )
  ) {
    throw new Error(
      `Promoted artifact ${registeredTarget.id} is already bound to different source evidence.`,
    );
  }
  const absolutePath = slResolveInside(root, promotedPath);
  if (!(await slExists(absolutePath))) {
    throw new Error(`Promoted artifact does not exist: ${promotedPath}`);
  }
  if (
    artifactType === "instruction" &&
    !promotedPath.split("/").at(-1)?.startsWith("SL-")
  ) {
    throw new Error("Promoted instruction filename must start with SL-.");
  }
  if (
    artifactType === "skill" &&
    !promotedPath.split("/").at(-2)?.startsWith("SL-")
  ) {
    throw new Error("Promoted skill directory must start with SL-.");
  }

  const source = slFindArtifact(registry, sourceId);
  if (source.classification !== "evidence") {
    throw new Error("Only lesson evidence can be promoted.");
  }
  const promotedScope = options.targetScopeId
    ? (
        await slResolveScopeDescriptor(root, {
          scopeId: options.targetScopeId,
        })
      ).scope
    : slNormalizeScope(source.scope ?? SL_DEFAULT_SCOPE);

  const content = await slReadContainedText(root, promotedPath);
  const markdown = slParseMarkdown<Record<string, unknown>>(content);
  const promotedId =
    typeof markdown.frontmatter.id === "string"
      ? markdown.frontmatter.id
      : `SL-PROMOTED-${sourceId.replace(/^SL-/, "")}`;
  if (promotedId === sourceId) {
    throw new Error("Promoted artifact ID must differ from its source lesson ID.");
  }
  const probationPath = slProbationPath(
    promotedId,
    artifactType,
    promotedPath,
  );
  const existingIdOwner = registry.artifacts.find(
    (artifact) => artifact.id === promotedId,
  );
  if (existingIdOwner && existingIdOwner.classification !== "promoted") {
    throw new Error(
      `Promoted artifact ID ${promotedId} is owned by a non-promoted artifact.`,
    );
  }
  if (existingIdOwner && existingIdOwner.path !== probationPath) {
    throw new Error(
      `Promoted artifact ID ${promotedId} is already owned by ${existingIdOwner.path ?? "a deleted artifact"}.`,
    );
  }
  if (
    existingIdOwner &&
    (
      existingIdOwner.dependsOn?.length !== 1 ||
      existingIdOwner.dependsOn[0] !== sourceId
    )
  ) {
    throw new Error(
      `Promoted artifact ${promotedId} is already bound to different source evidence.`,
    );
  }
  const existingPathOwner = registry.artifacts.find(
    (artifact) =>
      artifact.path === promotedPath ||
      artifact.promotionTargetPath === promotedPath,
  );
  if (existingPathOwner && existingPathOwner.id !== promotedId) {
    throw new Error(
      `Promoted path ${promotedPath} is already owned by ${existingPathOwner.id}.`,
    );
  }
  if (existingPathOwner && existingPathOwner.classification !== "promoted") {
    throw new Error(
      `Promoted path ${promotedPath} is owned by a non-promoted artifact.`,
    );
  }
  if (await slExists(slResolveInside(root, probationPath))) {
    throw new Error(`Promotion probation path already exists: ${probationPath}`);
  }

  markdown.frontmatter.id = promotedId;
  markdown.frontmatter.schemaVersion = 1;
  markdown.frontmatter.managedBy = "SL-Repo";
  markdown.frontmatter.status = "probation";
  markdown.frontmatter.pinned = false;
  markdown.frontmatter.sourceIds = [sourceId];
  if (typeof markdown.frontmatter.validationContract !== "string") {
    throw new Error(
      "Promoted artifact frontmatter must reference a validationContract.",
    );
  }
  const evaluation = await slEvaluateValidationContract(root, {
    artifactId: promotedId,
    artifactPath: promotedPath,
    contentPath: promotedPath,
    artifactType,
    sourceIds: [sourceId],
    contractPath: markdown.frontmatter.validationContract,
    frontmatter: markdown.frontmatter,
    expectedStatus: "probation",
  });
  if (evaluation.status === "failed" || !evaluation.contract) {
    const failures = evaluation.checks
      .filter((check) => check.status === "failed")
      .map((check) => `${check.id}: ${check.message}`)
      .join("; ");
    throw new Error(`Promotion validation contract failed: ${failures}`);
  }
  if (!source.path?.endsWith(".md")) {
    throw new Error("Promotion source must be an SL-managed Markdown lesson.");
  }
  const sourceMarkdown = slParseMarkdown<Record<string, unknown>>(
    await slReadContainedText(root, source.path),
  );
  if (
    sourceMarkdown.frontmatter.id !== source.id ||
    sourceMarkdown.frontmatter.managedBy !== "SL-Repo"
  ) {
    throw new Error("Promotion source file ownership does not match the registry.");
  }

  const changes: SLChange[] = [];
  await slMove(root, promotedPath, probationPath, dryRun, changes);
  await slWriteText(
    root,
    probationPath,
    slStringifyMarkdown(markdown.frontmatter, markdown.body),
    dryRun,
    changes,
  );

  sourceMarkdown.frontmatter.status = "promoted";
  await slWriteText(
    root,
    source.path,
    slStringifyMarkdown(sourceMarkdown.frontmatter, sourceMarkdown.body),
    dryRun,
    changes,
  );

  source.status = "promoted";
  source.lastVerifiedAt = now.toISOString();
  source.relatedTo = [...new Set([...source.relatedTo, promotedId])];
  const promoted: SLRegistryArtifact = {
    id: promotedId,
    path: probationPath,
    promotionTargetPath: promotedPath,
    artifactType,
    classification: "promoted",
    managedBy: "SL-Repo",
    status: "probation",
    createdAt: existingIdOwner?.createdAt ?? now.toISOString(),
    lastVerifiedAt: now.toISOString(),
    pinned: false,
    relatedTo: [sourceId],
    dependsOn: [sourceId],
    scope: promotedScope,
  };
  slUpsertArtifact(registry, promoted);
  await slSaveRegistry(root, registry, dryRun, changes);
  await slWriteIndex(root, registry, dryRun, changes);
  const event: SLEvent = {
    schemaVersion: 1,
    timestamp: now.toISOString(),
    artifactId: promotedId,
    action: "promotion-registered",
    toStatus: "probation",
    toPath: probationPath,
    reason: `Registered from ${sourceId} for governed activation.`,
  };
  await slAppendEvents(root, [event], dryRun);
  return changes;
}

export async function slEvaluatePromotionReadiness(
  root: string,
  artifactId: string,
  options: SLEvaluatePromotionReadinessOptions = {},
): Promise<SLPromotionReadinessResult> {
  await slAssertEventPathSafe(root);
  return slWithRepositoryMutationLock(root, async () => {
    const registry = await slLoadRegistry(root);
    const artifact = slFindArtifact(registry, artifactId);
    const buildOptions: SLBuildPromotionEvaluationOptions = {
      ...options,
      ...(options.dryRun && artifact.promotionEvaluation
        ? { executableFallback: artifact.promotionEvaluation }
        : {}),
    };
    const evaluation = await slBuildPromotionEvaluation(
      root,
      registry,
      artifact,
      buildOptions,
    );
    const changes: SLChange[] = [];
    await slPersistEvaluation(
      root,
      registry,
      artifact,
      evaluation,
      options.dryRun ?? false,
      changes,
      "promotion-evaluated",
    );
    const dryRunKey = slDryRunEvaluationKey(root, artifactId);
    if (options.dryRun) {
      slDryRunPromotionEvaluations.set(dryRunKey, evaluation);
    } else {
      slDryRunPromotionEvaluations.delete(dryRunKey);
    }
    return { evaluation, changes };
  }, { dryRun: options.dryRun ?? false });
}

async function slBuildPromotionEvaluation(
  root: string,
  registry: SLRegistry,
  artifact: SLRegistryArtifact,
  options: SLBuildPromotionEvaluationOptions,
): Promise<SLPromotionEvaluation> {
  if (
    artifact.classification !== "promoted" ||
    artifact.status !== "probation" ||
    !artifact.path ||
    !artifact.promotionTargetPath ||
    (artifact.artifactType !== "instruction" &&
      artifact.artifactType !== "skill")
  ) {
    throw new Error(
      `Artifact ${artifact.id} is not a probationary promoted instruction or skill.`,
    );
  }

  const content = await slReadContainedText(root, artifact.path);
  const frontmatter = slParseMarkdown<Record<string, unknown>>(content).frontmatter;
  const contractEvaluation = await slEvaluateValidationContract(
    root,
    {
      artifactId: artifact.id,
      artifactPath: artifact.promotionTargetPath,
      contentPath: artifact.path,
      artifactType: artifact.artifactType,
      sourceIds: artifact.dependsOn ?? [],
      ...(typeof frontmatter.validationContract === "string"
        ? { contractPath: frontmatter.validationContract }
        : {}),
      frontmatter,
      expectedStatus: "probation",
    },
    {
      executeCommands: options.executeCommands ?? false,
      dryRun: options.dryRun ?? false,
    },
  );
  const sourceChecks = new Set([
    "contract-sources",
    "contract-source-paths",
  ]);
  const contractPassed = slChecksPassed(
    contractEvaluation.checks,
    (check) =>
      check.kind === "static" &&
      !sourceChecks.has(check.id),
  );
  const provenancePassed =
    slChecksPassed(
      contractEvaluation.checks,
      (check) => sourceChecks.has(check.id),
    ) &&
    (await slArtifactSourcesValid(root, registry, artifact));
  const scenarios = contractEvaluation.checks.filter(
    (check) => check.kind === "scenario",
  );
  const scenariosPassed =
    scenarios.length > 0 &&
    scenarios.every((check) => check.status === "passed");
  const executableChecks =
    contractEvaluation.contract?.executableChecks ?? [];
  const executableResults = contractEvaluation.checks.filter(
    (check) => check.kind === "executable",
  );
  const executablePassed =
    executableChecks.length === 0 ||
    (
      options.executeCommands === true &&
      options.dryRun !== true &&
      executableResults.length === executableChecks.length &&
      executableResults.every((check) => check.status === "passed")
    ) ||
    (
      options.dryRun === true &&
      options.executableFallback?.gates.some(
        (gate) =>
          gate.id === "executable-checks" && gate.status === "passed",
      ) === true
    );

  let conflictPassed = false;
  let governance:
    | ReturnType<typeof slEvaluatePromotionGovernance>
    | undefined;
  if (contractEvaluation.contract) {
    const active = await slLoadActiveContracts(
      root,
      registry,
      artifact.id,
    );
    if (options.governance) {
      const governed = await slBuildGovernanceInput(
        root,
        registry,
        artifact,
        contractEvaluation.contract,
        options.governance,
        active.contracts,
      );
      governance = slEvaluatePromotionGovernance(governed.input);
      conflictPassed =
        active.valid &&
        governed.legacyConflictsPassed &&
        governance.conflictsPassed;
    } else {
      conflictPassed =
        active.valid &&
        slFindValidationContractConflicts([
          ...active.contracts,
          {
            artifactId: artifact.id,
            contract: contractEvaluation.contract,
          },
        ]).length === 0;
    }
  }
  const approvalPassed = options.governance
    ? governance?.approvalPassed === true
    : slApprovalValid(options.approval);
  const gates: SLPromotionGateResult[] = [
    slGate(
      "contract",
      contractPassed,
      "Artifact structure and validation contract are valid.",
      "Artifact structure or validation contract is invalid.",
    ),
    slGate(
      "provenance",
      provenancePassed,
      "Registry evidence and contract provenance links are valid.",
      "Registry evidence or contract provenance links are invalid.",
    ),
    slGate(
      "static-scenarios",
      scenariosPassed,
      "All declared static scenarios passed.",
      "One or more declared static scenarios failed.",
    ),
    slGate(
      "active-conflicts",
      conflictPassed,
      "No declared conflict with active guidance exists.",
      "A declared conflict exists or active guidance could not be validated.",
    ),
    slGate(
      "executable-checks",
      executablePassed,
      executableChecks.length === 0
        ? "No executable checks are configured."
        : options.dryRun === true
          ? "Previously passing executable results were retained for the side-effect-free dry run."
          : "All configured executable checks passed.",
      "Configured executable checks were skipped or failed.",
    ),
    ...(!options.governance
      ? [
          slGate(
            "repository-approval",
            approvalPassed,
            "Explicit repository review approval was supplied.",
            "Explicit repository review approval is missing or invalid.",
          ),
        ]
      : []),
    ...(options.governance
      ? [
          slGate(
            "scope-evidence",
            governance?.evidencePassed === true,
            "Promotion evidence satisfies target-scope distribution policy.",
            "Promotion evidence does not satisfy target-scope distribution policy.",
          ),
          slGate(
            "owner-approval",
            approvalPassed,
            "The target scope owner set approved the promotion.",
            "Approval from the target scope owner set is missing or invalid.",
          ),
          slGate(
            "scoped-conflicts",
            governance?.conflictsPassed === true && conflictPassed,
            "Scoped declarations are compatible or explicitly overridden.",
            "A scoped declaration conflict is blocked.",
          ),
        ]
      : []),
  ];
  const artifactContentHash = slPromotionArtifactContentHash(content);
  const evaluation: SLPromotionEvaluation = {
    schemaVersion: 1,
    status: gates.every((gate) => gate.status === "passed")
      ? "passed"
      : "failed",
    artifactVersion: slPromotionArtifactVersion(artifactContentHash),
    artifactContentHash,
    contractContentHash: await slContractContentHash(
      root,
      contractEvaluation.contractPath,
    ),
    evaluatedAt: (options.now ?? new Date()).toISOString(),
    gates,
    ...(!options.governance && approvalPassed && options.approval
      ? { approvalEvidence: options.approval }
      : {}),
    ...(governance ? { governance: governance.record } : {}),
  };
  return evaluation;
}

export async function slActivatePromotion(
  root: string,
  artifactId: string,
  dryRun: boolean,
  now = new Date(),
  options: SLActivatePromotionOptions = {},
): Promise<SLChange[]> {
  await slAssertEventPathSafe(root);
  return slWithRepositoryMutationLock(root, async () => {
    const registry = await slLoadRegistry(root);
    const artifact = slFindArtifact(registry, artifactId);
    if (
      artifact.classification !== "promoted" ||
      artifact.status !== "probation" ||
      !artifact.path ||
      !artifact.promotionTargetPath
    ) {
      throw new Error(`Artifact ${artifactId} is not in promotion probation.`);
    }
    const dryRunKey = slDryRunEvaluationKey(root, artifactId);
    const evaluation = dryRun
      ? slDryRunPromotionEvaluations.get(dryRunKey) ??
        artifact.promotionEvaluation
      : artifact.promotionEvaluation;
    if (!evaluation || evaluation.status !== "passed") {
      throw new Error(
        `Artifact ${artifactId} does not have a passing promotion evaluation.`,
      );
    }

    const content = await slReadContainedText(root, artifact.path);
    const contentHash = slPromotionArtifactContentHash(content);
    const frontmatter = slParseMarkdown<Record<string, unknown>>(content).frontmatter;
    const contractPath =
      typeof frontmatter.validationContract === "string"
        ? frontmatter.validationContract
        : null;
    const contractHash = await slContractContentHash(root, contractPath);
    if (
      contentHash !== evaluation.artifactContentHash ||
      slPromotionArtifactVersion(contentHash) !== evaluation.artifactVersion ||
      contractHash !== evaluation.contractContentHash
    ) {
      const invalidated: SLPromotionEvaluation = {
        ...evaluation,
        status: "failed",
        evaluatedAt: now.toISOString(),
        gates: [
          ...evaluation.gates.filter((gate) => gate.id !== "content-unchanged"),
          {
            id: "content-unchanged",
            status: "failed",
            message:
              "Artifact or validation contract content changed after evaluation.",
          },
        ],
      };
      const changes: SLChange[] = [];
      await slPersistEvaluation(
        root,
        registry,
        artifact,
        invalidated,
        dryRun,
        changes,
        "promotion-invalidated",
      );
      throw new Error(
        `Artifact ${artifact.id} changed after evaluation and remains in probation.`,
      );
    }

    const refreshOptions: SLBuildPromotionEvaluationOptions = {
      executeCommands: true,
      dryRun,
      now,
      ...(dryRun ? { executableFallback: evaluation } : {}),
      ...(options.governance
        ? { governance: options.governance }
        : {}),
    };
    if (evaluation.governance && !options.governance) {
      const invalidated: SLPromotionEvaluation = {
        ...evaluation,
        status: "failed",
        evaluatedAt: now.toISOString(),
        gates: [
          ...evaluation.gates.filter(
            (gate) => gate.id !== "policy-current",
          ),
          {
            id: "policy-current",
            status: "failed",
            message:
              "Current scope, evidence, approvals, and policy context must be supplied for governed activation.",
          },
        ],
      };
      const changes: SLChange[] = [];
      await slPersistEvaluation(
        root,
        registry,
        artifact,
        invalidated,
        dryRun,
        changes,
        "promotion-invalidated",
      );
      throw new Error(
        `Artifact ${artifactId} governed activation context is missing and it remains in probation.`,
      );
    }
    if (evaluation.approvalEvidence) {
      refreshOptions.approval = evaluation.approvalEvidence;
    }
    const refreshedEvaluation = await slBuildPromotionEvaluation(
      root,
      registry,
      artifact,
      refreshOptions,
    );
    if (
      evaluation.governance &&
      (
        !refreshedEvaluation.governance ||
        refreshedEvaluation.governance.policyVersion !==
          evaluation.governance.policyVersion ||
        refreshedEvaluation.governance.policyHash !==
          evaluation.governance.policyHash ||
        refreshedEvaluation.governance.inputHash !==
          evaluation.governance.inputHash
      )
    ) {
      const invalidated: SLPromotionEvaluation = {
        ...refreshedEvaluation,
        status: "failed",
        gates: [
          ...refreshedEvaluation.gates.filter(
            (gate) => gate.id !== "policy-current",
          ),
          {
            id: "policy-current",
            status: "failed",
            message:
              "Promotion policy, scope, evidence, approvals, or active scoped guidance changed after evaluation.",
          },
        ],
      };
      const changes: SLChange[] = [];
      await slPersistEvaluation(
        root,
        registry,
        artifact,
        invalidated,
        dryRun,
        changes,
        "promotion-invalidated",
      );
      throw new Error(
        `Artifact ${artifactId} governance inputs changed and it remains in probation.`,
      );
    }
    if (refreshedEvaluation.status !== "passed") {
      const changes: SLChange[] = [];
      await slPersistEvaluation(
        root,
        registry,
        artifact,
        refreshedEvaluation,
        dryRun,
        changes,
        "promotion-invalidated",
      );
      throw new Error(
        `Artifact ${artifactId} activation gates changed and it remains in probation.`,
      );
    }
    if (await slExists(slResolveInside(root, artifact.promotionTargetPath))) {
      throw new Error(
        `Activation target already exists: ${artifact.promotionTargetPath}`,
      );
    }

    const changes: SLChange[] = [];
    const markdown = slParseMarkdown<Record<string, unknown>>(content);
    markdown.frontmatter.status = "active";
    await slWriteText(
      root,
      artifact.path,
      slStringifyMarkdown(markdown.frontmatter, markdown.body),
      dryRun,
      changes,
    );
    await slMove(
      root,
      artifact.path,
      artifact.promotionTargetPath,
      dryRun,
      changes,
    );
    const probationPath = artifact.path;
    artifact.path = artifact.promotionTargetPath;
    artifact.status = "active";
    artifact.activatedAt = now.toISOString();
    artifact.lastVerifiedAt = now.toISOString();
    artifact.promotionEvaluation = refreshedEvaluation;
    await slSaveRegistry(root, registry, dryRun, changes);
    await slWriteIndex(root, registry, dryRun, changes);
    const event: SLEvent = {
      schemaVersion: 1,
      timestamp: now.toISOString(),
      artifactId: artifact.id,
      action: "activated",
      fromStatus: "probation",
      toStatus: "active",
      fromPath: probationPath,
      toPath: artifact.path,
      reason: "All governed promotion gates passed.",
    };
    await slAppendEvents(root, [event], dryRun);
    if (dryRun) {
      slDryRunPromotionEvaluations.set(dryRunKey, refreshedEvaluation);
    } else {
      slDryRunPromotionEvaluations.delete(dryRunKey);
    }
    return changes;
  }, { dryRun });
}
