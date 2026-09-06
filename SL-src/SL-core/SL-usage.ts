import fg from "fast-glob";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
} from "node:fs/promises";
import { basename, dirname } from "node:path";
import {
  SL_ACTIVE_STATUSES,
  SL_PATHS,
  SL_SECRET_PATTERNS,
  SL_USER_PATH_PATTERN,
} from "./SL-constants.js";
import { slParseMarkdown, slStringifyMarkdown } from "./SL-frontmatter.js";
import { slWithRepositoryMutationLock } from "./SL-mutation-lock.js";
import {
  slPreflightPromotedProbationDestination,
  slPromotedProbationPath,
  slRewriteAndMovePromotionToProbation,
} from "./SL-promotion-path.js";
import {
  slFindArtifact,
  slLoadRegistry,
  slSaveRegistry,
} from "./SL-registry.js";
import type {
  SLChange,
  SLLegacyUsageBaselineEvent,
  SLRegistry,
  SLRegistryArtifact,
  SLUsageApplicationEvent,
  SLUsageEvent,
  SLUsageOutcome,
  SLUsageProjection,
  SLUsageRepositoryAggregate,
  SLScopeDescriptor,
  SLUsageScopeAggregate,
  SLUsageStage,
} from "./SL-types.js";
import {
  SL_DEFAULT_SCOPE,
  slArtifactShardName,
  slLoadStateCatalog,
  slNormalizeScope,
  slScopeCatalogEntry,
  slScopeKey,
} from "./SL-state.js";
import {
  slAssertRealPathInside,
  slCanonicalJson,
  slCompareOrdinal,
  slExists,
  slNormalizePath,
  slReadContainedText,
  slReadJson,
  slResolveInside,
  slMove,
  slWriteText,
} from "./SL-utils.js";
import { slWriteIndex } from "../SL-index/SL-index.js";

const SL_USAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const SL_ARTIFACT_ID_PATTERN = /^SL-[A-Z0-9][A-Z0-9-]*$/;
const SL_CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/;
const SL_EVENT_ID_PATTERN = /^SL-USE-[A-F0-9]{32}$/;
const SL_EVIDENCE_REF_PATTERN =
  /^(?:[A-Za-z][A-Za-z0-9+.-]*:[^\s@\\]{1,240}|[A-Za-z0-9][A-Za-z0-9._/#:-]{0,255})$/;
const SL_IP_ADDRESS_PATTERN =
  /(?:^|[^0-9])(?:\d{1,3}\.){3}\d{1,3}(?:$|[^0-9])|(?:^|[^A-F0-9])(?:[A-F0-9]{0,4}:){2,7}[A-F0-9]{0,4}(?:$|[^A-F0-9])/i;
const SL_EMAIL_ADDRESS_PATTERN =
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const SL_NON_CONTENT_FRONTMATTER_FIELDS = new Set([
  "id",
  "schemaVersion",
  "managedBy",
  "status",
  "previousStatus",
  "pinned",
  "hits",
  "retrievals",
  "notUsefulVotes",
  "lastRetrievedAt",
  "lastSuccessfulUseAt",
  "lastVerifiedAt",
  "staleAt",
  "quarantinedAt",
  "deleteEligibleAt",
  "deletedAt",
  "activatedAt",
  "forgetReason",
]);

export interface SLCreateUsageEventInput {
  artifactId: string;
  artifactContentHash: string;
  taskRunId: string;
  applicationId: string;
  stage: SLUsageStage;
  outcome: SLUsageOutcome;
  verifierType: string;
  timestamp: string;
  idempotencyKey: string;
  evidenceRef?: string;
  scope?: SLScopeDescriptor;
}

export interface SLStartUsageOptions {
  applicationId?: string;
  taskRunId?: string;
  idempotencyKey?: string;
  scope?: SLScopeDescriptor;
  now?: Date;
  dryRun?: boolean;
}

export interface SLStartUsageResult {
  artifactId: string;
  artifactVersion: string;
  artifactContentHash: string;
  taskRunId: string;
  applicationId: string;
  receiptId: string;
  eventIds: {
    selected: string;
    applied: string;
  };
  events: {
    selected: SLUsageApplicationEvent;
    applied: SLUsageApplicationEvent;
  };
  changes: SLChange[];
}

export interface SLFinishUsageOptions {
  outcome: SLUsageOutcome;
  verified?: boolean;
  verifierType?: string;
  evidenceRef?: string;
  idempotencyKey?: string;
  now?: Date;
  dryRun?: boolean;
}

export interface SLFinishUsageResult {
  artifactId: string;
  artifactVersion: string;
  artifactContentHash: string;
  taskRunId: string;
  applicationId: string;
  receiptId: string;
  outcome: SLUsageOutcome;
  verified: boolean;
  verifierType: string;
  event: SLUsageApplicationEvent;
  change: SLChange;
  changes: SLChange[];
}

export interface SLOwnedMarkdownSnapshot {
  content: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

function slHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function slCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(slCanonicalValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => slCompareOrdinal(left, right))
        .map(([key, entry]) => [key, slCanonicalValue(entry)]),
    );
  }
  return value;
}

function slMaxTimestamp(
  current: string | undefined,
  candidate: string | undefined,
): string | undefined {
  if (!candidate) {
    return current;
  }
  return !current || candidate > current ? candidate : current;
}

function slAssertUsageId(name: string, value: string): void {
  if (!SL_USAGE_ID_PATTERN.test(value)) {
    throw new Error(
      `${name} must be an opaque identifier containing only letters, numbers, '.', '_', ':', '/', or '-'.`,
    );
  }
}

