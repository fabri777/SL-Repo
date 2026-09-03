export type SLArtifactType = "lesson" | "instruction" | "skill" | "system";
export type SLClassification = "system" | "evidence" | "promoted";
export type SLStatus =
  | "active"
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

export interface SLConfig {
  schemaVersion: 1;
  scope: "repo";
  retention: SLRetentionConfig;
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
  hits?: number;
  retrievals?: number;
  notUsefulVotes?: number;
  relatedTo: string[];
  dependsOn?: string[];
}

export interface SLIndex {
  schemaVersion: 1;
  artifacts: SLIndexArtifact[];
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
