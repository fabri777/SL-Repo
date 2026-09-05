import fg from "fast-glob";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { mkdir, open, readFile } from "node:fs/promises";
import { SL_PATHS, SL_SECRET_PATTERNS, SL_USER_PATH_PATTERN } from "./SL-constants.js";
import { slWithRepositoryMutationLock } from "./SL-mutation-lock.js";
import { slFindArtifact, slLoadRegistry } from "./SL-registry.js";
import {
  SL_DEFAULT_SCOPE,
  slArtifactShardName,
  slLoadStateCatalog,
  slNormalizeScope,
  slScopeCatalogEntry,
  slScopeKey,
} from "./SL-state.js";
import type {
  SLChange,
  SLResourceProjection,
  SLResourceReceipt,
  SLResourceTokenUsage,
  SLScopeResourceProjection,
  SLScopeDescriptor,
} from "./SL-types.js";
import {
  slArtifactUsageContentHash,
  slArtifactVersion,
  slAssertEvidenceRef,
  slLoadUsageEvents,
} from "./SL-usage.js";
import {
  slAssertRealPathInside,
  slCanonicalJson,
  slCompareOrdinal,
  slExists,
  slNormalizePath,
  slReadContainedText,
  slReadJson,
  slResolveInside,
  slWriteJson,
} from "./SL-utils.js";

const SL_RESOURCE_ID_PATTERN = /^SL-RESOURCE-[A-F0-9]{32}$/;
const SL_HASH_REFERENCE_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SL_CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/;
const SL_ARTIFACT_ID_PATTERN = /^SL-[A-Z0-9][A-Z0-9-]*$/;
const SL_OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const SL_DECIMAL_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]{1,12})?$/;
const SL_EMAIL_ADDRESS_PATTERN =
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const SL_IP_ADDRESS_PATTERN =
  /(?:^|[^0-9])(?:\d{1,3}\.){3}\d{1,3}(?:$|[^0-9])|(?:^|[^A-F0-9])(?:[A-F0-9]{0,4}:){2,7}[A-F0-9]{0,4}(?:$|[^A-F0-9])/i;

export interface SLCreateResourceReceiptInput {
  idempotencyKey: string;
  phase: "generation" | "application" | "baseline";
  source: "host" | "ci" | "manual";
  quality: "measured" | "estimated";
  provider: string;
  modelId: string;
  tokens: SLResourceTokenUsage;
  wallClockDurationMs: number;
  modelDurationMs?: number;
  toolDurationMs?: number;
  attemptCount?: number;
  timestamp: string;
  evidenceRef?: string;
  scope?: SLScopeDescriptor;
  reportedCost?: {
    amount: string;
    currency: string;
    basis: "host-reported";
  };
  artifactId?: string;
  artifactContentHash?: string;
  generationRunId?: string;
  taskRunId?: string;
  applicationId?: string;
  comparison?: {
    comparisonId: string;
    scenarioKey: string;
    role: "baseline" | "treatment";
  };
}

function slHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function slAssertOpaqueId(name: string, value: string): void {
  if (
    SL_EMAIL_ADDRESS_PATTERN.test(value) ||
    SL_USER_PATH_PATTERN.test(value) ||
    SL_IP_ADDRESS_PATTERN.test(value) ||
    SL_SECRET_PATTERNS.some(({ pattern }) => pattern.test(value))
  ) {
    throw new Error(`${name} must not contain secrets, PII, or user paths.`);
  }
  if (!SL_OPAQUE_ID_PATTERN.test(value)) {
    throw new Error(
      `${name} must contain only letters, numbers, '.', '_', ':', '/', or '-'.`,
    );
  }
}

function slAssertTimestamp(value: string): void {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("timestamp must be a canonical ISO-8601 UTC timestamp.");
  }
}

function slAssertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
}

function slAssertPositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

function slValidateTokens(tokens: SLResourceTokenUsage): void {
  slAssertNonNegativeInteger("tokens.input", tokens.input);
  slAssertNonNegativeInteger("tokens.output", tokens.output);
  for (const [name, value] of Object.entries({
    cacheRead: tokens.cacheRead,
    cacheWrite: tokens.cacheWrite,
    reasoning: tokens.reasoning,
  })) {
    if (value !== undefined) {
      slAssertNonNegativeInteger(`tokens.${name}`, value);
    }
  }
}

