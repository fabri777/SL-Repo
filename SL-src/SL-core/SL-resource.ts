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

export interface SLResourceReceiptImportEnvelope {
  schemaVersion: 1;
  receipts: SLCreateResourceReceiptInput[];
}

export interface SLImportResourceReceiptsResult {
  receipts: SLResourceReceipt[];
  changes: SLChange[];
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

function slAssertPlainObject(
  name: string,
  value: unknown,
): asserts value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(`${name} must be a JSON object.`);
  }
}

function slAssertKnownKeys(
  name: string,
  value: Record<string, unknown>,
  allowed: string[],
): void {
  const unexpected = Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .sort(slCompareOrdinal);
  if (unexpected.length > 0) {
    throw new Error(
      `${name} contains unsupported fields: ${unexpected.join(", ")}.`,
    );
  }
}

function slAssertStringField(
  name: string,
  value: unknown,
  required = true,
): asserts value is string | undefined {
  if (value === undefined && !required) {
    return;
  }
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string.`);
  }
}

function slAssertNumberField(
  name: string,
  value: unknown,
  required = true,
): asserts value is number | undefined {
  if (value === undefined && !required) {
    return;
  }
  if (typeof value !== "number") {
    throw new Error(`${name} must be a number.`);
  }
}

function slParseResourceReceiptInput(
  value: unknown,
  index: number,
): SLCreateResourceReceiptInput {
  const name = `receipts[${index}]`;
  slAssertPlainObject(name, value);
  slAssertKnownKeys(name, value, [
    "idempotencyKey",
    "phase",
    "source",
    "quality",
    "provider",
    "modelId",
    "tokens",
    "wallClockDurationMs",
    "modelDurationMs",
    "toolDurationMs",
    "attemptCount",
    "timestamp",
    "evidenceRef",
    "scope",
    "reportedCost",
    "artifactId",
    "artifactContentHash",
    "generationRunId",
    "taskRunId",
    "applicationId",
    "comparison",
  ]);
  slAssertPlainObject(`${name}.tokens`, value.tokens);
  slAssertKnownKeys(`${name}.tokens`, value.tokens, [
    "input",
    "output",
    "cacheRead",
    "cacheWrite",
    "reasoning",
  ]);
  for (const field of [
    "idempotencyKey",
    "phase",
    "source",
    "quality",
    "provider",
    "modelId",
    "timestamp",
  ]) {
    slAssertStringField(`${name}.${field}`, value[field]);
  }
  if (
    !["generation", "application", "baseline"].includes(
      value.phase as string,
    )
  ) {
    throw new Error(`${name}.phase is not supported.`);
  }
  if (!["host", "ci", "manual"].includes(value.source as string)) {
    throw new Error(`${name}.source is not supported.`);
  }
  if (!["measured", "estimated"].includes(value.quality as string)) {
    throw new Error(`${name}.quality is not supported.`);
  }
  for (const field of [
    "artifactId",
    "artifactContentHash",
    "generationRunId",
    "taskRunId",
    "applicationId",
    "evidenceRef",
  ]) {
    slAssertStringField(`${name}.${field}`, value[field], false);
  }
  slAssertNumberField(
    `${name}.wallClockDurationMs`,
    value.wallClockDurationMs,
  );
  for (const field of [
    "modelDurationMs",
    "toolDurationMs",
    "attemptCount",
  ]) {
    slAssertNumberField(`${name}.${field}`, value[field], false);
  }
  slAssertNumberField(`${name}.tokens.input`, value.tokens.input);
  slAssertNumberField(`${name}.tokens.output`, value.tokens.output);
  for (const field of ["cacheRead", "cacheWrite", "reasoning"]) {
    slAssertNumberField(
      `${name}.tokens.${field}`,
      value.tokens[field],
      false,
    );
  }
  if (value.scope !== undefined) {
    slAssertPlainObject(`${name}.scope`, value.scope);
    slAssertKnownKeys(`${name}.scope`, value.scope, ["id", "path"]);
    slAssertStringField(`${name}.scope.id`, value.scope.id);
    slAssertStringField(`${name}.scope.path`, value.scope.path);
  }
  if (value.reportedCost !== undefined) {
    slAssertPlainObject(`${name}.reportedCost`, value.reportedCost);
    slAssertKnownKeys(`${name}.reportedCost`, value.reportedCost, [
      "amount",
      "currency",
      "basis",
    ]);
    slAssertStringField(
      `${name}.reportedCost.amount`,
      value.reportedCost.amount,
    );
    slAssertStringField(
      `${name}.reportedCost.currency`,
      value.reportedCost.currency,
    );
    slAssertStringField(
      `${name}.reportedCost.basis`,
      value.reportedCost.basis,
    );
  }
  if (value.comparison !== undefined) {
    slAssertPlainObject(`${name}.comparison`, value.comparison);
    slAssertKnownKeys(`${name}.comparison`, value.comparison, [
      "comparisonId",
      "scenarioKey",
      "role",
    ]);
    slAssertStringField(
      `${name}.comparison.comparisonId`,
      value.comparison.comparisonId,
    );
    slAssertStringField(
      `${name}.comparison.scenarioKey`,
      value.comparison.scenarioKey,
    );
    slAssertStringField(
      `${name}.comparison.role`,
      value.comparison.role,
    );
  }
  if (
    value.phase === "application" &&
    value.comparison !== undefined &&
    value.comparison.role !== "treatment"
  ) {
    throw new Error(`${name}.comparison.role must be treatment.`);
  }
  if (
    value.phase === "baseline" &&
    value.comparison !== undefined &&
    value.comparison.role !== "baseline"
  ) {
    throw new Error(`${name}.comparison.role must be baseline.`);
  }
  const input = value as unknown as SLCreateResourceReceiptInput;
  slCreateResourceReceipt(input);
  return input;
}

export function slParseResourceReceiptInputs(
  value: unknown,
): SLCreateResourceReceiptInput[] {
  let entries: unknown[];
  if (Array.isArray(value)) {
    entries = value;
  } else {
    slAssertPlainObject("resource input", value);
    if ("receipts" in value || "schemaVersion" in value) {
      slAssertKnownKeys("resource input", value, [
        "schemaVersion",
        "receipts",
      ]);
      if (value.schemaVersion !== 1 || !Array.isArray(value.receipts)) {
        throw new Error(
          "Resource input envelope requires schemaVersion 1 and a receipts array.",
        );
      }
      entries = value.receipts;
    } else {
      entries = [value];
    }
  }
  if (entries.length === 0) {
    throw new Error("Resource input must contain at least one receipt.");
  }
  return entries.map(slParseResourceReceiptInput);
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

function slCanonicalizeResourceReceipts(
  receipts: SLResourceReceipt[],
): SLResourceReceipt[] {
  const byId = new Map<string, SLResourceReceipt>();
  const byIdempotency = new Map<string, SLResourceReceipt>();
  const byApplication = new Map<string, SLResourceReceipt>();
  const canonicalById = new Map<string, SLResourceReceipt>();
  for (const receipt of receipts) {
    const duplicates = [
      byId.get(receipt.receiptId),
      byIdempotency.get(receipt.idempotencyKey),
    ].filter(
      (
        candidate,
      ): candidate is SLResourceReceipt => candidate !== undefined,
    );
    for (const duplicate of duplicates) {
      if (!slResourceReceiptsEquivalent(duplicate, receipt)) {
        throw new Error(
          `Conflicting SL resource receipt identity: ${receipt.receiptId}`,
        );
      }
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
    }
    const duplicate = duplicates[0];
    const canonical =
      duplicate && slCompareOrdinal(duplicate.timestamp, receipt.timestamp) <= 0
        ? duplicate
        : receipt;
    byId.set(receipt.receiptId, canonical);
    byIdempotency.set(receipt.idempotencyKey, canonical);
    canonicalById.set(receipt.receiptId, canonical);
    if (receipt.phase === "application") {
      byApplication.set(receipt.applicationId, canonical);
    }
  }
  return [...canonicalById.values()].sort((left, right) =>
    slCompareOrdinal(
      slResourceReceiptPath(left),
      slResourceReceiptPath(right),
    ),
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
    receipts.push(receipt);
  }
  return slCanonicalizeResourceReceipts(receipts);
}

async function slValidateResourceCorrelation(
  root: string,
  receipt: SLResourceReceipt,
): Promise<void> {
  if (receipt.phase === "baseline") {
    const catalog = await slLoadStateCatalog(root);
    if (
      !catalog.scopes.some(
        (entry) => slScopeKey(entry.scope) === slScopeKey(receipt.scope),
      )
    ) {
      throw new Error(
        `Baseline resource receipt scope is not registered: ${receipt.scope.id}.`,
      );
    }
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
      if (collision) {
        return {
          receipt: collision,
          change: {
            action: "skip",
            path: slResourceReceiptPath(collision),
            detail: "idempotent receipt already recorded",
          },
        };
      }
      const change = await slWriteResourceReceipt(root, receipt, dryRun);
      return { receipt, change };
    },
    { dryRun },
  );
}

export async function slImportResourceReceipts(
  root: string,
  inputs: SLCreateResourceReceiptInput[],
  dryRun = false,
): Promise<SLImportResourceReceiptsResult> {
  if (inputs.length === 0) {
    throw new Error("Resource import requires at least one receipt.");
  }
  return slWithRepositoryMutationLock(
    root,
    async () => {
      const receipts = inputs.map(slCreateResourceReceipt);
      for (const receipt of receipts) {
        await slValidateResourceCorrelation(root, receipt);
      }
      const existing = await slLoadResourceReceipts(root);
      const candidates = [...existing];
      for (const receipt of receipts) {
        const collision = candidates.find(
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
        if (!collision) {
          candidates.push(receipt);
        }
      }
      const changes: SLChange[] = [];
      const canonicalReceipts: SLResourceReceipt[] = [];
      for (const receipt of receipts) {
        const collision = candidates.find(
          (candidate) =>
            candidate !== receipt &&
            (candidate.receiptId === receipt.receiptId ||
              candidate.idempotencyKey === receipt.idempotencyKey ||
              (candidate.phase === "application" &&
                receipt.phase === "application" &&
                candidate.applicationId === receipt.applicationId)),
        );
        if (collision) {
          canonicalReceipts.push(collision);
          changes.push({
            action: "skip",
            path: slResourceReceiptPath(collision),
            detail: "idempotent receipt already recorded",
          });
          continue;
        }
        canonicalReceipts.push(receipt);
        changes.push(await slWriteResourceReceipt(root, receipt, dryRun));
      }
      await slSynchronizeResourceProjectionUnlocked(
        root,
        dryRun,
        changes,
        candidates,
      );
      return { receipts: canonicalReceipts, changes };
    },
    { dryRun },
  );
}

export async function slResolveGenerationResourceIdentity(
  root: string,
  artifactId: string,
): Promise<{
  artifactId: string;
  artifactContentHash: string;
  scope: SLScopeDescriptor;
}> {
  const registry = await slLoadRegistry(root);
  const artifact = slFindArtifact(registry, artifactId);
  if (!artifact.path) {
    throw new Error(
      `Generation resource receipt artifact has no active path: ${artifactId}.`,
    );
  }
  const content = await slReadContainedText(root, artifact.path);
  return {
    artifactId,
    artifactContentHash: slArtifactUsageContentHash(content),
    scope: slNormalizeScope(artifact.scope ?? SL_DEFAULT_SCOPE),
  };
}

export async function slResolveApplicationResourceIdentity(
  root: string,
  artifactId: string,
  applicationId: string,
): Promise<{
  artifactId: string;
  artifactContentHash: string;
  taskRunId: string;
  applicationId: string;
  scope: SLScopeDescriptor;
}> {
  const events = (await slLoadUsageEvents(root)).filter(
    (event) =>
      event.eventType === "usage" &&
      event.applicationId === applicationId,
  );
  const first = events[0];
  if (!first) {
    throw new Error(
      `Application resource receipt has no usage lifecycle: ${applicationId}`,
    );
  }
  if (first.artifactId !== artifactId) {
    throw new Error(
      `Application ${applicationId} belongs to ${first.artifactId}, not ${artifactId}.`,
    );
  }
  for (const event of events.slice(1)) {
    if (
      event.artifactId !== first.artifactId ||
      event.artifactVersion !== first.artifactVersion ||
      event.artifactContentHash !== first.artifactContentHash ||
      event.taskRunId !== first.taskRunId ||
      slScopeKey(event.scope ?? SL_DEFAULT_SCOPE) !==
        slScopeKey(first.scope ?? SL_DEFAULT_SCOPE)
    ) {
      throw new Error(
        `Application ${applicationId} has conflicting usage identity data.`,
      );
    }
  }
  return {
    artifactId,
    artifactContentHash: first.artifactContentHash,
    taskRunId: first.taskRunId,
    applicationId,
    scope: slNormalizeScope(first.scope ?? SL_DEFAULT_SCOPE),
  };
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
  for (const receipt of slCanonicalizeResourceReceipts(receipts)) {
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
  suppliedReceipts?: SLResourceReceipt[],
  writeJson: typeof slWriteJson = slWriteJson,
): Promise<void> {
  const catalog = await slLoadStateCatalog(root);
  const receipts = suppliedReceipts ?? (await slLoadResourceReceipts(root));
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
    await writeJson(
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
