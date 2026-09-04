import { createHash } from "node:crypto";
import type {
  SLPromotionApprovalEvidence,
  SLPromotionArtifactScope,
  SLPromotionConflictResolution,
  SLPromotionEvidenceApplication,
  SLPromotionEvidenceSummary,
  SLPromotionGovernanceRecord,
  SLPromotionOwnerApprovalEvidence,
  SLPromotionPolicy,
  SLPromotionScopeRef,
  SLPromotionSourceScope,
} from "./SL-types.js";
import {
  SL_SECRET_PATTERNS,
  SL_USER_PATH_PATTERN,
} from "./SL-constants.js";
import { slCanonicalJson } from "./SL-utils.js";
import {
  slValidationScopesOverlap,
  type SLValidationContract,
  type SLValidationDeclaration,
} from "../SL-validation/SL-validation-contract.js";

const SL_SCOPE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const SL_ARTIFACT_ID_PATTERN = /^SL-[A-Z0-9][A-Z0-9-]*$/;
const SL_ARTIFACT_VERSION_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SL_REFERENCE_PATTERN =
  /^(?:[A-Za-z][A-Za-z0-9+.-]*:[^\s@\\]{1,240}|[A-Za-z0-9][A-Za-z0-9._/#:-]{0,255})$/;
const SL_IP_ADDRESS_PATTERN =
  /(?:^|[^0-9])(?:\d{1,3}\.){3}\d{1,3}(?:$|[^0-9])|(?:^|[^A-F0-9])(?:[A-F0-9]{0,4}:){2,7}[A-F0-9]{0,4}(?:$|[^A-F0-9])/i;

export interface SLPromotionGovernanceContext {
  targetScope: SLPromotionScopeRef;
  sourceScopes: SLPromotionSourceScope[];
  artifactScope: SLPromotionArtifactScope;
  evidence: SLPromotionEvidenceApplication[];
  approvals: SLPromotionApprovalEvidence[];
  activeGuidance?: SLScopedGuidance[];
}

export interface SLPromotionGovernanceInput
  extends SLPromotionGovernanceContext {
  policy: SLPromotionPolicy;
}

export interface SLCreatePromotionGovernanceContextInput {
  artifactId: string;
  sourceScopes: SLPromotionSourceScope[];
  targetScope?: SLPromotionScopeRef;
  evidence: SLPromotionEvidenceApplication[];
  approvals: SLPromotionApprovalEvidence[];
  activeGuidance?: SLScopedGuidance[];
}

export interface SLScopedGuidance {
  artifactId: string;
  scope: SLPromotionScopeRef;
  applicability: SLValidationContract["scope"];
  declarations: SLValidationDeclaration[];
}

export interface SLScopedConflictEvaluation {
  status: "passed" | "failed";
  resolutions: SLPromotionConflictResolution[];
}

export interface SLPromotionGovernanceEvaluation {
  record: SLPromotionGovernanceRecord;
  evidencePassed: boolean;
  approvalPassed: boolean;
  conflictsPassed: boolean;
}

function slHash(value: unknown): string {
  return createHash("sha256")
    .update(slCanonicalJson(value))
    .digest("hex");
}

function slValidReference(value: string): boolean {
  if (
    !SL_REFERENCE_PATTERN.test(value) ||
    SL_USER_PATH_PATTERN.test(value) ||
    SL_IP_ADDRESS_PATTERN.test(value)
  ) {
    return false;
  }
  return !SL_SECRET_PATTERNS.some(({ pattern }) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

function slAssertScope(scope: SLPromotionScopeRef): void {
  if (!SL_SCOPE_ID_PATTERN.test(scope.id)) {
    throw new Error(`Invalid promotion scope ID: ${scope.id}`);
  }
  if (!SL_SCOPE_ID_PATTERN.test(scope.ownerSetId)) {
    throw new Error(`Invalid promotion owner set ID: ${scope.ownerSetId}`);
  }
  if (!Number.isInteger(scope.precedence) || scope.precedence < 0) {
    throw new Error(
      `Promotion scope ${scope.id} precedence must be a non-negative integer.`,
    );
  }
  if (
    new Set(scope.ancestorScopeIds).size !== scope.ancestorScopeIds.length ||
    scope.ancestorScopeIds.some(
      (scopeId) =>
        !SL_SCOPE_ID_PATTERN.test(scopeId) || scopeId === scope.id,
    )
  ) {
    throw new Error(
      `Promotion scope ${scope.id} has invalid ancestor scope IDs.`,
    );
  }
  if (scope.root && scope.ancestorScopeIds.length > 0) {
    throw new Error(`Root promotion scope ${scope.id} cannot have ancestors.`);
  }
  if (
    scope.root &&
    (scope.kind !== "repository" || scope.precedence !== 0)
  ) {
    throw new Error(
      `Root promotion scope ${scope.id} must be a precedence-zero repository scope.`,
    );
  }
  if (scope.kind === "repository" && !scope.root) {
    throw new Error(
      `Repository promotion scope ${scope.id} must be the root scope.`,
    );
  }
  if (
    !scope.root &&
    (scope.precedence === 0 || scope.ancestorScopeIds.length === 0)
  ) {
    throw new Error(
      `Non-root promotion scope ${scope.id} must declare positive precedence and at least one ancestor.`,
    );
  }
}

function slAssertSourceScope(source: SLPromotionSourceScope): void {
  if (!SL_ARTIFACT_ID_PATTERN.test(source.artifactId)) {
    throw new Error(`Invalid source artifact ID: ${source.artifactId}`);
  }
  if (!SL_ARTIFACT_VERSION_PATTERN.test(source.artifactVersion)) {
    throw new Error(
      `Source ${source.artifactId} must have a SHA-256 artifact version.`,
    );
  }
  slAssertScope(source.scope);
}

function slAssertPolicy(policy: SLPromotionPolicy): void {
  if (
    policy.mode !== "single-repository" &&
    policy.mode !== "monorepo"
  ) {
    throw new Error(
      "Promotion policy mode must be single-repository or monorepo.",
    );
  }
  if (policy.policyVersion.trim().length === 0) {
    throw new Error("Promotion policyVersion must be non-empty.");
  }
  const counts = [
    policy.local.minimumVerifiedSuccesses,
    policy.shared.minimumDistinctNonRootScopes,
    policy.shared.minimumVerifiedSuccessesPerScope,
  ];
  if (counts.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new Error("Promotion evidence thresholds must be positive integers.");
  }
  if (!policy.conflicts.blockUndeclaredConflicts) {
    throw new Error(
      "Promotion policy must block undeclared contradictory conflicts.",
    );
  }
  if (
    typeof policy.approvals.requireTargetOwnerApproval !== "boolean" ||
    typeof policy.conflicts.allowNarrowerExplicitOverrides !== "boolean"
  ) {
    throw new Error("Promotion policy flags must be boolean values.");
  }
}

function slSortedScope(scope: SLPromotionScopeRef): SLPromotionScopeRef {
  return {
    ...scope,
    ancestorScopeIds: [...scope.ancestorScopeIds].sort(),
  };
}

function slNormalizeContext(
  input: SLPromotionGovernanceInput,
): SLPromotionGovernanceInput {
  return {
    policy: input.policy,
    targetScope: slSortedScope(input.targetScope),
    sourceScopes: input.sourceScopes
      .map((source) => ({
        ...source,
        scope: slSortedScope(source.scope),
      }))
      .sort((left, right) =>
        left.artifactId.localeCompare(right.artifactId),
      ),
    artifactScope: {
      ...input.artifactScope,
      scope: slSortedScope(input.artifactScope.scope),
    },
    evidence: input.evidence
      .map((evidence) => ({
        ...evidence,
        applicationScope: slSortedScope(evidence.applicationScope),
      }))
      .sort((left, right) =>
        [
          left.sourceArtifactId,
          left.artifactVersion,
          left.applicationScope.id,
          left.evidenceRef,
        ].join("\0").localeCompare(
          [
            right.sourceArtifactId,
            right.artifactVersion,
            right.applicationScope.id,
            right.evidenceRef,
          ].join("\0"),
        ),
      ),
    approvals: [...input.approvals].sort((left, right) =>
      left.evidenceRef.localeCompare(right.evidenceRef),
    ),
    activeGuidance: [...(input.activeGuidance ?? [])].sort((left, right) =>
      left.artifactId.localeCompare(right.artifactId),
    ),
  };
}

function slEvidenceSummary(
  evidence: SLPromotionEvidenceApplication[],
): SLPromotionEvidenceSummary[] {
  const groups = new Map<
    string,
    {
      sourceArtifactId: string;
      artifactVersion: string;
      scopeId: string;
      verifiedSuccessRefs: Set<string>;
      verifiedFailureRefs: Set<string>;
    }
  >();
  for (const application of evidence) {
    const key = [
      application.sourceArtifactId,
      application.artifactVersion,
      application.applicationScope.id,
    ].join("\0");
    const group = groups.get(key) ?? {
      sourceArtifactId: application.sourceArtifactId,
      artifactVersion: application.artifactVersion,
      scopeId: application.applicationScope.id,
      verifiedSuccessRefs: new Set<string>(),
      verifiedFailureRefs: new Set<string>(),
    };
    if (application.outcome === "verified-success") {
      group.verifiedSuccessRefs.add(application.evidenceRef);
    } else {
      group.verifiedFailureRefs.add(application.evidenceRef);
    }
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      sourceArtifactId: group.sourceArtifactId,
      artifactVersion: group.artifactVersion,
      scopeId: group.scopeId,
      verifiedSuccessCount: group.verifiedSuccessRefs.size,
      verifiedFailureCount: group.verifiedFailureRefs.size,
      evidenceRefs: [
        ...group.verifiedSuccessRefs,
        ...group.verifiedFailureRefs,
      ].sort(),
    }))
    .sort((left, right) =>
      [
        left.scopeId,
        left.sourceArtifactId,
        left.artifactVersion,
      ].join("\0").localeCompare(
        [
          right.scopeId,
          right.sourceArtifactId,
          right.artifactVersion,
        ].join("\0"),
      ),
    );
}

function slDirectEvidence(
  input: SLPromotionGovernanceInput,
): SLPromotionEvidenceApplication[] {
  const sourceVersions = new Map(
    input.sourceScopes.map((source) => [
      source.artifactId,
      source.artifactVersion,
    ]),
  );
  return input.evidence.filter(
    (application) =>
      sourceVersions.get(application.sourceArtifactId) ===
        application.artifactVersion &&
      application.outcome === "verified-success",
  );
}

function slEvidenceGate(
  input: SLPromotionGovernanceInput,
): { passed: boolean; reason: string } {
  if (input.policy.mode === "single-repository") {
    return {
      passed: true,
      reason:
        "Single-repository compatibility mode preserves the existing root promotion evidence behavior.",
    };
  }

  const directEvidence = slDirectEvidence(input);
  const sharedTarget =
    input.targetScope.root ||
    input.targetScope.kind === "repository" ||
    input.targetScope.kind === "shared";
  if (sharedTarget) {
    const successesByScope = new Map<string, Set<string>>();
    for (const application of directEvidence) {
      if (application.applicationScope.root) {
        continue;
      }
      const refs =
        successesByScope.get(application.applicationScope.id) ??
        new Set<string>();
      refs.add(application.evidenceRef);
      successesByScope.set(application.applicationScope.id, refs);
    }
    const qualifyingScopes = [...successesByScope.values()].filter(
      (refs) =>
        refs.size >=
        input.policy.shared.minimumVerifiedSuccessesPerScope,
    ).length;
    return {
      passed:
        qualifyingScopes >=
        input.policy.shared.minimumDistinctNonRootScopes,
      reason:
        qualifyingScopes >=
        input.policy.shared.minimumDistinctNonRootScopes
          ? `Verified successful applications span ${qualifyingScopes} distinct non-root scopes.`
          : `Shared promotion requires ${input.policy.shared.minimumDistinctNonRootScopes} distinct non-root scopes with at least ${input.policy.shared.minimumVerifiedSuccessesPerScope} verified successful application(s) each; found ${qualifyingScopes}.`,
    };
  }

  const sourcesOwnedByTarget = input.sourceScopes.every(
    (source) => source.scope.id === input.targetScope.id,
  );
  const ownScopeReferences = new Set(
    directEvidence
      .filter(
        (application) =>
          application.applicationScope.id === input.targetScope.id,
      )
      .map((application) => application.evidenceRef),
  );
  const passed =
    sourcesOwnedByTarget &&
    ownScopeReferences.size >=
      input.policy.local.minimumVerifiedSuccesses;
  return {
    passed,
    reason: passed
      ? `Local promotion has ${ownScopeReferences.size} verified successful application(s) in its own scope.`
      : `Local promotion requires source evidence owned by ${input.targetScope.id} and at least ${input.policy.local.minimumVerifiedSuccesses} verified successful application(s) in that scope.`,
  };
}

function slApprovalGate(
  input: SLPromotionGovernanceInput,
): {
  passed: boolean;
  reason: string;
  ownerApprovals: SLPromotionOwnerApprovalEvidence[];
  legacyApproval:
    | Extract<SLPromotionApprovalEvidence, { kind: "repository-review" }>
    | undefined;
} {
  if (input.policy.mode === "single-repository") {
    const legacyApproval = input.approvals.find(
      (
        approval,
      ): approval is Extract<
        SLPromotionApprovalEvidence,
        { kind: "repository-review" }
      > =>
        approval.kind === "repository-review" &&
        slValidReference(approval.evidenceRef),
    );
    return {
      passed: legacyApproval !== undefined,
      reason: legacyApproval
        ? "Explicit repository review approval was supplied."
        : "Explicit repository review approval is missing or invalid.",
      ownerApprovals: [],
      legacyApproval,
    };
  }

  const ownerApprovals = input.approvals.filter(
    (approval): approval is SLPromotionOwnerApprovalEvidence =>
      approval.kind === "owner-set-approval" &&
      approval.scopeId === input.targetScope.id &&
      approval.ownerSetId === input.targetScope.ownerSetId &&
      slValidReference(approval.evidenceRef),
  );
  const passed =
    !input.policy.approvals.requireTargetOwnerApproval ||
    ownerApprovals.length > 0;
  return {
    passed,
    reason: passed
      ? `Target owner set ${input.targetScope.ownerSetId} approved the promotion.`
      : `Promotion requires approval from target owner set ${input.targetScope.ownerSetId}.`,
    ownerApprovals,
    legacyApproval: undefined,
  };
}

function slNarrowerGuidance(
  left: SLScopedGuidance,
  right: SLScopedGuidance,
): { narrower: SLScopedGuidance; broader: SLScopedGuidance } | undefined {
  if (left.scope.precedence === right.scope.precedence) {
    return undefined;
  }
  if (
    left.scope.precedence > right.scope.precedence &&
    left.scope.ancestorScopeIds.includes(right.scope.id)
  ) {
    return { narrower: left, broader: right };
  }
  if (
    right.scope.precedence > left.scope.precedence &&
    right.scope.ancestorScopeIds.includes(left.scope.id)
  ) {
    return { narrower: right, broader: left };
  }
  return undefined;
}

function slMatchingOverride(
  narrower: SLScopedGuidance,
  broader: SLScopedGuidance,
  key: string,
): SLValidationDeclaration["override"] {
  const declaration = narrower.declarations.find(
    (candidate) => candidate.key === key,
  );
  const override = declaration?.override;
  if (
    !override ||
    override.kind !== "narrower-scope" ||
    override.overriddenArtifactId !== broader.artifactId ||
    override.overriddenScopeId !== broader.scope.id ||
    override.declarationKey !== key ||
    override.reason.trim().length === 0 ||
    !slValidReference(override.approvalRef)
  ) {
    return undefined;
  }
  return override;
}

export function slEvaluateScopedGuidanceConflicts(
  policy: SLPromotionPolicy,
  guidance: SLScopedGuidance[],
): SLScopedConflictEvaluation {
  slAssertPolicy(policy);
  const resolutions: SLPromotionConflictResolution[] = [];
  const ordered = [...guidance].sort((left, right) =>
    left.artifactId.localeCompare(right.artifactId),
  );
  for (const item of ordered) {
    slAssertScope(item.scope);
    if (!SL_ARTIFACT_ID_PATTERN.test(item.artifactId)) {
      throw new Error(`Invalid scoped guidance artifact ID: ${item.artifactId}`);
    }
  }

  for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
    const left = ordered[leftIndex];
    if (!left) {
      continue;
    }
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < ordered.length;
      rightIndex += 1
    ) {
      const right = ordered[rightIndex];
      if (
        !right ||
        !slValidationScopesOverlap(
          left.applicability,
          right.applicability,
        )
      ) {
        continue;
      }
      const rightDeclarations = new Map(
        right.declarations.map((declaration) => [
          declaration.key,
          declaration,
        ]),
      );
      for (const leftDeclaration of left.declarations) {
        const rightDeclaration = rightDeclarations.get(leftDeclaration.key);
        if (
          !rightDeclaration ||
          slCanonicalJson(leftDeclaration.value) ===
            slCanonicalJson(rightDeclaration.value)
        ) {
          continue;
        }
        const orderedScopes = slNarrowerGuidance(left, right);
        const override =
          orderedScopes && policy.conflicts.allowNarrowerExplicitOverrides
            ? slMatchingOverride(
                orderedScopes.narrower,
                orderedScopes.broader,
                leftDeclaration.key,
              )
            : undefined;
        if (orderedScopes && override) {
          resolutions.push({
            declarationKey: leftDeclaration.key,
            narrowerArtifactId: orderedScopes.narrower.artifactId,
            broaderArtifactId: orderedScopes.broader.artifactId,
            status: "explicit-override",
            message: `Narrower artifact ${orderedScopes.narrower.artifactId} explicitly overrides ${orderedScopes.broader.artifactId} for ${leftDeclaration.key}.`,
            override,
          });
          continue;
        }
        resolutions.push({
          declarationKey: leftDeclaration.key,
          narrowerArtifactId:
            orderedScopes?.narrower.artifactId ?? left.artifactId,
          broaderArtifactId:
            orderedScopes?.broader.artifactId ?? right.artifactId,
          status: "blocked",
          message:
            left.scope.precedence === right.scope.precedence
              ? `Artifacts ${left.artifactId} and ${right.artifactId} have same-precedence contradictory declarations for ${leftDeclaration.key}.`
              : `Contradictory declaration ${leftDeclaration.key} lacks a valid explicit narrower-scope override.`,
        });
      }
    }
  }
  return {
    status: resolutions.some((resolution) => resolution.status === "blocked")
      ? "failed"
      : "passed",
    resolutions,
  };
}