export function slCreateResourceReceipt(
  input: SLCreateResourceReceiptInput,
): SLResourceReceipt {
  const rawIdempotencyKey = input.idempotencyKey.trim();
  if (!rawIdempotencyKey) {
    throw new Error("idempotencyKey is required.");
  }
  const idempotencyHash = slHash(rawIdempotencyKey);
  const common = {
    schemaVersion: 1 as const,
    receiptId: `SL-RESOURCE-${idempotencyHash.slice(0, 32).toUpperCase()}`,
    idempotencyKey: `sha256:${idempotencyHash}`,
    source: input.source,
    quality: input.quality,
    provider: input.provider,
    modelId: input.modelId,
    tokens: input.tokens,
    wallClockDurationMs: input.wallClockDurationMs,
    ...(input.modelDurationMs !== undefined
      ? { modelDurationMs: input.modelDurationMs }
      : {}),
    ...(input.toolDurationMs !== undefined
      ? { toolDurationMs: input.toolDurationMs }
      : {}),
    ...(input.attemptCount !== undefined
      ? { attemptCount: input.attemptCount }
      : {}),
    timestamp: input.timestamp,
    ...(input.evidenceRef ? { evidenceRef: input.evidenceRef } : {}),
    scope: slNormalizeScope(input.scope ?? SL_DEFAULT_SCOPE),
    ...(input.reportedCost ? { reportedCost: input.reportedCost } : {}),
  };
  let receipt: SLResourceReceipt;
  if (input.phase === "generation") {
    if (
      !input.artifactId ||
      !input.artifactContentHash ||
      !input.generationRunId
    ) {
      throw new Error(
        "Generation receipts require artifactId, artifactContentHash, and generationRunId.",
      );
    }
    receipt = {
      ...common,
      phase: "generation",
      artifactId: input.artifactId,
      artifactVersion: slArtifactVersion(input.artifactContentHash),
      artifactContentHash: input.artifactContentHash,
      generationRunId: input.generationRunId,
    };
  } else if (input.phase === "application") {
    if (
      !input.artifactId ||
      !input.artifactContentHash ||
      !input.taskRunId ||
      !input.applicationId
    ) {
      throw new Error(
        "Application receipts require artifactId, artifactContentHash, taskRunId, and applicationId.",
      );
    }
    receipt = {
      ...common,
      phase: "application",
      artifactId: input.artifactId,
      artifactVersion: slArtifactVersion(input.artifactContentHash),
      artifactContentHash: input.artifactContentHash,
      taskRunId: input.taskRunId,
      applicationId: input.applicationId,
      ...(input.comparison
        ? {
            comparison: {
              ...input.comparison,
              role: "treatment" as const,
            },
          }
        : {}),
    };
  } else {
    if (!input.taskRunId || !input.comparison) {
      throw new Error(
        "Baseline receipts require taskRunId and comparison identity.",
      );
    }
    receipt = {
      ...common,
      phase: "baseline",
      taskRunId: input.taskRunId,
      comparison: {
        ...input.comparison,
        role: "baseline",
      },
    };
  }
  slValidateResourceReceipt(receipt);
  return receipt;
}