function slAssertTimestamp(name: string, value: string): void {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${name} must be a canonical ISO-8601 UTC timestamp.`);
  }
}

export function slAssertEvidenceRef(value: string): void {
  if (
    !SL_EVIDENCE_REF_PATTERN.test(value) ||
    SL_EMAIL_ADDRESS_PATTERN.test(value) ||
    SL_USER_PATH_PATTERN.test(value) ||
    SL_IP_ADDRESS_PATTERN.test(value) ||
    SL_SECRET_PATTERNS.some(({ pattern }) => pattern.test(value))
  ) {
    throw new Error(
      "evidenceRef must be an opaque, non-PII reference without embedded source content.",
    );
  }
}

export function slArtifactContentHash(content: string): string {
  return slHash(content.replaceAll("\r\n", "\n"));
}

export function slArtifactUsageContentHash(content: string): string {
  const markdown = slParseMarkdown<Record<string, unknown>>(content);
  const contentFrontmatter = Object.fromEntries(
    Object.entries(markdown.frontmatter)
      .filter(([key]) => !SL_NON_CONTENT_FRONTMATTER_FIELDS.has(key))
      .sort(([left], [right]) => slCompareOrdinal(left, right)),
  );
  return slArtifactContentHash(
    JSON.stringify({
      frontmatter: slCanonicalValue(contentFrontmatter),
      body: markdown.body.replaceAll("\r\n", "\n"),
    }),
  );
}

export function slArtifactVersion(contentHash: string): string {
  if (!SL_CONTENT_HASH_PATTERN.test(contentHash)) {
    throw new Error("artifactContentHash must be a lowercase SHA-256 hash.");
  }
  return `sha256:${contentHash}`;
}

function slOwnershipError(artifact: SLRegistryArtifact): Error {
  return new Error(
    `Artifact ${artifact.id} file ownership does not match the registry.`,
  );
}

function slAssertExpectedArtifactKind(
  artifact: SLRegistryArtifact,
  frontmatter: Record<string, unknown>,
): void {
  const fileName = artifact.path ? basename(artifact.path) : "";
  const isLesson =
    artifact.artifactType === "lesson" &&
    artifact.classification === "evidence" &&
    fileName.startsWith("SL-") &&
    fileName.endsWith(".md") &&
    ["win", "pitfall", "mixed"].includes(String(frontmatter.kind));
  const isInstruction =
    artifact.artifactType === "instruction" &&
    artifact.classification === "promoted" &&
    fileName.startsWith("SL-") &&
    fileName.endsWith(".instructions.md");
  const isSkill =
    artifact.artifactType === "skill" &&
    artifact.classification === "promoted" &&
    fileName === "SKILL.md";
  if (!isLesson && !isInstruction && !isSkill) {
    throw slOwnershipError(artifact);
  }
  if (
    (frontmatter.artifactType !== undefined &&
      frontmatter.artifactType !== artifact.artifactType) ||
    (frontmatter.classification !== undefined &&
      frontmatter.classification !== artifact.classification)
  ) {
    throw slOwnershipError(artifact);
  }
}

export async function slReadOwnedArtifactMarkdown(
  root: string,
  artifact: SLRegistryArtifact,
  expectedArtifactType?: SLRegistryArtifact["artifactType"],
  expectedClassification?: SLRegistryArtifact["classification"],
): Promise<SLOwnedMarkdownSnapshot> {
  if (
    artifact.managedBy !== "SL-Repo" ||
    !artifact.path ||
    !artifact.path.endsWith(".md") ||
    (expectedArtifactType !== undefined &&
      artifact.artifactType !== expectedArtifactType) ||
    (expectedClassification !== undefined &&
      artifact.classification !== expectedClassification)
  ) {
    throw slOwnershipError(artifact);
  }
  await slAssertRealPathInside(root, artifact.path);
  const absolutePath = slResolveInside(root, artifact.path);
  if (!(await slExists(absolutePath))) {
    throw slOwnershipError(artifact);
  }
  try {
    const content = await slReadContainedText(root, artifact.path);
    return slOwnedArtifactMarkdownSnapshot(artifact, content);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === slOwnershipError(artifact).message
    ) {
      throw error;
    }
    throw slOwnershipError(artifact);
  }
}

function slOwnedArtifactMarkdownSnapshot(
  artifact: SLRegistryArtifact,
  content: string,
): SLOwnedMarkdownSnapshot {
  const markdown = slParseMarkdown<Record<string, unknown>>(content);
  slAssertExpectedArtifactKind(artifact, markdown.frontmatter);
  if (
    markdown.frontmatter.id !== artifact.id ||
    markdown.frontmatter.schemaVersion !== 1 ||
    markdown.frontmatter.managedBy !== "SL-Repo" ||
    markdown.frontmatter.status !== artifact.status ||
    markdown.frontmatter.pinned !== artifact.pinned
  ) {
    throw slOwnershipError(artifact);
  }
  return {
    content,
    frontmatter: markdown.frontmatter,
    body: markdown.body,
  };
}

export async function slLoadUsageOwnershipSnapshots(
  root: string,
  registry: SLRegistry,
  events: SLUsageEvent[] = [],
): Promise<Map<string, SLOwnedMarkdownSnapshot>> {
  const snapshots = new Map<string, SLOwnedMarkdownSnapshot>();
  const eventArtifactIds = new Set(events.map((event) => event.artifactId));
  for (const artifact of registry.artifacts) {
    if (artifact.classification === "system" || artifact.status === "deleted") {
      continue;
    }
    if (
      eventArtifactIds.has(artifact.id) ||
      slLegacyCounter(artifact.hits) > 0 ||
      slLegacyCounter(artifact.retrievals) > 0 ||
      slLegacyCounter(artifact.notUsefulVotes) > 0
    ) {
      snapshots.set(
        artifact.id,
        await slReadOwnedArtifactMarkdown(root, artifact),
      );
      continue;
    }
    if (
      artifact.classification !== "evidence" ||
      !artifact.path?.endsWith(".md")
    ) {
      continue;
    }
    let content: string;
    let frontmatter: Record<string, unknown>;
    try {
      content = await slReadContainedText(root, artifact.path);
      frontmatter =
        slParseMarkdown<Record<string, unknown>>(content).frontmatter;
    } catch {
      continue;
    }
    if (
      slLegacyCounter(frontmatter.hits) > 0 ||
      slLegacyCounter(frontmatter.retrievals) > 0 ||
      slLegacyCounter(frontmatter.notUsefulVotes) > 0
    ) {
      snapshots.set(
        artifact.id,
        slOwnedArtifactMarkdownSnapshot(artifact, content),
      );
    }
  }
  return snapshots;
}

export function slCreateUsageEvent(
  input: SLCreateUsageEventInput,
): SLUsageApplicationEvent {
  const rawIdempotencyKey = input.idempotencyKey.trim();
  if (!rawIdempotencyKey) {
    throw new Error("idempotencyKey is required.");
  }
  const idempotencyHash = slHash(rawIdempotencyKey);
  const event: SLUsageApplicationEvent = {
    schemaVersion: 1,
    eventType: "usage",
    eventId: `SL-USE-${idempotencyHash.slice(0, 32).toUpperCase()}`,
    idempotencyKey: `sha256:${idempotencyHash}`,
    artifactId: input.artifactId,
    artifactVersion: slArtifactVersion(input.artifactContentHash),
    artifactContentHash: input.artifactContentHash,
    taskRunId: input.taskRunId,
    applicationId: input.applicationId,
    stage: input.stage,
    outcome: input.outcome,
    verifierType: input.verifierType,
    timestamp: input.timestamp,
    ...(input.evidenceRef ? { evidenceRef: input.evidenceRef } : {}),
    scope: slNormalizeScope(input.scope ?? SL_DEFAULT_SCOPE),
  };
  slValidateUsageEvent(event);
  return event;
}

export function slCreateLegacyUsageBaseline(
  artifact: SLRegistryArtifact,
  artifactContentHash: string,
): SLLegacyUsageBaselineEvent | undefined {
  const verifiedSuccessCount = Math.max(0, artifact.hits ?? 0);
  const verifiedFailureCount = Math.max(0, artifact.notUsefulVotes ?? 0);
  const retrievalCount = Math.max(
    0,
    artifact.retrievals ?? 0,
    verifiedSuccessCount + verifiedFailureCount,
  );
  if (
    retrievalCount === 0 &&
    verifiedSuccessCount === 0 &&
    verifiedFailureCount === 0
  ) {
    return undefined;
  }
  const applicationCount = retrievalCount;
  const unknownCount = Math.max(
    0,
    applicationCount - verifiedSuccessCount - verifiedFailureCount,
  );
  const artifactVersion = slArtifactVersion(artifactContentHash);
  const idempotencyHash = slHash(
    [
      "legacy-baseline",
      artifact.id,
      artifactVersion,
      retrievalCount,
      verifiedSuccessCount,
      verifiedFailureCount,
      artifact.lastRetrievedAt ?? "",
      artifact.lastSuccessfulUseAt ?? "",
    ].join(":"),
  );
  const timestamp =
    artifact.lastRetrievedAt ??
    artifact.lastSuccessfulUseAt ??
    artifact.lastVerifiedAt ??
    artifact.createdAt;
  const event: SLLegacyUsageBaselineEvent = {
    schemaVersion: 1,
    eventType: "legacy-baseline",
    eventId: `SL-USE-${idempotencyHash.slice(0, 32).toUpperCase()}`,
    idempotencyKey: `sha256:${idempotencyHash}`,
    artifactId: artifact.id,
    artifactVersion,
    artifactContentHash,
    taskRunId: "SL-legacy-migration",
    applicationId: "SL-legacy-migration",
    stage: "verified",
    outcome: "unknown",
    verifierType: "legacy-counter-migration",
    timestamp,
    scope: slNormalizeScope(artifact.scope ?? SL_DEFAULT_SCOPE),
    legacyCounts: {
      retrievalCount,
      applicationCount,
      verifiedSuccessCount,
      verifiedFailureCount,
      unknownCount,
    },
    ...(artifact.lastRetrievedAt
      ? { legacyLastRetrievedAt: artifact.lastRetrievedAt }
      : {}),
    ...(artifact.lastSuccessfulUseAt
      ? { legacyLastSuccessfulUseAt: artifact.lastSuccessfulUseAt }
      : {}),
  };
  slValidateUsageEvent(event);
  return event;
}

export function slValidateUsageEvent(event: SLUsageEvent): void {
  if (event.schemaVersion !== 1) {
    throw new Error("Unsupported SL usage event schemaVersion.");
  }
  if (!SL_EVENT_ID_PATTERN.test(event.eventId)) {
    throw new Error("eventId must use the SL-USE-<SHA256 prefix> format.");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(event.idempotencyKey)) {
    throw new Error("idempotencyKey must be a SHA-256 reference.");
  }
  if (
    event.eventId !==
    `SL-USE-${event.idempotencyKey.slice("sha256:".length, 39).toUpperCase()}`
  ) {
    throw new Error("eventId must match idempotencyKey.");
  }
  if (!["usage", "legacy-baseline"].includes(event.eventType)) {
    throw new Error("eventType must be usage or legacy-baseline.");
  }
  if (!SL_ARTIFACT_ID_PATTERN.test(event.artifactId)) {
    throw new Error("artifactId must be a valid SL artifact ID.");
  }
  if (!SL_CONTENT_HASH_PATTERN.test(event.artifactContentHash)) {
    throw new Error("artifactContentHash must be a lowercase SHA-256 hash.");
  }
  if (event.artifactVersion !== slArtifactVersion(event.artifactContentHash)) {
    throw new Error("artifactVersion must match artifactContentHash.");
  }
  slAssertUsageId("taskRunId", event.taskRunId);
  slAssertUsageId("applicationId", event.applicationId);
  slAssertUsageId("verifierType", event.verifierType);
  if (!["selected", "applied", "outcome", "verified"].includes(event.stage)) {
    throw new Error("stage is not supported.");
  }
  if (!["success", "failure", "partial", "unknown"].includes(event.outcome)) {
    throw new Error("outcome is not supported.");
  }
  slAssertTimestamp("timestamp", event.timestamp);
  if (event.evidenceRef) {
    slAssertEvidenceRef(event.evidenceRef);
  }
  if (event.scope) {
    const normalizedScope = slNormalizeScope(event.scope);
    if (slScopeKey(event.scope) !== slScopeKey(normalizedScope)) {
      throw new Error("scope must be normalized.");
    }
  }
  if (event.eventType === "legacy-baseline") {
    for (const [name, value] of Object.entries(event.legacyCounts)) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`legacyCounts.${name} must be a non-negative integer.`);
      }
    }
    if (event.legacyLastRetrievedAt) {
      slAssertTimestamp(
        "legacyLastRetrievedAt",
        event.legacyLastRetrievedAt,
      );
    }
    if (event.legacyLastSuccessfulUseAt) {
      slAssertTimestamp(
        "legacyLastSuccessfulUseAt",
        event.legacyLastSuccessfulUseAt,
      );
    }
    if (
      event.taskRunId !== "SL-legacy-migration" ||
      event.applicationId !== "SL-legacy-migration" ||
      event.stage !== "verified" ||
      event.outcome !== "unknown" ||
      event.verifierType !== "legacy-counter-migration" ||
      event.evidenceRef !== undefined
    ) {
      throw new Error("Legacy baseline identity and stage fields are invalid.");
    }
    if (
      event.legacyCounts.retrievalCount <
        event.legacyCounts.applicationCount ||
      event.legacyCounts.applicationCount <
        event.legacyCounts.verifiedSuccessCount +
          event.legacyCounts.verifiedFailureCount +
          event.legacyCounts.unknownCount
    ) {
      throw new Error("Legacy baseline counts are internally inconsistent.");
    }
  } else {
    if (
      (event.stage === "selected" || event.stage === "applied") &&
      (event.outcome !== "unknown" || event.verifierType !== "unverified")
    ) {
      throw new Error(
        "Selected and applied events must remain unverified with unknown outcome.",
      );
    }
    if (
      event.stage === "verified" &&
      ["none", "self-report", "self-reported", "unknown", "unverified"].includes(
        event.verifierType.toLowerCase(),
      )
    ) {
      throw new Error("Verified events require a trustworthy verifier type.");
    }
  }
}

export function slUsageEventPath(event: SLUsageEvent): string {
  const month = event.timestamp.slice(0, 7);
  if (event.scope) {
    if (event.scope.id === "repo" && event.scope.path === ".") {
      const shardHash = createHash("sha256")
        .update("repo\0.")
        .digest("hex")
        .slice(0, 12);
      return `${SL_PATHS.scopeRoot}/SL-repo-${shardHash}/SL-usage-events/${slArtifactShardName(event.artifactId)}/${month}/SL-usage-${event.eventId.slice("SL-USE-".length)}.json`;
    }
    const scopeEntry = slScopeCatalogEntry(event.scope);
    return `${scopeEntry.usageEventsPath}/${slArtifactShardName(event.artifactId)}/${month}/SL-usage-${event.eventId.slice("SL-USE-".length)}.json`;
  }
  return `${SL_PATHS.usageEvents}/${month}/SL-usage-${event.eventId.slice("SL-USE-".length)}.json`;
}

export async function slWriteUsageEvent(
  root: string,
  event: SLUsageEvent,
  dryRun: boolean,
): Promise<SLChange> {
  slValidateUsageEvent(event);
  const relativePath = slUsageEventPath(event);
  await slAssertRealPathInside(root, relativePath);
  const path = slResolveInside(root, relativePath);
  const content = `${JSON.stringify(event, null, 2)}\n`;
  if (await slExists(path)) {
    if (!(await slUsageEventMatches(path, event))) {
      throw new Error(`Immutable SL usage event collision: ${relativePath}`);
    }
    return {
      action: "skip",
      path: relativePath,
      detail: "idempotent event already recorded",
    };
  }
  if (dryRun) {
    return { action: "create", path: relativePath, detail: "planned" };
  }

  await mkdir(dirname(path), { recursive: true });
  try {
    const handle = await open(path, "wx");
    try {
      await handle.writeFile(content, "utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    if (!(await slUsageEventMatches(path, event))) {
      throw new Error(`Immutable SL usage event collision: ${relativePath}`);
    }
    return {
      action: "skip",
      path: relativePath,
      detail: "idempotent event already recorded",
    };
  }
  return { action: "create", path: relativePath, detail: "written" };
}

function slIdempotentEventContent(
  event: SLUsageApplicationEvent,
): Omit<SLUsageApplicationEvent, "timestamp"> {
  const { timestamp, ...content } = event;
  void timestamp;
  return Object.fromEntries(
    Object.entries(content).sort(([left], [right]) =>
      slCompareOrdinal(left, right),
    ),
  ) as Omit<SLUsageApplicationEvent, "timestamp">;
}

function slUsageEventsEquivalent(
  left: SLUsageEvent,
  right: SLUsageEvent,
): boolean {
  if (left.eventType !== right.eventType) {
    return false;
  }
  if (left.eventType === "usage" && right.eventType === "usage") {
    return (
      slCanonicalJson(slIdempotentEventContent(left)) ===
      slCanonicalJson(slIdempotentEventContent(right))
    );
  }
  return slCanonicalJson(left) === slCanonicalJson(right);
}

async function slUsageEventMatches(
  path: string,
  event: SLUsageEvent,
): Promise<boolean> {
  try {
    const existing = JSON.parse(await readFile(path, "utf8")) as SLUsageEvent;
    slValidateUsageEvent(existing);
    return slUsageEventsEquivalent(existing, event);
  } catch {
    return false;
  }
}

function slMergeUsageEvents(
  existingEvents: SLUsageEvent[],
  plannedEvents: SLUsageEvent[],
): SLUsageEvent[] {
  const byId = new Map(
    existingEvents.map((event) => [event.eventId, event]),
  );
  for (const event of plannedEvents) {
    if (!byId.has(event.eventId)) {
      byId.set(event.eventId, event);
    }
  }
  return [...byId.values()];
}

export async function slWriteUsageOperationEvent(
  root: string,
  event: SLUsageApplicationEvent,
  existingEvents: SLUsageEvent[],
  dryRun: boolean,
): Promise<SLChange> {
  const existing = existingEvents.find(
    (candidate): candidate is SLUsageApplicationEvent =>
      candidate.eventType === "usage" &&
      candidate.eventId === event.eventId,
  );
  if (!existing) {
    return slWriteUsageEvent(root, event, dryRun);
  }
  if (
    !slUsageEventsEquivalent(existing, event)
  ) {
    throw new Error(
      `Immutable SL usage event collision: ${slUsageEventPath(existing)}`,
    );
  }
  return {
    action: "skip",
    path: slUsageEventPath(existing),
    detail: "idempotent event already recorded",
  };
}

export async function slLoadUsageEvents(root: string): Promise<SLUsageEvent[]> {
  await slAssertRealPathInside(root, SL_PATHS.learningRoot);
  const legacyUsageRoot = slResolveInside(root, SL_PATHS.usageEvents);
  if (await slExists(legacyUsageRoot)) {
    await slAssertRealPathInside(root, SL_PATHS.usageEvents);
  }
  const catalog = await slLoadStateCatalog(root);
  for (const entry of catalog.scopes) {
    const usageRoot = slResolveInside(root, entry.usageEventsPath);
    if (await slExists(usageRoot)) {
      await slAssertRealPathInside(root, entry.usageEventsPath);
    }
  }
  const paths = await fg(
    [
      `${SL_PATHS.usageEvents}/**/*.json`,
      `${SL_PATHS.scopeRoot}/*/SL-usage-events/**/*.json`,
    ],
    {
      cwd: root,
      onlyFiles: true,
      followSymbolicLinks: false,
    },
  );
  const events: SLUsageEvent[] = [];
  for (const relativePath of paths
    .map(slNormalizePath)
    .sort(slCompareOrdinal)) {
    const eventPath = relativePath;
    await slAssertRealPathInside(root, eventPath);
    const event = await slReadJson<SLUsageEvent>(
      slResolveInside(root, eventPath),
    );
    slValidateUsageEvent(event);
    events.push(event);
  }
  return events;
}

function slUsageArtifactIdentity(
  artifact: SLRegistryArtifact,
  snapshot: SLOwnedMarkdownSnapshot,
  applicationScope?: SLScopeDescriptor,
): {
  artifactId: string;
  artifactVersion: string;
  artifactContentHash: string;
  scope: SLScopeDescriptor;
} {
  if (
    !["lesson", "instruction", "skill"].includes(artifact.artifactType) ||
    artifact.classification === "system" ||
    !SL_ACTIVE_STATUSES.has(artifact.status) ||
    !artifact.path
  ) {
    throw new Error(
      `Artifact ${artifact.id} is not an active lesson, instruction, or skill.`,
    );
  }
  const artifactContentHash = slArtifactUsageContentHash(
    snapshot.content,
  );
  return {
    artifactId: artifact.id,
    artifactContentHash,
    artifactVersion: slArtifactVersion(artifactContentHash),
    scope: slNormalizeScope(
      applicationScope ?? artifact.scope ?? SL_DEFAULT_SCOPE,
    ),
  };
}

function slApplicationEvents(
  events: SLUsageEvent[],
  applicationId: string,
): SLUsageApplicationEvent[] {
  return events.filter(
    (event): event is SLUsageApplicationEvent =>
      event.eventType === "usage" && event.applicationId === applicationId,
  );
}

function slAssertApplicationIdentity(
  events: SLUsageApplicationEvent[],
  identity: {
    artifactId: string;
    artifactVersion: string;
    artifactContentHash: string;
    taskRunId: string;
    applicationId: string;
    scope?: SLScopeDescriptor;
  },
): void {
  for (const event of events) {
    if (
      event.artifactId !== identity.artifactId ||
      event.artifactVersion !== identity.artifactVersion ||
      event.artifactContentHash !== identity.artifactContentHash ||
      event.taskRunId !== identity.taskRunId ||
      slScopeKey(event.scope ?? SL_DEFAULT_SCOPE) !==
        slScopeKey(identity.scope ?? SL_DEFAULT_SCOPE)
    ) {
      throw new Error(
        `Application ID ${identity.applicationId} is already bound to different usage identity data.`,
      );
    }
  }
}

function slAssertUniqueApplicationStages(
  events: SLUsageApplicationEvent[],
  applicationId: string,
): void {
  const stages = new Set<SLUsageStage>();
  for (const event of events) {
    if (stages.has(event.stage)) {
      throw new Error(
        `Application ID ${applicationId} already has duplicate ${event.stage} stages.`,
      );
    }
    stages.add(event.stage);
  }
}

function slAssertPlannedUsageEvents(
  existingEvents: SLUsageEvent[],
  plannedEvents: SLUsageApplicationEvent[],
): void {
  for (const planned of plannedEvents) {
    const existing = existingEvents.find(
      (candidate) =>
        candidate.eventId === planned.eventId ||
        candidate.idempotencyKey === planned.idempotencyKey,
    );
    if (existing && !slUsageEventsEquivalent(existing, planned)) {
      throw new Error(
        `Immutable SL usage event collision: ${slUsageEventPath(existing)}`,
      );
    }
  }
}

function slAssertStartApplicationRetry(
  existingEvents: SLUsageEvent[],
  selected: SLUsageApplicationEvent,
  applied: SLUsageApplicationEvent,
): void {
  const applicationEvents = slApplicationEvents(
    existingEvents,
    selected.applicationId,
  );
  if (applicationEvents.length === 0) {
    return;
  }
  slAssertApplicationIdentity(applicationEvents, {
    artifactId: selected.artifactId,
    artifactVersion: selected.artifactVersion,
    artifactContentHash: selected.artifactContentHash,
    taskRunId: selected.taskRunId,
    applicationId: selected.applicationId,
    ...(selected.scope ? { scope: selected.scope } : {}),
  });
  slAssertUniqueApplicationStages(applicationEvents, selected.applicationId);
  if (
    applicationEvents.some(
      (event) => event.stage !== "selected" && event.stage !== "applied",
    )
  ) {
    throw new Error(
      `Application ID ${selected.applicationId} has a conflicting lifecycle and cannot be restarted.`,
    );
  }
  const existingSelected = applicationEvents.find(
    (event) => event.stage === "selected",
  );
  const existingApplied = applicationEvents.find(
    (event) => event.stage === "applied",
  );
  if (
    !existingSelected ||
    !slUsageEventsEquivalent(existingSelected, selected) ||
    (existingApplied && !slUsageEventsEquivalent(existingApplied, applied))
  ) {
    throw new Error(
      `Application ID ${selected.applicationId} can only retry the exact selected and applied event identities.`,
    );
  }
  if (applicationEvents.length === 1 && !existingApplied) {
    return;
  }
  if (applicationEvents.length !== 2 || !existingApplied) {
    throw new Error(
      `Application ID ${selected.applicationId} has a conflicting lifecycle and cannot be restarted.`,
    );
  }
}

export function slAssertVoteApplicationMutation(
  existingEvents: SLUsageEvent[],
  event: SLUsageApplicationEvent,
): void {
  const applicationEvents = slApplicationEvents(
    existingEvents,
    event.applicationId,
  );
  if (applicationEvents.length === 0) {
    slAssertPlannedUsageEvents(existingEvents, [event]);
    return;
  }
  slAssertApplicationIdentity(applicationEvents, {
    artifactId: event.artifactId,
    artifactVersion: event.artifactVersion,
    artifactContentHash: event.artifactContentHash,
    taskRunId: event.taskRunId,
    applicationId: event.applicationId,
    ...(event.scope ? { scope: event.scope } : {}),
  });
  slAssertUniqueApplicationStages(applicationEvents, event.applicationId);
  slAssertPlannedUsageEvents(existingEvents, [event]);

  const existingVerified = applicationEvents.find(
    (candidate) => candidate.stage === "verified",
  );
  if (existingVerified) {
    if (!slUsageEventsEquivalent(existingVerified, event)) {
      throw new Error(
        `Application ID ${event.applicationId} already has a different verified stage.`,
      );
    }
    return;
  }

  const selected = applicationEvents.find(
    (candidate) => candidate.stage === "selected",
  );
  const applied = applicationEvents.find(
    (candidate) => candidate.stage === "applied",
  );
  if ((selected && !applied) || (!selected && applied)) {
    throw new Error(
      `Application ID ${event.applicationId} has incompatible usage stages for voting.`,
    );
  }
  const outcome = applicationEvents.find(
    (candidate) => candidate.stage === "outcome",
  );
  if (outcome && outcome.outcome !== event.outcome) {
    throw new Error(
      `Application ID ${event.applicationId} already has a conflicting outcome.`,
    );
  }
  if (
    applicationEvents.some(
      (candidate) =>
        !["selected", "applied", "outcome"].includes(candidate.stage),
    )
  ) {
    throw new Error(
      `Application ID ${event.applicationId} has incompatible usage stages for voting.`,
    );
  }
}

export async function slStartUsage(
  root: string,
  artifactId: string,
  options: SLStartUsageOptions = {},
): Promise<SLStartUsageResult> {
  return slWithRepositoryMutationLock(root, () =>
    slStartUsageUnlocked(root, artifactId, options),
    { dryRun: options.dryRun ?? false },
  );
}

async function slStartUsageUnlocked(
  root: string,
  artifactId: string,
  options: SLStartUsageOptions,
): Promise<SLStartUsageResult> {
  const registry = await slLoadRegistry(root);
  const artifact = slFindArtifact(registry, artifactId);
  const snapshot = await slReadOwnedArtifactMarkdown(root, artifact);
  const identity = slUsageArtifactIdentity(
    artifact,
    snapshot,
    options.scope,
  );
  const applicationId = options.applicationId ?? `usage-${randomUUID()}`;
  const taskRunId = options.taskRunId ?? applicationId;
  const timestamp = (options.now ?? new Date()).toISOString();
  const idempotencyBase =
    options.idempotencyKey ??
    `usage-start:${artifactId}:${identity.artifactVersion}:${applicationId}`;
  const existingEvents = await slLoadUsageEvents(root);
  slAssertApplicationIdentity(
    slApplicationEvents(existingEvents, applicationId),
    { ...identity, taskRunId, applicationId },
  );
  const selected = slCreateUsageEvent({
    ...identity,
    taskRunId,
    applicationId,
    stage: "selected",
    outcome: "unknown",
    verifierType: "unverified",
    timestamp,
    idempotencyKey: `${idempotencyBase}:selected`,
  });
  const applied = slCreateUsageEvent({
    ...identity,
    taskRunId,
    applicationId,
    stage: "applied",
    outcome: "unknown",
    verifierType: "unverified",
    timestamp,
    idempotencyKey: `${idempotencyBase}:applied`,
  });
  slAssertStartApplicationRetry(existingEvents, selected, applied);
  slAssertPlannedUsageEvents(existingEvents, [selected, applied]);
  const projectedEvents = slMergeUsageEvents(existingEvents, [
    selected,
    applied,
  ]);
  await slLoadUsageOwnershipSnapshots(root, registry, projectedEvents);
  const plannedEvents = [selected, applied];
  const preflightChanges: SLChange[] = [];
  for (const event of plannedEvents) {
    preflightChanges.push(
      await slWriteUsageOperationEvent(
        root,
        event,
        existingEvents,
        true,
      ),
    );
  }
  const changes: SLChange[] = options.dryRun ? preflightChanges : [];
  if (!options.dryRun) {
    for (const event of plannedEvents) {
      changes.push(
        await slWriteUsageOperationEvent(
          root,
          event,
          existingEvents,
          false,
        ),
      );
    }
  }
  await slSynchronizeUsageProjectionUnlocked(
    root,
    options.dryRun ?? false,
    changes,
    projectedEvents,
  );
  return {
    ...identity,
    taskRunId,
    applicationId,
    receiptId: applied.eventId,
    eventIds: {
      selected: selected.eventId,
      applied: applied.eventId,
    },
    events: {
      selected,
      applied,
    },
    changes,
  };
}

function slResolveApplicationReference(
  events: SLUsageEvent[],
  reference: string,
): SLUsageApplicationEvent[] {
  const receipt = events.find(
    (event) => event.eventType === "usage" && event.eventId === reference,
  );
  const applicationId =
    receipt?.applicationId ??
    (events.some(
      (event) =>
        event.eventType === "usage" && event.applicationId === reference,
    )
      ? reference
      : undefined);
  if (!applicationId) {
    throw new Error(`Usage application or receipt not found: ${reference}`);
  }
  return slApplicationEvents(events, applicationId);
}

export async function slFinishUsage(
  root: string,
  reference: string,
  options: SLFinishUsageOptions,
): Promise<SLFinishUsageResult> {
  return slWithRepositoryMutationLock(root, () =>
    slFinishUsageUnlocked(root, reference, options),
    { dryRun: options.dryRun ?? false },
  );
}

async function slFinishUsageUnlocked(
  root: string,
  reference: string,
  options: SLFinishUsageOptions,
): Promise<SLFinishUsageResult> {
  const events = await slLoadUsageEvents(root);
  await slLoadUsageOwnershipSnapshots(
    root,
    await slLoadRegistry(root),
    events,
  );
  const applicationEvents = slResolveApplicationReference(events, reference);
  const first = applicationEvents[0];
  if (!first) {
    throw new Error(`Usage application or receipt not found: ${reference}`);
  }
  if (
    !applicationEvents.some((event) =>
      ["selected", "applied"].includes(event.stage),
    ) ||
    !applicationEvents.some((event) => event.stage === "applied")
  ) {
    throw new Error(
      `Usage application ${first.applicationId} has not reached the applied stage.`,
    );
  }
  slAssertApplicationIdentity(applicationEvents, {
    artifactId: first.artifactId,
    artifactVersion: first.artifactVersion,
    artifactContentHash: first.artifactContentHash,
    taskRunId: first.taskRunId,
    applicationId: first.applicationId,
    scope: slNormalizeScope(first.scope ?? SL_DEFAULT_SCOPE),
  });
  slAssertUniqueApplicationStages(applicationEvents, first.applicationId);

  const verified = options.verified ?? false;
  if (verified && !options.verifierType) {
    throw new Error(
      "--verified requires an explicit --verifier-type declaration.",
    );
  }
  const verifierType = options.verifierType ?? "unverified";
  if (
    verified &&
    [
      "none",
      "self-report",
      "self-reported",
      "unknown",
      "unverified",
    ].includes(verifierType.toLowerCase())
  ) {
    throw new Error(
      "A verified outcome requires a trustworthy verifier type.",
    );
  }
  const stage: SLUsageStage = verified ? "verified" : "outcome";
  const idempotencyKey =
    options.idempotencyKey ??
    [
      "usage-finish",
      first.artifactId,
      first.artifactVersion,
      first.applicationId,
      stage,
      options.outcome,
      verifierType,
      options.evidenceRef ?? "",
    ].join(":");
  const event = slCreateUsageEvent({
    artifactId: first.artifactId,
    artifactContentHash: first.artifactContentHash,
    taskRunId: first.taskRunId,
    applicationId: first.applicationId,
    stage,
    outcome: options.outcome,
    verifierType,
    timestamp: (options.now ?? new Date()).toISOString(),
    idempotencyKey,
    ...(options.evidenceRef ? { evidenceRef: options.evidenceRef } : {}),
    scope: slNormalizeScope(first.scope ?? SL_DEFAULT_SCOPE),
  });
  const otherTerminalEvents = applicationEvents.filter(
    (candidate) =>
      ["outcome", "verified"].includes(candidate.stage) &&
      candidate.eventId !== event.eventId,
  );
  if (
    otherTerminalEvents.some(
      (candidate) => candidate.outcome !== options.outcome,
    )
  ) {
    throw new Error(
      `Usage application ${first.applicationId} already has a conflicting outcome.`,
    );
  }
  if (
    otherTerminalEvents.some((candidate) => candidate.stage === "verified")
  ) {
    throw new Error(
      `Usage application ${first.applicationId} already has a verified outcome.`,
    );
  }
  if (
    stage === "outcome" &&
    otherTerminalEvents.some((candidate) => candidate.stage === "outcome")
  ) {
    throw new Error(
      `Usage application ${first.applicationId} already has an unverified outcome.`,
    );
  }

  const change = await slWriteUsageOperationEvent(
    root,
    event,
    events,
    options.dryRun ?? false,
  );
  const changes: SLChange[] = [change];
  await slSynchronizeUsageProjectionUnlocked(
    root,
    options.dryRun ?? false,
    changes,
    slMergeUsageEvents(events, [event]),
  );
  return {
    artifactId: first.artifactId,
    artifactVersion: first.artifactVersion,
    artifactContentHash: first.artifactContentHash,
    taskRunId: first.taskRunId,
    applicationId: first.applicationId,
    receiptId: event.eventId,
    outcome: options.outcome,
    verified,
    verifierType,
    event,
    change,
    changes,
  };
}

export function slProjectUsageEvents(
  inputEvents: SLUsageEvent[],
): SLUsageProjection[] {
  const eventsById = new Map<string, SLUsageEvent>();
  for (const event of [...inputEvents].sort((left, right) =>
    slCompareOrdinal(left.eventId, right.eventId),
  )) {
    slValidateUsageEvent(event);
    const existing = eventsById.get(event.eventId);
    if (existing) {
      if (!slUsageEventsEquivalent(existing, event)) {
        throw new Error(
          `Conflicting usage events share eventId ${event.eventId}.`,
        );
      }
      if (event.timestamp < existing.timestamp) {
        eventsById.set(event.eventId, event);
      }
      continue;
    }
    eventsById.set(event.eventId, event);
  }

  const eventsByIdempotencyKey = new Map<string, SLUsageEvent>();
  for (const event of [...eventsById.values()].sort((left, right) =>
    slCompareOrdinal(left.eventId, right.eventId),
  )) {
    if (!eventsByIdempotencyKey.has(event.idempotencyKey)) {
      eventsByIdempotencyKey.set(event.idempotencyKey, event);
    }
  }

  const grouped = new Map<string, SLUsageEvent[]>();
  for (const event of eventsByIdempotencyKey.values()) {
    const key = `${slScopeKey(event.scope ?? SL_DEFAULT_SCOPE)}\0${event.artifactId}\0${event.artifactVersion}`;
    const events = grouped.get(key) ?? [];
    events.push(event);
    grouped.set(key, events);
  }

  const projections: SLUsageProjection[] = [];
  for (const events of grouped.values()) {
    events.sort(
      (left, right) =>
        slCompareOrdinal(left.timestamp, right.timestamp) ||
        slCompareOrdinal(left.eventId, right.eventId),
    );
    const first = events[0];
    if (!first) {
      continue;
    }
    let baselineRetrievalCount = 0;
    let baselineApplicationCount = 0;
    let baselineVerifiedSuccessCount = 0;
    let baselineVerifiedFailureCount = 0;
    let baselineUnknownCount = 0;
    let baselineOutcomeSuccessCount = 0;
    let baselineOutcomeFailureCount = 0;
    let baselineOutcomeUnknownCount = 0;
    let lastRetrievedAt: string | undefined;
    let lastAppliedAt: string | undefined;
    let lastVerifiedSuccessAt: string | undefined;
    let lastVerifiedFailureAt: string | undefined;
    const applications = new Map<string, SLUsageApplicationEvent[]>();

    for (const event of events) {
      if (event.eventType === "legacy-baseline") {
        baselineRetrievalCount = Math.max(
          baselineRetrievalCount,
          event.legacyCounts.retrievalCount,
        );
        baselineApplicationCount = Math.max(
          baselineApplicationCount,
          event.legacyCounts.applicationCount,
        );
        baselineVerifiedSuccessCount = Math.max(
          baselineVerifiedSuccessCount,
          event.legacyCounts.verifiedSuccessCount,
        );
        baselineVerifiedFailureCount = Math.max(
          baselineVerifiedFailureCount,
          event.legacyCounts.verifiedFailureCount,
        );
        baselineUnknownCount = Math.max(
          baselineUnknownCount,
          event.legacyCounts.unknownCount,
        );
        baselineOutcomeSuccessCount = Math.max(
          baselineOutcomeSuccessCount,
          event.legacyCounts.verifiedSuccessCount,
        );
        baselineOutcomeFailureCount = Math.max(
          baselineOutcomeFailureCount,
          event.legacyCounts.verifiedFailureCount,
        );
        baselineOutcomeUnknownCount = Math.max(
          baselineOutcomeUnknownCount,
          event.legacyCounts.unknownCount,
        );
        lastRetrievedAt = slMaxTimestamp(
          lastRetrievedAt,
          event.legacyLastRetrievedAt ?? event.timestamp,
        );
        lastVerifiedSuccessAt = slMaxTimestamp(
          lastVerifiedSuccessAt,
          event.legacyLastSuccessfulUseAt,
        );
        continue;
      }
      const applicationEvents = applications.get(event.applicationId) ?? [];
      applicationEvents.push(event);
      applications.set(event.applicationId, applicationEvents);
    }

    let retrievalCount = baselineRetrievalCount;
    let applicationCount = baselineApplicationCount;
    let verifiedSuccessCount = baselineVerifiedSuccessCount;
    let verifiedFailureCount = baselineVerifiedFailureCount;
    let unknownCount = baselineUnknownCount;
    let outcomeSuccessCount = baselineOutcomeSuccessCount;
    let outcomeFailureCount = baselineOutcomeFailureCount;
    let outcomePartialCount = 0;
    let outcomeUnknownCount = baselineOutcomeUnknownCount;

    for (const applicationEvents of applications.values()) {
      retrievalCount += 1;
      const selectedEvents = applicationEvents.filter(
        (event) => event.stage === "selected",
      );
      for (const event of selectedEvents.length > 0
        ? selectedEvents
        : applicationEvents.slice(0, 1)) {
        lastRetrievedAt = slMaxTimestamp(lastRetrievedAt, event.timestamp);
      }
      const appliedEvents = applicationEvents.filter((event) =>
        ["applied", "outcome", "verified"].includes(event.stage),
      );
      if (appliedEvents.length === 0) {
        continue;
      }
      applicationCount += 1;
      const explicitAppliedEvents = appliedEvents.filter(
        (event) => event.stage === "applied",
      );
      for (const event of explicitAppliedEvents.length > 0
        ? explicitAppliedEvents
        : appliedEvents.slice(0, 1)) {
        lastAppliedAt = slMaxTimestamp(lastAppliedAt, event.timestamp);
      }
      const verifiedEvents = applicationEvents.filter(
        (event) => event.stage === "verified",
      );
      const terminalEvents = applicationEvents.filter((event) =>
        ["outcome", "verified"].includes(event.stage),
      );
      const terminalOutcomes = new Set(
        terminalEvents.map((event) => event.outcome),
      );
      if (terminalEvents.length > 0) {
        if (terminalOutcomes.size === 1 && terminalOutcomes.has("success")) {
          outcomeSuccessCount += 1;
        } else if (
          terminalOutcomes.size === 1 &&
          terminalOutcomes.has("failure")
        ) {
          outcomeFailureCount += 1;
        } else if (
          terminalOutcomes.size === 1 &&
          terminalOutcomes.has("partial")
        ) {
          outcomePartialCount += 1;
        } else {
          outcomeUnknownCount += 1;
        }
      }
      const verifiedOutcomes = new Set(
        verifiedEvents.map((event) => event.outcome),
      );
      if (verifiedOutcomes.size === 1 && verifiedOutcomes.has("success")) {
        verifiedSuccessCount += 1;
        for (const event of verifiedEvents) {
          lastVerifiedSuccessAt = slMaxTimestamp(
            lastVerifiedSuccessAt,
            event.timestamp,
          );
        }
      } else if (
        verifiedOutcomes.size === 1 &&
        verifiedOutcomes.has("failure")
      ) {
        verifiedFailureCount += 1;
        for (const event of verifiedEvents) {
          lastVerifiedFailureAt = slMaxTimestamp(
            lastVerifiedFailureAt,
            event.timestamp,
          );
        }
      } else {
        unknownCount += 1;
      }
    }

    retrievalCount = Math.max(retrievalCount, applicationCount);
    applicationCount = Math.max(
      applicationCount,
      verifiedSuccessCount + verifiedFailureCount + unknownCount,
    );
    const verifiedDenominator =
      verifiedSuccessCount + verifiedFailureCount;
    const outcomeCount =
      outcomeSuccessCount +
      outcomeFailureCount +
      outcomePartialCount +
      outcomeUnknownCount;
    const outcomeResolvedCount =
      outcomeSuccessCount + outcomeFailureCount + outcomePartialCount;
    projections.push({
      scope: slNormalizeScope(first.scope ?? SL_DEFAULT_SCOPE),
      artifactId: first.artifactId,
      artifactVersion: first.artifactVersion,
      artifactContentHash: first.artifactContentHash,
      retrievalCount,
      applicationCount,
      applicationRate:
        retrievalCount === 0 ? null : applicationCount / retrievalCount,
      outcomeCount,
      outcomeSuccessCount,
      outcomeFailureCount,
      outcomePartialCount,
      outcomeUnknownCount,
      outcomeSuccessRate:
        outcomeResolvedCount === 0
          ? null
          : outcomeSuccessCount / outcomeResolvedCount,
      verifiedCount: verifiedDenominator,
      resolvedCount: verifiedDenominator,
      verifiedSuccessCount,
      verifiedFailureCount,
      unknownCount,
      verifiedSuccessRate:
        verifiedDenominator === 0
          ? null
          : verifiedSuccessCount / verifiedDenominator,
      ...(lastRetrievedAt ? { lastRetrievedAt } : {}),
      ...(lastAppliedAt ? { lastAppliedAt } : {}),
      ...(lastVerifiedSuccessAt ? { lastVerifiedSuccessAt } : {}),
      ...(lastVerifiedFailureAt ? { lastVerifiedFailureAt } : {}),
    });
  }

  return projections.sort(
    (left, right) =>
      slCompareOrdinal(slScopeKey(left.scope), slScopeKey(right.scope)) ||
      slCompareOrdinal(left.artifactId, right.artifactId) ||
      slCompareOrdinal(left.artifactVersion, right.artifactVersion),
  );
}

function slLegacyCounter(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

async function slLegacyBaselineArtifact(
  artifact: SLRegistryArtifact,
  snapshot: SLOwnedMarkdownSnapshot,
): Promise<SLRegistryArtifact> {
  return {
    ...artifact,
    hits: Math.max(
      artifact.hits ?? 0,
      slLegacyCounter(snapshot.frontmatter.hits),
    ),
    retrievals: Math.max(
      artifact.retrievals ?? 0,
      slLegacyCounter(snapshot.frontmatter.retrievals),
    ),
    notUsefulVotes: Math.max(
      artifact.notUsefulVotes ?? 0,
      slLegacyCounter(snapshot.frontmatter.notUsefulVotes),
    ),
  };
}

async function slCurrentUsageProjection(
  artifact: SLRegistryArtifact,
  projections: SLUsageProjection[],
  ownershipSnapshots: Map<string, SLOwnedMarkdownSnapshot>,
): Promise<SLUsageProjection | undefined> {
  if (
    artifact.classification === "system" ||
    !artifact.path ||
    !["lesson", "instruction", "skill"].includes(artifact.artifactType) ||
    !ownershipSnapshots.has(artifact.id)
  ) {
    return undefined;
  }
  const artifactProjections = projections.filter(
    (projection) =>
      projection.artifactId === artifact.id &&
      slScopeKey(projection.scope) ===
        slScopeKey(artifact.scope ?? SL_DEFAULT_SCOPE),
  );
  if (artifactProjections.length === 0) {
    return undefined;
  }
  const snapshot = ownershipSnapshots.get(artifact.id);
  if (!snapshot) {
    return undefined;
  }
  const artifactContentHash = slArtifactUsageContentHash(
    snapshot.content,
  );
  const artifactVersion = slArtifactVersion(artifactContentHash);
  return (
    artifactProjections.find(
      (projection) =>
        projection.artifactVersion === artifactVersion,
    ) ?? {
      artifactId: artifact.id,
      artifactVersion,
      artifactContentHash,
      retrievalCount: 0,
      applicationCount: 0,
      applicationRate: null,
      outcomeCount: 0,
      outcomeSuccessCount: 0,
      outcomeFailureCount: 0,
      outcomePartialCount: 0,
      outcomeUnknownCount: 0,
      outcomeSuccessRate: null,
      verifiedCount: 0,
      resolvedCount: 0,
      verifiedSuccessCount: 0,
      verifiedFailureCount: 0,
      unknownCount: 0,
      verifiedSuccessRate: null,
      scope: slNormalizeScope(artifact.scope ?? SL_DEFAULT_SCOPE),
    }
  );
}

function slCurrentVersionLastVerifiedSuccessAt(
  artifact: SLRegistryArtifact,
  projections: SLUsageProjection[],
  ownershipSnapshots: Map<string, SLOwnedMarkdownSnapshot>,
): string | undefined {
  if (
    artifact.classification === "system" ||
    !artifact.path ||
    !["lesson", "instruction", "skill"].includes(artifact.artifactType)
  ) {
    return undefined;
  }
  const snapshot = ownershipSnapshots.get(artifact.id);
  if (!snapshot) {
    return undefined;
  }
  const artifactVersion = slArtifactVersion(
    slArtifactUsageContentHash(snapshot.content),
  );
  let latest: string | undefined;
  for (const projection of projections) {
    if (
      projection.artifactId === artifact.id &&
      projection.artifactVersion === artifactVersion
    ) {
      latest = slMaxTimestamp(
        latest,
        projection.lastVerifiedSuccessAt,
      );
    }
  }
  return latest;
}

function slDerivedEvidenceStatus(
  artifact: SLRegistryArtifact,
  projection: SLUsageProjection | undefined,
  lastVerifiedSuccessAt: string | undefined,
): SLRegistryArtifact["status"] {
  if (
    ["promoted", "superseded", "quarantined", "deleted"].includes(
      artifact.status,
    )
  ) {
    return artifact.status;
  }
  if (
    artifact.status === "stale" &&
    (
      !lastVerifiedSuccessAt ||
      !artifact.staleAt ||
      lastVerifiedSuccessAt <= artifact.staleAt
    )
  ) {
    return "stale";
  }
  if (!projection) {
    return artifact.status === "stale" ? "raw" : artifact.status;
  }
  if (projection.verifiedSuccessCount >= 3) {
    return "promotion-candidate";
  }
  if (projection.verifiedSuccessCount >= 2) {
    return "distilled";
  }
  return "raw";
}

function slDerivedPromotedStatus(
  artifact: SLRegistryArtifact,
  lastVerifiedSuccessAt: string | undefined,
): SLRegistryArtifact["status"] {
  const inactiveAt =
    artifact.status === "stale"
      ? artifact.staleAt
      : artifact.status === "quarantined"
        ? artifact.quarantinedAt
        : undefined;
  if (
    !["stale", "quarantined"].includes(artifact.status) ||
    !lastVerifiedSuccessAt ||
    !inactiveAt ||
    lastVerifiedSuccessAt <= inactiveAt
  ) {
    return artifact.status;
  }
  return "probation";
}

export async function slApplyUsageProjection(
  root: string,
  registry: SLRegistry,
  events: SLUsageEvent[],
  ownershipSnapshots?: Map<string, SLOwnedMarkdownSnapshot>,
): Promise<void> {
  const snapshots =
    ownershipSnapshots ??
    (await slLoadUsageOwnershipSnapshots(root, registry, events));
  const projections = slProjectUsageEvents(events);
  for (const artifact of registry.artifacts) {
    const lastVerifiedSuccessAt =
      slCurrentVersionLastVerifiedSuccessAt(
        artifact,
        projections,
        snapshots,
      );
    const projection = await slCurrentUsageProjection(
      artifact,
      projections,
      snapshots,
    );
    if (!projection) {
      if (artifact.status === "deleted") {
        continue;
      }
      delete artifact.usageProjection;
      delete artifact.lastRetrievedAt;
    } else {
      artifact.usageProjection = projection;
      if (projection.lastRetrievedAt) {
        artifact.lastRetrievedAt = projection.lastRetrievedAt;
      } else {
        delete artifact.lastRetrievedAt;
      }
    }
    if (lastVerifiedSuccessAt) {
      artifact.lastSuccessfulUseAt = lastVerifiedSuccessAt;
    } else {
      delete artifact.lastSuccessfulUseAt;
    }

    const nextStatus =
      artifact.classification === "evidence"
        ? slDerivedEvidenceStatus(
            artifact,
            projection,
            lastVerifiedSuccessAt,
          )
        : slDerivedPromotedStatus(
            artifact,
            lastVerifiedSuccessAt,
          );
    if (artifact.status !== nextStatus) {
      artifact.status = nextStatus;
      if (
        artifact.classification === "promoted" &&
        nextStatus === "probation"
      ) {
        delete artifact.promotionEvaluation;
        delete artifact.activatedAt;
        delete artifact.quarantinedAt;
        delete artifact.deleteEligibleAt;
      }
      if (nextStatus !== "stale") {
        delete artifact.staleAt;
        delete artifact.forgetReason;
        delete artifact.previousStatus;
      }
    }
  }
}

async function slMoveReactivatedPromotionToProbation(
  root: string,
  registry: SLRegistry,
  artifact: SLRegistryArtifact,
  sourcePath: string,
  snapshot: SLOwnedMarkdownSnapshot,
  dryRun: boolean,
  changes: SLChange[],
): Promise<() => Promise<void>> {
  const targetPath =
    artifact.promotionTargetPath ?? artifact.originalPath ?? sourcePath;
  const probationPath = slPromotedProbationPath(artifact, targetPath);
  snapshot.frontmatter.status = "probation";
  const rollback = await slRewriteAndMovePromotionToProbation(
    root,
    registry,
    artifact,
    sourcePath,
    probationPath,
    snapshot.content,
    slStringifyMarkdown(snapshot.frontmatter, snapshot.body),
    dryRun,
    changes,
  );
  artifact.path = probationPath;
  artifact.promotionTargetPath = targetPath;
  delete artifact.originalPath;
  return rollback;
}

export async function slSynchronizeUsageProjectionUnlocked(
  root: string,
  dryRun: boolean,
  changes: SLChange[] = [],
  suppliedEvents?: SLUsageEvent[],
): Promise<SLRegistry> {
  const registry = await slLoadRegistry(root);
  const originalRegistry = structuredClone(registry);
  const events = suppliedEvents
    ? [...suppliedEvents]
    : await slLoadUsageEvents(root);
  const ownershipSnapshots = await slLoadUsageOwnershipSnapshots(
    root,
    registry,
    events,
  );
  const baselineArtifactIds = new Set(
    events
      .filter(
        (event): event is SLLegacyUsageBaselineEvent =>
          event.eventType === "legacy-baseline",
      )
      .map((event) => event.artifactId),
  );

  for (const artifact of registry.artifacts) {
    if (
      artifact.classification !== "evidence" ||
      baselineArtifactIds.has(artifact.id) ||
      !artifact.path
    ) {
      continue;
    }
    const snapshot = ownershipSnapshots.get(artifact.id);
    if (!snapshot) {
      continue;
    }
    const baselineArtifact = await slLegacyBaselineArtifact(
      artifact,
      snapshot,
    );
    if (
      (baselineArtifact.hits ?? 0) === 0 &&
      (baselineArtifact.retrievals ?? 0) === 0 &&
      (baselineArtifact.notUsefulVotes ?? 0) === 0
    ) {
      continue;
    }
    const artifactContentHash = slArtifactUsageContentHash(
      snapshot.content,
    );
    const baseline = slCreateLegacyUsageBaseline(
      baselineArtifact,
      artifactContentHash,
    );
    if (!baseline) {
      continue;
    }
    changes.push(await slWriteUsageEvent(root, baseline, dryRun));
    events.push(baseline);
    baselineArtifactIds.add(artifact.id);
  }

  const previousStatuses = new Map(
    registry.artifacts.map((artifact) => [artifact.id, artifact.status]),
  );
  const previousPaths = new Map(
    registry.artifacts.map((artifact) => [artifact.id, artifact.path]),
  );
  await slApplyUsageProjection(
    root,
    registry,
    events,
    ownershipSnapshots,
  );
  const reactivations: Array<{
    artifact: SLRegistryArtifact;
    previousPath: string;
    snapshot: SLOwnedMarkdownSnapshot;
    probationPath: string;
  }> = [];
  for (const artifact of registry.artifacts) {
    const previousStatus = previousStatuses.get(artifact.id);
    const previousPath = previousPaths.get(artifact.id);
    if (
      artifact.classification !== "promoted" ||
      artifact.status !== "probation" ||
      (previousStatus !== "stale" && previousStatus !== "quarantined") ||
      !previousPath
    ) {
      continue;
    }
    const snapshot = ownershipSnapshots.get(artifact.id);
    if (!snapshot) {
      throw slOwnershipError(artifact);
    }
    const targetPath =
      artifact.promotionTargetPath ?? artifact.originalPath ?? previousPath;
    reactivations.push({
      artifact,
      previousPath,
      snapshot,
      probationPath: slPromotedProbationPath(artifact, targetPath),
    });
  }
  for (const reactivation of reactivations) {
    await slPreflightPromotedProbationDestination(
      root,
      registry,
      reactivation.artifact,
      reactivation.previousPath,
      reactivation.probationPath,
    );
  }

  const relocatedPromotions = new Set<string>();
  const rollbacks: Array<() => Promise<void>> = [];
  let registrySaved = false;
  try {
    for (const reactivation of reactivations) {
      rollbacks.push(
        await slMoveReactivatedPromotionToProbation(
          root,
          registry,
          reactivation.artifact,
          reactivation.previousPath,
          reactivation.snapshot,
          dryRun,
          changes,
        ),
      );
      relocatedPromotions.add(reactivation.artifact.id);
    }
    for (const artifact of registry.artifacts) {
      if (
        !artifact.path?.endsWith(".md") ||
        relocatedPromotions.has(artifact.id) ||
        previousStatuses.get(artifact.id) === artifact.status ||
        !(await slExists(slResolveInside(root, artifact.path)))
      ) {
        continue;
      }
      const snapshot = ownershipSnapshots.get(artifact.id);
      if (!snapshot) {
        throw slOwnershipError(artifact);
      }
      snapshot.frontmatter.status = artifact.status;
      await slWriteText(
        root,
        artifact.path,
        slStringifyMarkdown(snapshot.frontmatter, snapshot.body),
        dryRun,
        changes,
      );
    }
    await slSaveRegistry(root, registry, dryRun, changes);
    registrySaved = !dryRun;
    await slWriteIndex(
      root,
      registry,
      dryRun,
      changes,
      slProjectUsageEvents(events),
    );
    return registry;
  } catch (error) {
    if (!dryRun) {
      for (const rollback of [...rollbacks].reverse()) {
        await rollback().catch(() => undefined);
      }
      if (registrySaved) {
        await slSaveRegistry(root, originalRegistry, false, []).catch(
          () => undefined,
        );
        await slWriteIndex(root, originalRegistry, false, []).catch(
          () => undefined,
        );
      }
    }
    throw error;
  }
}

export async function slSynchronizeUsageProjection(
  root: string,
  dryRun: boolean,
  changes: SLChange[] = [],
  suppliedEvents?: SLUsageEvent[],
): Promise<SLRegistry> {
  return slWithRepositoryMutationLock(root, () =>
    slSynchronizeUsageProjectionUnlocked(
      root,
      dryRun,
      changes,
      suppliedEvents,
    ),
    { dryRun },
  );
}

export async function slProjectUsage(
  root: string,
  artifactId?: string,
  scope?: SLScopeDescriptor,
): Promise<SLUsageProjection[]> {
  const projections = slProjectUsageEvents(await slLoadUsageEvents(root));
  return projections.filter(
    (projection) =>
      (!artifactId || projection.artifactId === artifactId) &&
      (!scope ||
        slScopeKey(projection.scope) ===
          slScopeKey(slNormalizeScope(scope))),
  );
}

function slRate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function slAggregateUsageByScope(
  projections: SLUsageProjection[],
): SLUsageScopeAggregate[] {
  const aggregates = new Map<string, SLUsageScopeAggregate>();
  for (const projection of projections) {
    const scope = slNormalizeScope(projection.scope);
    const key = slScopeKey(scope);
    const aggregate = aggregates.get(key) ?? {
      scope,
      retrievalCount: 0,
      applicationCount: 0,
      outcomeCount: 0,
      outcomeSuccessCount: 0,
      outcomeFailureCount: 0,
      outcomePartialCount: 0,
      outcomeUnknownCount: 0,
      verifiedCount: 0,
      verifiedSuccessCount: 0,
      verifiedFailureCount: 0,
      applicationRate: null,
      outcomeSuccessRate: null,
      verifiedSuccessRate: null,
    };
    aggregate.retrievalCount += projection.retrievalCount;
    aggregate.applicationCount += projection.applicationCount;
    aggregate.outcomeCount += projection.outcomeCount;
    aggregate.outcomeSuccessCount += projection.outcomeSuccessCount;
    aggregate.outcomeFailureCount += projection.outcomeFailureCount;
    aggregate.outcomePartialCount += projection.outcomePartialCount;
    aggregate.outcomeUnknownCount += projection.outcomeUnknownCount;
    aggregate.verifiedCount += projection.verifiedCount;
    aggregate.verifiedSuccessCount += projection.verifiedSuccessCount;
    aggregate.verifiedFailureCount += projection.verifiedFailureCount;
    aggregates.set(key, aggregate);
  }
  for (const aggregate of aggregates.values()) {
    aggregate.applicationRate = slRate(
      aggregate.applicationCount,
      aggregate.retrievalCount,
    );
    aggregate.outcomeSuccessRate = slRate(
      aggregate.outcomeSuccessCount,
      aggregate.outcomeSuccessCount +
        aggregate.outcomeFailureCount +
        aggregate.outcomePartialCount,
    );
    aggregate.verifiedSuccessRate = slRate(
      aggregate.verifiedSuccessCount,
      aggregate.verifiedSuccessCount + aggregate.verifiedFailureCount,
    );
  }
  return [...aggregates.values()].sort((left, right) =>
    slCompareOrdinal(slScopeKey(left.scope), slScopeKey(right.scope)),
  );
}

export function slAggregateUsageRepository(
  projections: SLUsageProjection[],
): SLUsageRepositoryAggregate {
  const scopes = slAggregateUsageByScope(projections);
  return {
    aggregation: "repository-counts-only",
    scopeCount: scopes.length,
    retrievalCount: scopes.reduce(
      (sum, scope) => sum + scope.retrievalCount,
      0,
    ),
    applicationCount: scopes.reduce(
      (sum, scope) => sum + scope.applicationCount,
      0,
    ),
    outcomeCount: scopes.reduce((sum, scope) => sum + scope.outcomeCount, 0),
    outcomeSuccessCount: scopes.reduce(
      (sum, scope) => sum + scope.outcomeSuccessCount,
      0,
    ),
    outcomeFailureCount: scopes.reduce(
      (sum, scope) => sum + scope.outcomeFailureCount,
      0,
    ),
    outcomePartialCount: scopes.reduce(
      (sum, scope) => sum + scope.outcomePartialCount,
      0,
    ),
    outcomeUnknownCount: scopes.reduce(
      (sum, scope) => sum + scope.outcomeUnknownCount,
      0,
    ),
    verifiedCount: scopes.reduce(
      (sum, scope) => sum + scope.verifiedCount,
      0,
    ),
    verifiedSuccessCount: scopes.reduce(
      (sum, scope) => sum + scope.verifiedSuccessCount,
      0,
    ),
    verifiedFailureCount: scopes.reduce(
      (sum, scope) => sum + scope.verifiedFailureCount,
      0,
    ),
    successRate: null,
    successRateReason: "rates-are-reported-per-scope",
  };
}