export function slPromotionPolicyHash(policy: SLPromotionPolicy): string {
  slAssertPolicy(policy);
  return slHash(policy);
}

export function slDefaultPromotionTargetScope(
  sourceScope: SLPromotionScopeRef,
): SLPromotionScopeRef {
  slAssertScope(sourceScope);
  return structuredClone(sourceScope);
}

export function slCreatePromotionGovernanceContext(
  input: SLCreatePromotionGovernanceContextInput,
): SLPromotionGovernanceContext {
  if (input.sourceScopes.length === 0) {
    throw new Error("Promotion governance requires at least one source scope.");
  }
  const defaultScope = input.sourceScopes[0]!.scope;
  if (
    !input.targetScope &&
    input.sourceScopes.some((source) => source.scope.id !== defaultScope.id)
  ) {
    throw new Error(
      "Promotion target scope must be explicit when source evidence spans scopes.",
    );
  }
  const targetScope = input.targetScope
    ? structuredClone(input.targetScope)
    : slDefaultPromotionTargetScope(defaultScope);
  return {
    targetScope,
    sourceScopes: structuredClone(input.sourceScopes),
    artifactScope: {
      artifactId: input.artifactId,
      scope: structuredClone(targetScope),
    },
    evidence: structuredClone(input.evidence),
    approvals: structuredClone(input.approvals),
    ...(input.activeGuidance
      ? { activeGuidance: structuredClone(input.activeGuidance) }
      : {}),
  };
}