export function slValidateResourceReceipt(receipt: SLResourceReceipt): void {
  if (receipt.schemaVersion !== 1) {
    throw new Error("Unsupported SL resource receipt schemaVersion.");
  }
  if (!SL_RESOURCE_ID_PATTERN.test(receipt.receiptId)) {
    throw new Error("receiptId must use the SL-RESOURCE-<SHA256 prefix> format.");
  }
  if (!SL_HASH_REFERENCE_PATTERN.test(receipt.idempotencyKey)) {
    throw new Error("idempotencyKey must be a SHA-256 reference.");
  }
  if (
    receipt.receiptId !==
    `SL-RESOURCE-${receipt.idempotencyKey
      .slice("sha256:".length, 39)
      .toUpperCase()}`
  ) {
    throw new Error("receiptId must match idempotencyKey.");
  }
  if (!["generation", "application", "baseline"].includes(receipt.phase)) {
    throw new Error("phase is not supported.");
  }
  if (!["host", "ci", "manual"].includes(receipt.source)) {
    throw new Error("source is not supported.");
  }
  if (!["measured", "estimated"].includes(receipt.quality)) {
    throw new Error("quality is not supported.");
  }
  slAssertOpaqueId("provider", receipt.provider);
  slAssertOpaqueId("modelId", receipt.modelId);
  slValidateTokens(receipt.tokens);
  slAssertPositiveInteger(
    "wallClockDurationMs",
    receipt.wallClockDurationMs,
  );
  if (receipt.modelDurationMs !== undefined) {
    slAssertNonNegativeInteger("modelDurationMs", receipt.modelDurationMs);
    if (receipt.modelDurationMs > receipt.wallClockDurationMs) {
      throw new Error("modelDurationMs cannot exceed wallClockDurationMs.");
    }
  }
  if (receipt.toolDurationMs !== undefined) {
    slAssertNonNegativeInteger("toolDurationMs", receipt.toolDurationMs);
    if (receipt.toolDurationMs > receipt.wallClockDurationMs) {
      throw new Error("toolDurationMs cannot exceed wallClockDurationMs.");
    }
  }
  if (receipt.attemptCount !== undefined) {
    slAssertPositiveInteger("attemptCount", receipt.attemptCount);
  }
  slAssertTimestamp(receipt.timestamp);
  if (receipt.evidenceRef) {
    slAssertEvidenceRef(receipt.evidenceRef);
  }
  const normalizedScope = slNormalizeScope(receipt.scope);
  if (slScopeKey(receipt.scope) !== slScopeKey(normalizedScope)) {
    throw new Error("scope must be normalized.");
  }
  if (receipt.reportedCost) {
    if (!SL_DECIMAL_PATTERN.test(receipt.reportedCost.amount)) {
      throw new Error(
        "reportedCost.amount must be a non-negative decimal with at most 12 fractional digits.",
      );
    }
    if (!/^[A-Z]{3}$/.test(receipt.reportedCost.currency)) {
      throw new Error("reportedCost.currency must be an ISO-style code.");
    }
    if (receipt.reportedCost.basis !== "host-reported") {
      throw new Error("reportedCost.basis must be host-reported.");
    }
  }
  if (receipt.phase === "generation" || receipt.phase === "application") {
    if (!SL_ARTIFACT_ID_PATTERN.test(receipt.artifactId)) {
      throw new Error("artifactId must be a valid SL artifact ID.");
    }
    if (!SL_CONTENT_HASH_PATTERN.test(receipt.artifactContentHash)) {
      throw new Error("artifactContentHash must be a lowercase SHA-256 hash.");
    }
    if (
      receipt.artifactVersion !==
      slArtifactVersion(receipt.artifactContentHash)
    ) {
      throw new Error("artifactVersion must match artifactContentHash.");
    }
  }
  if (receipt.phase === "generation") {
    slAssertOpaqueId("generationRunId", receipt.generationRunId);
  } else if (receipt.phase === "application") {
    slAssertOpaqueId("taskRunId", receipt.taskRunId);
    slAssertOpaqueId("applicationId", receipt.applicationId);
    if (receipt.comparison) {
      slAssertOpaqueId(
        "comparison.comparisonId",
        receipt.comparison.comparisonId,
      );
      slAssertOpaqueId("comparison.scenarioKey", receipt.comparison.scenarioKey);
      if (receipt.comparison.role !== "treatment") {
        throw new Error("Application comparisons must use treatment role.");
      }
    }
  } else {
    slAssertOpaqueId("taskRunId", receipt.taskRunId);
    slAssertOpaqueId(
      "comparison.comparisonId",
      receipt.comparison.comparisonId,
    );
    slAssertOpaqueId("comparison.scenarioKey", receipt.comparison.scenarioKey);
    if (receipt.comparison.role !== "baseline") {
      throw new Error("Baseline comparisons must use baseline role.");
    }
  }
}

