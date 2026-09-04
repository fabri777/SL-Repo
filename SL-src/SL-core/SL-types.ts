export type SLArtifactType = "lesson" | "instruction" | "skill" | "system";
export type SLClassification = "system" | "evidence" | "promoted";
export type SLStatus =
  | "active"
  | "generated"
  | "probation"
  | "raw"
  | "distilled"
  | "promotion-candidate"
  | "promoted"
  | "stale"
  | "quarantined"
  | "superseded"
  | "deleted";

export interface SLRetentionConfig {
  staleAfterDays: number;
  quarantineAfterDays: number;
  deleteAfterQuarantineDays: number;
  wrongDeleteAfterDays: number;
  promotedStaleAfterDays: number;
  promotedQuarantineAfterDays: number;
}

export type SLPromotionPolicyMode =
  | "single-repository"
  | "monorepo";

export type SLPromotionScopeKind =
  | "repository"
  | "shared"
  | "solution"
  | "service"
  | "library"
  | "package";

export interface SLPromotionPolicy {
  mode: SLPromotionPolicyMode;
  policyVersion: string;
  local: {
    minimumVerifiedSuccesses: number;
  };
  shared: {
    minimumDistinctNonRootScopes: number;
    minimumVerifiedSuccessesPerScope: number;
  };
  approvals: {
    requireTargetOwnerApproval: boolean;
  };
  conflicts: {
    allowNarrowerExplicitOverrides: boolean;
    blockUndeclaredConflicts: boolean;
  };
}

export interface SLConfig {
  schemaVersion: 1;
  scope: "repo";
  retention: SLRetentionConfig;
  promotion: SLPromotionPolicy;
}

export type SLScopeKind =
  | "repository"
  | "shared"
  | "service"
  | "solution"
  | "library"
  | "package";

export interface SLScopeDefinition {
  id: string;
  displayName: string;
  kind: SLScopeKind;
  includePaths: string[];
  excludePaths: string[];
  parentScopeId?: string;
  dependencyScopeIds: string[];
  ownerAliases: string[];
  priority?: number;
}

export interface SLScopeCatalog {
  schemaVersion: 1;
  scopes: SLScopeDefinition[];
}

export interface SLScopeCatalogIssue {
  code: string;
  path?: string;
  message: string;
}

export interface SLScopeCatalogSource {
  catalog: unknown;
  path: string | null;
  format: "default" | "json" | "yaml";
}

export interface SLScopeResolution {
  inputPath: string;
  normalizedPath: string;
  primaryScopeId: string;
  matchedScopeIds: string[];
  orderedScopeIds: string[];
}

export interface SLScopeSetResolution {
  paths: SLScopeResolution[];
  primaryScopeIds: string[];
  orderedScopeIds: string[];
}

export interface SLRegistryArtifact {
  id: string;
  path: string | null;
  originalPath?: string;
  artifactType: SLArtifactType;
  classification: SLClassification;
  managedBy: "SL-Repo";
  status: SLStatus;
  previousStatus?: SLStatus;
  createdAt: string;
  lastVerifiedAt: string;
  lastRetrievedAt?: string;
  lastSuccessfulUseAt?: string;
  hits?: number;
  retrievals?: number;
  notUsefulVotes?: number;
  staleAt?: string;
  quarantinedAt?: string;
  deleteEligibleAt?: string;
  deletedAt?: string;
  pinned: boolean;
  relatedTo: string[];
  dependsOn?: string[];
  trigger?: string[];
  forgetReason?: "wrong" | "irrelevant" | "superseded" | "unused";
  promotionTargetPath?: string;
  activatedAt?: string;
  promotionEvaluation?: SLPromotionEvaluation;
  usageProjection?: SLUsageProjection;
  scope?: SLScopeDescriptor;
}

export interface SLRegistry {
  schemaVersion: 1;
  artifacts: SLRegistryArtifact[];
}

export interface SLIndexArtifact {
  id: string;
  path: string;
  artifactType: SLArtifactType;
  status: SLStatus;
  trigger?: string[];
  relatedTo: string[];
  dependsOn?: string[];
}