export function slEvaluatePromotionGovernance(
  inputValue: SLPromotionGovernanceInput,
): SLPromotionGovernanceEvaluation {
  const input = slNormalizeContext(inputValue);
  slAssertPolicy(input.policy);
  slAssertScope(input.targetScope);
  slAssertScope(input.artifactScope.scope);
  if (!SL_ARTIFACT_ID_PATTERN.test(input.artifactScope.artifactId)) {
    throw new Error(
      `Invalid promoted artifact ID: ${input.artifactScope.artifactId}`,
    );
  }
  if (input.sourceScopes.length === 0) {
    throw new Error("Promotion governance requires at least one source scope.");
  }
  const sourceIds = new Set<string>();
  for (const source of input.sourceScopes) {
    slAssertSourceScope(source);
    if (sourceIds.has(source.artifactId)) {
      throw new Error(
        `Promotion source scope is duplicated: ${source.artifactId}`,
      );
    }
    sourceIds.add(source.artifactId);
  }
  if (
    input.artifactScope.scope.id !== input.targetScope.id ||
    input.artifactScope.scope.ownerSetId !==
      input.targetScope.ownerSetId
  ) {
    throw new Error(
      "Promoted artifact scope must match the target promotion scope.",
    );
  }
  for (const application of input.evidence) {
    slAssertScope(application.applicationScope);
    if (
      !SL_ARTIFACT_ID_PATTERN.test(application.sourceArtifactId) ||
      !SL_ARTIFACT_VERSION_PATTERN.test(application.artifactVersion) ||
      !slValidReference(application.evidenceRef)
    ) {
      throw new Error("Promotion evidence contains invalid identifiers.");
    }
  }

  const evidenceGate = slEvidenceGate(input);
  const approvalGate = slApprovalGate(input);
  const conflicts = slEvaluateScopedGuidanceConflicts(
    input.policy,
    input.activeGuidance ?? [],
  );
  const reasons = [
    evidenceGate.reason,
    approvalGate.reason,
    ...(conflicts.status === "failed"
      ? ["One or more scoped declaration conflicts are blocked."]
      : ["Scoped declarations have no blocked conflicts."]),
  ];
  const status =
    evidenceGate.passed &&
    approvalGate.passed &&
    conflicts.status === "passed"
      ? "passed"
      : "failed";
  const policyHash = slPromotionPolicyHash(input.policy);
  const record: SLPromotionGovernanceRecord = {
    schemaVersion: 1,
    status,
    policyVersion: input.policy.policyVersion,
    policyHash,
    inputHash: slHash({
      ...input,
      policyHash,
    }),
    targetScope: input.targetScope,
    sourceScopes: input.sourceScopes,
    artifactScope: input.artifactScope,
    evidenceSummary: slEvidenceSummary(input.evidence),
    ownerApprovals: approvalGate.ownerApprovals,
    ...(approvalGate.legacyApproval
      ? { legacyApproval: approvalGate.legacyApproval }
      : {}),
    conflictResolutions: conflicts.resolutions,
    reasons,
  };
  return {
    record,
    evidencePassed: evidenceGate.passed,
    approvalPassed: approvalGate.passed,
    conflictsPassed: conflicts.status === "passed",
  };
}

export function slPromotionGovernanceRecordIsCurrent(
  record: SLPromotionGovernanceRecord,
  input: SLPromotionGovernanceInput,
): boolean {
  try {
    const current = slEvaluatePromotionGovernance(input).record;
    return (
      current.status === "passed" &&
      record.status === "passed" &&
      current.policyVersion === record.policyVersion &&
      current.policyHash === record.policyHash &&
      current.inputHash === record.inputHash
    );
  } catch {
    return false;
  }
}