function slResourceReceiptIdentity(
  receipt: SLResourceReceipt,
): Omit<SLResourceReceipt, "timestamp"> {
  const { timestamp, ...identity } = receipt;
  void timestamp;
  return identity;
}

function slResourceReceiptsEquivalent(
  left: SLResourceReceipt,
  right: SLResourceReceipt,
): boolean {
  return (
    slCanonicalJson(slResourceReceiptIdentity(left)) ===
    slCanonicalJson(slResourceReceiptIdentity(right))
  );
}

export function slResourceReceiptPath(receipt: SLResourceReceipt): string {
  const entry = slScopeCatalogEntry(receipt.scope);
  const root =
    entry.resourceReceiptsPath ??
    `${SL_PATHS.scopeRoot}/${entry.shard}/SL-resource-receipts`;
  const month = receipt.timestamp.slice(0, 7);
  const owner =
    receipt.phase === "baseline"
      ? `SL-baselines/${slArtifactShardName(
          `SL-BASELINE-${slHash(receipt.comparison.comparisonId)
            .slice(0, 12)
            .toUpperCase()}`,
        )}`
      : slArtifactShardName(receipt.artifactId);
  return `${root}/${owner}/${month}/SL-resource-${receipt.receiptId.slice(
    "SL-RESOURCE-".length,
  )}.json`;
}

async function slResourceReceiptMatches(
  path: string,
  receipt: SLResourceReceipt,
): Promise<boolean> {
  try {
    const existing = JSON.parse(
      await readFile(path, "utf8"),
    ) as SLResourceReceipt;
    slValidateResourceReceipt(existing);
    return slResourceReceiptsEquivalent(existing, receipt);
  } catch {
    return false;
  }
}

export async function slWriteResourceReceipt(
  root: string,
  receipt: SLResourceReceipt,
  dryRun: boolean,
): Promise<SLChange> {
  slValidateResourceReceipt(receipt);
  const relativePath = slResourceReceiptPath(receipt);
  await slAssertRealPathInside(root, relativePath);
  const path = slResolveInside(root, relativePath);
  if (await slExists(path)) {
    if (!(await slResourceReceiptMatches(path, receipt))) {
      throw new Error(`Immutable SL resource receipt collision: ${relativePath}`);
    }
    return {
      action: "skip",
      path: relativePath,
      detail: "idempotent receipt already recorded",
    };
  }
  if (dryRun) {
    return { action: "create", path: relativePath, detail: "planned" };
  }
  await mkdir(dirname(path), { recursive: true });
  const content = `${JSON.stringify(receipt, null, 2)}\n`;
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
    if (!(await slResourceReceiptMatches(path, receipt))) {
      throw new Error(`Immutable SL resource receipt collision: ${relativePath}`);
    }
    return {
      action: "skip",
      path: relativePath,
      detail: "idempotent receipt already recorded",
    };
  }
  return { action: "create", path: relativePath, detail: "written" };
}

export async function slLoadResourceReceipts(
  root: string,
): Promise<SLResourceReceipt[]> {
  await slAssertRealPathInside(root, SL_PATHS.learningRoot);
  const paths = await fg(
    [
      `${SL_PATHS.resourceReceipts}/**/*.json`,
      `${SL_PATHS.scopeRoot}/*/SL-resource-receipts/**/*.json`,
    ],
    {
      cwd: root,
      onlyFiles: true,
      followSymbolicLinks: false,
    },
  );
  const receipts: SLResourceReceipt[] = [];
  const byId = new Map<string, SLResourceReceipt>();
  const byIdempotency = new Map<string, SLResourceReceipt>();
  const byApplication = new Map<string, SLResourceReceipt>();
  for (const relativePath of paths
    .map(slNormalizePath)
    .sort(slCompareOrdinal)) {
    await slAssertRealPathInside(root, relativePath);
    const receipt = await slReadJson<SLResourceReceipt>(
      slResolveInside(root, relativePath),
    );
    slValidateResourceReceipt(receipt);
    if (slResourceReceiptPath(receipt) !== relativePath) {
      throw new Error(`SL resource receipt path mismatch: ${relativePath}`);
    }
    const duplicate =
      byId.get(receipt.receiptId) ??
      byIdempotency.get(receipt.idempotencyKey);
    if (duplicate && !slResourceReceiptsEquivalent(duplicate, receipt)) {
      throw new Error(
        `Conflicting SL resource receipt identity: ${receipt.receiptId}`,
      );
    }
    if (receipt.phase === "application") {
      const priorApplication = byApplication.get(receipt.applicationId);
      if (
        priorApplication &&
        !slResourceReceiptsEquivalent(priorApplication, receipt)
      ) {
        throw new Error(
          `Application ${receipt.applicationId} has conflicting resource receipts.`,
        );
      }
      byApplication.set(receipt.applicationId, receipt);
    }
    byId.set(receipt.receiptId, receipt);
    byIdempotency.set(receipt.idempotencyKey, receipt);
    receipts.push(receipt);
  }
  return receipts;
}

