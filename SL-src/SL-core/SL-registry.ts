import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { SL_PATHS } from "./SL-constants.js";
import type {
  SLChange,
  SLEvent,
  SLLifecycleEvent,
  SLRegistry,
  SLRegistryArtifact,
  SLScopeRegistry,
  SLScopeUsageProjection,
  SLUsageProjection,
} from "./SL-types.js";
import {
  SL_DEFAULT_SCOPE,
  slAssertCatalogEntryPaths,
  slLoadStateCatalog,
  slNormalizeScope,
  slScopeKey,
  slWriteStateCatalog,
} from "./SL-state.js";
import {
  slLoadScopeCatalog,
  slScopeDescriptors,
} from "./SL-scope.js";
import {
  slAssertRealPathInside,
  slCanonicalJson,
  slCompareOrdinal,
  slExists,
  slReadJson,
  slResolveInside,
  slWriteJson,
} from "./SL-utils.js";

export async function slAssertEventPathSafe(root: string): Promise<void> {
  await slAssertRealPathInside(root, SL_PATHS.lifecycleEvents);
}

export function slEmptyRegistry(): SLRegistry {
  return { schemaVersion: 1, artifacts: [] };
}

function slNormalizedRegistryArtifact(
  artifact: SLRegistryArtifact,
  fallbackScope = SL_DEFAULT_SCOPE,
): SLRegistryArtifact {
  return {
    ...artifact,
    scope: slNormalizeScope(artifact.scope ?? fallbackScope),
  };
}

function slRegistryArtifactIdentity(
  artifact: SLRegistryArtifact,
): unknown {
  return {
    id: artifact.id,
    artifactType: artifact.artifactType,
    classification: artifact.classification,
    managedBy: artifact.managedBy,
    createdAt: artifact.createdAt,
    scope: slNormalizeScope(artifact.scope ?? SL_DEFAULT_SCOPE),
    ownedPath:
      artifact.promotionTargetPath ??
      artifact.originalPath ??
      artifact.path,
    dependsOn: [...(artifact.dependsOn ?? [])].sort(slCompareOrdinal),
  };
}

function slRegistryArtifactsIdentityEquivalent(
  left: SLRegistryArtifact,
  right: SLRegistryArtifact,
): boolean {
  return (
    slCanonicalJson(slRegistryArtifactIdentity(left)) ===
    slCanonicalJson(slRegistryArtifactIdentity(right))
  );
}

export async function slLoadRegistry(root: string): Promise<SLRegistry> {
  const path = slResolveInside(root, SL_PATHS.registry);
  const legacy = (await slExists(path))
    ? await slReadJson<SLRegistry>(path)
    : slEmptyRegistry();
  const artifacts = new Map<string, SLRegistryArtifact>();
  const legacyIds = new Set<string>();
  for (const artifact of legacy.artifacts) {
    if (legacyIds.has(artifact.id)) {
      throw new Error(
        `Duplicate artifact ID ${artifact.id} in legacy registry ${SL_PATHS.registry}.`,
      );
    }
    legacyIds.add(artifact.id);
    artifacts.set(
      artifact.id,
      slNormalizedRegistryArtifact(artifact),
    );
  }
  const scopeRegistries = await slLoadScopeRegistries(root);
  for (const shard of scopeRegistries) {
    for (const artifact of shard.artifacts) {
      const normalized = slNormalizedRegistryArtifact(
        artifact,
        shard.scope,
      );
      const legacyArtifact = artifacts.get(artifact.id);
      if (
        legacyArtifact &&
        legacyIds.has(artifact.id) &&
        !slRegistryArtifactsIdentityEquivalent(
          legacyArtifact,
          normalized,
        )
      ) {
        throw new Error(
          `Conflicting legacy registry/shard overlay for artifact ${artifact.id}.`,
        );
      }
      artifacts.set(artifact.id, normalized);
    }
  }
  const catalog = await slLoadStateCatalog(root);
  const projections = new Map<string, SLUsageProjection[]>();
  const currentVersions = new Map<string, string>();
  for (const entry of catalog.scopes) {
    const projectionPath = slResolveInside(root, entry.projectionPath);
    if (!(await slExists(projectionPath))) {
      continue;
    }
    await slAssertRealPathInside(root, entry.projectionPath);
    const projectionShard =
      await slReadJson<SLScopeUsageProjection>(projectionPath);
    for (const [artifactId, version] of Object.entries(
      projectionShard.currentArtifactVersions ?? {},
    )) {
      currentVersions.set(artifactId, version);
    }
    for (const projection of projectionShard.projections) {
      const values = projections.get(projection.artifactId) ?? [];
      values.push(projection);
      projections.set(projection.artifactId, values);
    }
  }
  for (const artifact of artifacts.values()) {
    const artifactScopeKey = slScopeKey(
      artifact.scope ?? SL_DEFAULT_SCOPE,
    );
    const candidates = (projections.get(artifact.id) ?? []).filter(
      (projection) =>
        slScopeKey(projection.scope) === artifactScopeKey,
    );
    const currentVersion = currentVersions.get(artifact.id);
    candidates.sort((left, right) => {
      const leftTimestamp =
        left.lastRetrievedAt ??
        left.lastAppliedAt ??
        left.lastVerifiedSuccessAt ??
        left.lastVerifiedFailureAt ??
        "";
      const rightTimestamp =
        right.lastRetrievedAt ??
        right.lastAppliedAt ??
        right.lastVerifiedSuccessAt ??
        right.lastVerifiedFailureAt ??
        "";
      return (
        slCompareOrdinal(rightTimestamp, leftTimestamp) ||
        slCompareOrdinal(right.artifactVersion, left.artifactVersion)
      );
    });
    const selected =
      candidates.find(
        (projection) => projection.artifactVersion === currentVersion,
      ) ?? candidates[0];
    if (selected) {
      artifact.usageProjection = selected;
    }
  }
  return {
    schemaVersion: 1,
    artifacts: [...artifacts.values()].sort((left, right) =>
      slCompareOrdinal(left.id, right.id),
    ),
  };
}