export interface SLIndex {
  schemaVersion: 1 | 2;
  scope?: SLScopeDescriptor;
  artifacts: SLIndexArtifact[];
}

export interface SLScopeDescriptor {
  id: string;
  path: string;
}

export interface SLScopeCatalogEntry {
  scope: SLScopeDescriptor;
  shard: string;
  registryPath: string;
  indexPath: string;
  projectionPath: string;
  usageEventsPath: string;
}

export interface SLStateCatalog {
  schemaVersion: 1;
  scopes: SLScopeCatalogEntry[];
}

export interface SLScopeRegistry {
  schemaVersion: 1;
  scope: SLScopeDescriptor;
  artifacts: SLRegistryArtifact[];
}

export interface SLScopeUsageProjection {
  schemaVersion: 1;
  scope: SLScopeDescriptor;
  currentArtifactVersions: Record<string, string>;
  projections: SLUsageProjection[];
}

export interface SLEvent {
  schemaVersion: 1;
  timestamp: string;
  artifactId: string;
  action:
    | "registered"
    | "captured"
    | "voted"
    | "promoted"
    | "promotion-registered"
    | "promotion-evaluated"
    | "promotion-invalidated"
    | "activated"
    | "marked-stale"
    | "quarantined"
    | "restored"
    | "deleted";
  reason?: string;
  fromStatus?: SLStatus;
  toStatus?: SLStatus;
  fromPath?: string | null;
  toPath?: string | null;
}

export interface SLLifecycleEvent extends SLEvent {
  eventId: string;
  idempotencyKey: string;
}

export interface SLLegacyRepositoryApprovalEvidence {
  kind: "repository-review";
  evidenceRef: string;
}

export interface SLPromotionOwnerApprovalEvidence {
  kind: "owner-set-approval";
  scopeId: string;
  ownerSetId: string;
  evidenceRef: string;
}

export type SLPromotionApprovalEvidence =
  | SLLegacyRepositoryApprovalEvidence
  | SLPromotionOwnerApprovalEvidence;

export interface SLPromotionScopeRef {
  id: string;
  kind: SLPromotionScopeKind;
  root: boolean;
  precedence: number;
  ancestorScopeIds: string[];
  ownerSetId: string;
}

export interface SLPromotionSourceScope {
  artifactId: string;
  artifactVersion: string;
  scope: SLPromotionScopeRef;
}

export interface SLPromotionArtifactScope {
  artifactId: string;
  scope: SLPromotionScopeRef;
}

export interface SLPromotionEvidenceApplication {
  sourceArtifactId: string;
  artifactVersion: string;
  applicationScope: SLPromotionScopeRef;
  outcome: "verified-success" | "verified-failure";
  evidenceRef: string;
}

export interface SLPromotionEvidenceSummary {
  sourceArtifactId: string;
  artifactVersion: string;
  scopeId: string;
  verifiedSuccessCount: number;
  verifiedFailureCount: number;
  evidenceRefs: string[];
}

export interface SLAuditableOverrideMetadata {
  kind: "narrower-scope";
  overriddenArtifactId: string;
  overriddenScopeId: string;
  declarationKey: string;
  reason: string;
  approvalRef: string;
}

export interface SLPromotionConflictResolution {
  declarationKey: string;
  narrowerArtifactId: string;
  broaderArtifactId: string;
  status: "explicit-override" | "blocked";
  message: string;
  override?: SLAuditableOverrideMetadata;
}

export interface SLPromotionGovernanceRecord {
  schemaVersion: 1;
  status: "passed" | "failed";
  policyVersion: string;
  policyHash: string;
  inputHash: string;
  targetScope: SLPromotionScopeRef;
  sourceScopes: SLPromotionSourceScope[];
  artifactScope: SLPromotionArtifactScope;
  evidenceSummary: SLPromotionEvidenceSummary[];
  ownerApprovals: SLPromotionOwnerApprovalEvidence[];
  legacyApproval?: SLLegacyRepositoryApprovalEvidence;
  conflictResolutions: SLPromotionConflictResolution[];
  reasons: string[];
}