async function slValidateResourceCorrelation(
  root: string,
  receipt: SLResourceReceipt,
): Promise<void> {
  if (receipt.phase === "baseline") {
    return;
  }
  if (receipt.phase === "application") {
    const events = (await slLoadUsageEvents(root)).filter(
      (event) =>
        event.eventType === "usage" &&
        event.applicationId === receipt.applicationId,
    );
    if (events.length === 0) {
      throw new Error(
        `Application resource receipt has no usage lifecycle: ${receipt.applicationId}`,
      );
    }
    for (const event of events) {
      if (
        event.artifactId !== receipt.artifactId ||
        event.artifactVersion !== receipt.artifactVersion ||
        event.artifactContentHash !== receipt.artifactContentHash ||
        event.taskRunId !== receipt.taskRunId ||
        slScopeKey(event.scope ?? SL_DEFAULT_SCOPE) !==
          slScopeKey(receipt.scope)
      ) {
        throw new Error(
          `Application resource receipt disagrees with usage lifecycle ${receipt.applicationId}.`,
        );
      }
    }
    return;
  }
  const registry = await slLoadRegistry(root);
  const artifact = slFindArtifact(registry, receipt.artifactId);
  if (!artifact.path) {
    throw new Error(
      `Generation resource receipt artifact has no active path: ${receipt.artifactId}`,
    );
  }
  const content = await slReadContainedText(root, artifact.path);
  const contentHash = slArtifactUsageContentHash(content);
  if (
    contentHash !== receipt.artifactContentHash ||
    slArtifactVersion(contentHash) !== receipt.artifactVersion
  ) {
    throw new Error(
      `Generation resource receipt does not match artifact version ${receipt.artifactId}.`,
    );
  }
  if (
    slScopeKey(artifact.scope ?? SL_DEFAULT_SCOPE) !==
    slScopeKey(receipt.scope)
  ) {
    throw new Error(
      `Generation resource receipt scope does not own artifact ${receipt.artifactId}.`,
    );
  }
}

export async function slRecordResourceReceipt(
  root: string,
  input: SLCreateResourceReceiptInput,
  dryRun = false,
): Promise<{ receipt: SLResourceReceipt; change: SLChange }> {
  return slWithRepositoryMutationLock(
    root,
    async () => {
      const receipt = slCreateResourceReceipt(input);
      await slValidateResourceCorrelation(root, receipt);
      const existing = await slLoadResourceReceipts(root);
      const collision = existing.find(
        (candidate) =>
          candidate.receiptId === receipt.receiptId ||
          candidate.idempotencyKey === receipt.idempotencyKey ||
          (candidate.phase === "application" &&
            receipt.phase === "application" &&
            candidate.applicationId === receipt.applicationId),
      );
      if (collision && !slResourceReceiptsEquivalent(collision, receipt)) {
        throw new Error(
          `Immutable SL resource receipt collision: ${collision.receiptId}`,
        );
      }
      const change = await slWriteResourceReceipt(root, receipt, dryRun);
      return { receipt, change };
    },
    { dryRun },
  );
}

function slDecimalToScaled(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(`${whole}${fraction.padEnd(12, "0")}`);
}