export async function slLoadScopeRegistries(
  root: string,
): Promise<SLScopeRegistry[]> {
  const catalog = await slLoadStateCatalog(root);
  const shards: SLScopeRegistry[] = [];
  const artifactOwners = new Map<string, string>();
  for (const entry of catalog.scopes) {
    slAssertCatalogEntryPaths(entry);
    await slAssertRealPathInside(root, entry.registryPath);
    const path = slResolveInside(root, entry.registryPath);
    if (!(await slExists(path))) {
      continue;
    }
    const shard = await slReadJson<SLScopeRegistry>(path);
    const shardArtifactIds = new Set<string>();
    for (const artifact of shard.artifacts) {
      if (shardArtifactIds.has(artifact.id)) {
        throw new Error(
          `Duplicate artifact ID ${artifact.id} within registry shard ${entry.registryPath}.`,
        );
      }
      shardArtifactIds.add(artifact.id);
      const owner = artifactOwners.get(artifact.id);
      if (owner) {
        throw new Error(
          `Duplicate artifact ID ${artifact.id} across registry shards ${owner} and ${entry.registryPath}.`,
        );
      }
      artifactOwners.set(artifact.id, entry.registryPath);
    }
    shards.push({
      schemaVersion: 1,
      scope: slNormalizeScope(shard.scope),
      artifacts: shard.artifacts,
    });
  }
  return shards.sort((left, right) =>
    slCompareOrdinal(slScopeKey(left.scope), slScopeKey(right.scope)),
  );
}

export async function slSaveRegistry(
  root: string,
  registry: SLRegistry,
  dryRun: boolean,
  changes: SLChange[],
): Promise<void> {
  registry.artifacts.sort((left, right) =>
    slCompareOrdinal(left.id, right.id),
  );
  const catalog = await slLoadStateCatalog(root);
  const scopes = new Map(
    catalog.scopes.map((entry) => [slScopeKey(entry.scope), entry.scope]),
  );
  for (const scope of slScopeDescriptors(await slLoadScopeCatalog(root))) {
    scopes.set(slScopeKey(scope), scope);
  }
  const artifactsByScope = new Map<string, SLRegistryArtifact[]>();
  for (const artifact of registry.artifacts) {
    const scope = slNormalizeScope(artifact.scope ?? SL_DEFAULT_SCOPE);
    artifact.scope = scope;
    const key = slScopeKey(scope);
    scopes.set(key, scope);
    const persistedArtifact = structuredClone(artifact);
    delete persistedArtifact.usageProjection;
    const artifacts = artifactsByScope.get(key) ?? [];
    artifacts.push(persistedArtifact);
    artifactsByScope.set(key, artifacts);
  }
  const nextCatalog = await slWriteStateCatalog(
    root,
    scopes.values(),
    dryRun,
    changes,
  );
  for (const entry of nextCatalog.scopes) {
    const artifacts = artifactsByScope.get(slScopeKey(entry.scope)) ?? [];
    artifacts.sort((left, right) => slCompareOrdinal(left.id, right.id));
    const shard: SLScopeRegistry = {
      schemaVersion: 1,
      scope: entry.scope,
      artifacts,
    };
    await slWriteJson(
      root,
      entry.registryPath,
      shard,
      dryRun,
      changes,
    );
  }
}