export interface SLPromotionGateResult {
  id:
    | "contract"
    | "provenance"
    | "static-scenarios"
    | "active-conflicts"
    | "executable-checks"
    | "repository-approval"
    | "scope-evidence"
    | "owner-approval"
    | "scoped-conflicts"
    | "policy-current"
    | "content-unchanged";
  status: "passed" | "failed";
  message: string;
}

export interface SLPromotionEvaluation {
  schemaVersion: 1;
  status: "passed" | "failed";
  artifactVersion: string;
  artifactContentHash: string;
  contractContentHash: string | null;
  evaluatedAt: string;
  gates: SLPromotionGateResult[];
  approvalEvidence?: SLPromotionApprovalEvidence;
  governance?: SLPromotionGovernanceRecord;
}

export type SLUsageStage = "selected" | "applied" | "outcome" | "verified";
export type SLUsageOutcome =
  | "success"
  | "failure"
  | "partial"
  | "unknown";

export interface SLUsageEventBase {
  schemaVersion: 1;
  eventId: string;
  idempotencyKey: string;
  artifactId: string;
  artifactVersion: string;
  artifactContentHash: string;
  taskRunId: string;
  applicationId: string;
  stage: SLUsageStage;
  outcome: SLUsageOutcome;
  verifierType: string;
  timestamp: string;
  evidenceRef?: string;
  scope?: SLScopeDescriptor;
}

export interface SLUsageApplicationEvent extends SLUsageEventBase {
  eventType: "usage";
}

export interface SLLegacyUsageBaselineEvent extends SLUsageEventBase {
  eventType: "legacy-baseline";
  legacyCounts: {
    retrievalCount: number;
    applicationCount: number;
    verifiedSuccessCount: number;
    verifiedFailureCount: number;
    unknownCount: number;
  };
  legacyLastRetrievedAt?: string;
  legacyLastSuccessfulUseAt?: string;
}

export type SLUsageEvent =
  | SLUsageApplicationEvent
  | SLLegacyUsageBaselineEvent;

export interface SLUsageProjection {
  scope: SLScopeDescriptor;
  artifactId: string;
  artifactVersion: string;
  artifactContentHash: string;
  retrievalCount: number;
  applicationCount: number;
  applicationRate: number | null;
  outcomeCount: number;
  outcomeSuccessCount: number;
  outcomeFailureCount: number;
  outcomePartialCount: number;
  outcomeUnknownCount: number;
  outcomeSuccessRate: number | null;
  verifiedCount: number;
  resolvedCount: number;
  verifiedSuccessCount: number;
  verifiedFailureCount: number;
  unknownCount: number;
  verifiedSuccessRate: number | null;
  lastRetrievedAt?: string;
  lastAppliedAt?: string;
  lastVerifiedSuccessAt?: string;
  lastVerifiedFailureAt?: string;
}

export interface SLUsageScopeAggregate {
  scope: SLScopeDescriptor;
  retrievalCount: number;
  applicationCount: number;
  outcomeCount: number;
  outcomeSuccessCount: number;
  outcomeFailureCount: number;
  outcomePartialCount: number;
  outcomeUnknownCount: number;
  verifiedCount: number;
  verifiedSuccessCount: number;
  verifiedFailureCount: number;
  applicationRate: number | null;
  outcomeSuccessRate: number | null;
  verifiedSuccessRate: number | null;
}

export interface SLUsageRepositoryAggregate {
  aggregation: "repository-counts-only";
  scopeCount: number;
  retrievalCount: number;
  applicationCount: number;
  outcomeCount: number;
  outcomeSuccessCount: number;
  outcomeFailureCount: number;
  outcomePartialCount: number;
  outcomeUnknownCount: number;
  verifiedCount: number;
  verifiedSuccessCount: number;
  verifiedFailureCount: number;
  successRate: null;
  successRateReason: "rates-are-reported-per-scope";
}

export interface SLChange {
  action: "create" | "update" | "move" | "delete" | "skip";
  path: string;
  detail: string;
}

export interface SLValidationIssue {
  severity: "error" | "warning";
  code: string;
  path?: string;
  message: string;
}

export interface SLSweepResult {
  changes: SLChange[];
  events: SLEvent[];
}