function slScaledToDecimal(value: bigint): string {
  const digits = value.toString().padStart(13, "0");
  const whole = digits.slice(0, -12);
  const fraction = digits.slice(-12).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function slProjectResourceReceipts(
  receipts: SLResourceReceipt[],
): SLResourceProjection[] {
  const groups = new Map<string, SLResourceProjection>();
  for (const receipt of receipts) {
    const artifact =
      receipt.phase === "baseline"
        ? {}
        : {
            artifactId: receipt.artifactId,
            artifactVersion: receipt.artifactVersion,
            artifactContentHash: receipt.artifactContentHash,
          };
    const key = slCanonicalJson({
      scope: receipt.scope,
      ...artifact,
      phase: receipt.phase,
      source: receipt.source,
      quality: receipt.quality,
      provider: receipt.provider,
      modelId: receipt.modelId,
    });
    const projection =
      groups.get(key) ??
      ({
        scope: receipt.scope,
        ...artifact,
        phase: receipt.phase,
        source: receipt.source,
        quality: receipt.quality,
        provider: receipt.provider,
        modelId: receipt.modelId,
        receiptCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        wallClockDurationMs: 0,
        modelDurationMs: 0,
        toolDurationMs: 0,
        attemptCount: 0,
        reportedCosts: {},
      } satisfies SLResourceProjection);
    projection.receiptCount += 1;
    projection.inputTokens += receipt.tokens.input;
    projection.outputTokens += receipt.tokens.output;
    projection.cacheReadTokens += receipt.tokens.cacheRead ?? 0;
    projection.cacheWriteTokens += receipt.tokens.cacheWrite ?? 0;
    projection.reasoningTokens += receipt.tokens.reasoning ?? 0;
    projection.totalTokens +=
      receipt.tokens.input +
      receipt.tokens.output +
      (receipt.tokens.cacheRead ?? 0) +
      (receipt.tokens.cacheWrite ?? 0) +
      (receipt.tokens.reasoning ?? 0);
    projection.wallClockDurationMs += receipt.wallClockDurationMs;
    projection.modelDurationMs += receipt.modelDurationMs ?? 0;
    projection.toolDurationMs += receipt.toolDurationMs ?? 0;
    projection.attemptCount += receipt.attemptCount ?? 1;
    if (receipt.reportedCost) {
      const prior = projection.reportedCosts[receipt.reportedCost.currency] ?? "0";
      projection.reportedCosts[receipt.reportedCost.currency] =
        slScaledToDecimal(
          slDecimalToScaled(prior) +
            slDecimalToScaled(receipt.reportedCost.amount),
        );
    }
    groups.set(key, projection);
  }
  return [...groups.values()].sort((left, right) =>
    slCompareOrdinal(slCanonicalJson(left), slCanonicalJson(right)),
  );
}

export async function slSynchronizeResourceProjectionUnlocked(
  root: string,
  dryRun: boolean,
  changes: SLChange[] = [],
): Promise<void> {
  const catalog = await slLoadStateCatalog(root);
  const receipts = await slLoadResourceReceipts(root);
  const receiptsByScope = new Map<string, SLResourceReceipt[]>();
  for (const receipt of receipts) {
    const key = slScopeKey(receipt.scope);
    const scopedReceipts = receiptsByScope.get(key) ?? [];
    scopedReceipts.push(receipt);
    receiptsByScope.set(key, scopedReceipts);
  }
  for (const entry of catalog.scopes) {
    const projection: SLScopeResourceProjection = {
      schemaVersion: 1,
      scope: entry.scope,
      projections: slProjectResourceReceipts(
        receiptsByScope.get(slScopeKey(entry.scope)) ?? [],
      ),
    };
    await slWriteJson(
      root,
      entry.resourceProjectionPath ??
        slScopeCatalogEntry(entry.scope).resourceProjectionPath!,
      projection,
      dryRun,
      changes,
    );
  }
}

export async function slSynchronizeResourceProjection(
  root: string,
  dryRun: boolean,
  changes: SLChange[] = [],
): Promise<void> {
  await slWithRepositoryMutationLock(
    root,
    () => slSynchronizeResourceProjectionUnlocked(root, dryRun, changes),
    { dryRun },
  );
}