export function slFindArtifact(
  registry: SLRegistry,
  id: string,
): SLRegistryArtifact {
  const artifact = registry.artifacts.find((candidate) => candidate.id === id);
  if (!artifact) {
    throw new Error(`SL artifact not found: ${id}`);
  }
  return artifact;
}

export function slUpsertArtifact(
  registry: SLRegistry,
  artifact: SLRegistryArtifact,
): void {
  const index = registry.artifacts.findIndex((candidate) => candidate.id === artifact.id);
  if (index >= 0) {
    registry.artifacts[index] = artifact;
  } else {
    registry.artifacts.push(artifact);
  }
}

export async function slAppendEvents(
  root: string,
  events: SLEvent[],
  dryRun: boolean,
): Promise<void> {
  if (events.length === 0) {
    return;
  }
  await slAssertEventPathSafe(root);
  for (const event of events) {
    const persisted = slCreateLifecycleEvent(event);
    const relativePath = slLifecycleEventPath(persisted);
    const path = slResolveInside(root, relativePath);
    await slAssertRealPathInside(root, relativePath);
    const content = `${JSON.stringify(persisted, null, 2)}\n`;
    if (await slExists(path)) {
      let existing: SLLifecycleEvent;
      try {
        existing = JSON.parse(await readFile(path, "utf8")) as SLLifecycleEvent;
        slValidateLifecycleEvent(existing);
      } catch {
        throw new Error(`Immutable SL lifecycle event collision: ${relativePath}`);
      }
      if (slCanonicalJson(existing) !== slCanonicalJson(persisted)) {
        throw new Error(`Immutable SL lifecycle event collision: ${relativePath}`);
      }
      continue;
    }
    if (dryRun) {
      continue;
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
      let existing: SLLifecycleEvent;
      try {
        existing = JSON.parse(await readFile(path, "utf8")) as SLLifecycleEvent;
        slValidateLifecycleEvent(existing);
      } catch {
        throw new Error(`Immutable SL lifecycle event collision: ${relativePath}`);
      }
      if (slCanonicalJson(existing) !== slCanonicalJson(persisted)) {
        throw new Error(`Immutable SL lifecycle event collision: ${relativePath}`);
      }
    }
  }
}

function slLifecycleHash(event: SLEvent): string {
  return createHash("sha256")
    .update(JSON.stringify(event))
    .digest("hex");
}

export function slCreateLifecycleEvent(event: SLEvent): SLLifecycleEvent {
  const normalized: SLEvent = {
    schemaVersion: event.schemaVersion,
    timestamp: event.timestamp,
    artifactId: event.artifactId,
    action: event.action,
    ...(event.reason !== undefined ? { reason: event.reason } : {}),
    ...(event.fromStatus !== undefined
      ? { fromStatus: event.fromStatus }
      : {}),
    ...(event.toStatus !== undefined ? { toStatus: event.toStatus } : {}),
    ...(event.fromPath !== undefined ? { fromPath: event.fromPath } : {}),
    ...(event.toPath !== undefined ? { toPath: event.toPath } : {}),
  };
  const hash = slLifecycleHash(normalized);
  return {
    ...normalized,
    eventId: `SL-EVENT-${hash.slice(0, 32).toUpperCase()}`,
    idempotencyKey: `sha256:${hash}`,
  };
}

export function slLifecycleEventPath(event: SLLifecycleEvent): string {
  return `${SL_PATHS.lifecycleEvents}/${event.timestamp.slice(0, 7)}/SL-event-${event.eventId.slice("SL-EVENT-".length)}.json`;
}

export function slValidateLifecycleEvent(event: SLLifecycleEvent): void {
  const { eventId, idempotencyKey, ...source } = event;
  const expected = slCreateLifecycleEvent(source);
  if (
    eventId !== expected.eventId ||
    idempotencyKey !== expected.idempotencyKey
  ) {
    throw new Error("Lifecycle event identity does not match its content.");
  }
  const timestamp = new Date(event.timestamp);
  if (
    Number.isNaN(timestamp.getTime()) ||
    timestamp.toISOString() !== event.timestamp
  ) {
    throw new Error("Lifecycle event timestamp must be canonical ISO-8601 UTC.");
  }
}
