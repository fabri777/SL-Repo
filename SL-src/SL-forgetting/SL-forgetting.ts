import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname } from "node:path";
import {
  SL_PATHS,
  SL_REFERENCE_PROTECTING_STATUSES,
} from "../SL-core/SL-constants.js";
import { slLoadConfig } from "../SL-core/SL-config.js";
import { slParseMarkdown, slStringifyMarkdown } from "../SL-core/SL-frontmatter.js";
import { slWithRepositoryMutationLock } from "../SL-core/SL-mutation-lock.js";
import {
  slPromotedProbationPath,
  slRewriteAndMoveEvidenceFromQuarantine,
  slRewriteAndMovePromotionToProbation,
} from "../SL-core/SL-promotion-path.js";
import type { SLArtifactTransferHooks } from "../SL-core/SL-promotion-path.js";
import {
  slAppendEvents,
  slAssertEventPathSafe,
  slFindArtifact,
  slLoadRegistry,
  slSaveRegistry,
} from "../SL-core/SL-registry.js";
import {
  slLoadScopeCatalog,
  slScopeDescriptors,
} from "../SL-core/SL-scope.js";
import {
  SL_DEFAULT_SCOPE,
  slBuildStateCatalog,
  slLoadStateCatalog,
  slNormalizeScope,
  slScopeKey,
} from "../SL-core/SL-state.js";
import type {
  SLChange,
  SLEvent,
  SLRegistry,
  SLRegistryArtifact,
  SLStatus,
  SLSweepResult,
} from "../SL-core/SL-types.js";
import {
  slAddDays,
  slAgeDays,
  slAssertRealPathInside,
  slCompareOrdinal,
  slDelete,
  slExists,
  slMove,
  slReadContainedText,
  slResolveInside,
  slWriteText,
} from "../SL-core/SL-utils.js";
import {
  slReadOwnedArtifactMarkdown,
  slSynchronizeUsageProjectionUnlocked,
} from "../SL-core/SL-usage.js";
import { slWriteIndex } from "../SL-index/SL-index.js";

type SLFileSnapshot =
  | { path: string; exists: false }
  | { path: string; exists: true; content: Buffer };

async function slSnapshotFile(
  root: string,
  relativePath: string,
): Promise<SLFileSnapshot> {
  await slAssertRealPathInside(root, relativePath);
  const path = slResolveInside(root, relativePath);
  if (!(await slExists(path))) {
    return { path: relativePath, exists: false };
  }
  return {
    path: relativePath,
    exists: true,
    content: await readFile(path),
  };
}

async function slRestoreFileSnapshot(
  root: string,
  snapshot: SLFileSnapshot,
): Promise<void> {
  await slAssertRealPathInside(root, snapshot.path);
  const path = slResolveInside(root, snapshot.path);
  if (!snapshot.exists) {
    await rm(path, { force: true });
    return;
  }

  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.SL-tmp-${randomUUID()}`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, "wx");
    await handle.writeFile(snapshot.content);
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, path);
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function slRestoreStatePaths(
  root: string,
  registry: SLRegistry,
): Promise<string[]> {
  const currentCatalog = await slLoadStateCatalog(root);
  const scopes = new Map(
    currentCatalog.scopes.map((entry) => [
      slScopeKey(entry.scope),
      entry.scope,
    ]),
  );
  for (const scope of slScopeDescriptors(await slLoadScopeCatalog(root))) {
    scopes.set(slScopeKey(scope), scope);
  }
  for (const artifact of registry.artifacts) {
    const scope = slNormalizeScope(artifact.scope ?? SL_DEFAULT_SCOPE);
    scopes.set(slScopeKey(scope), scope);
  }
  const plannedCatalog = slBuildStateCatalog(scopes.values());
  const paths = new Set<string>([
    SL_PATHS.registry,
    SL_PATHS.index,
    SL_PATHS.stateCatalog,
  ]);
  for (const entry of plannedCatalog.scopes) {
    paths.add(entry.registryPath);
    paths.add(entry.indexPath);
    paths.add(entry.projectionPath);
  }
  return [...paths].sort(slCompareOrdinal);
}

async function slSnapshotRestoreState(
  root: string,
  registry: SLRegistry,
): Promise<SLFileSnapshot[]> {
  const snapshots: SLFileSnapshot[] = [];
  for (const path of await slRestoreStatePaths(root, registry)) {
    snapshots.push(await slSnapshotFile(root, path));
  }
  return snapshots;
}

async function slRestoreStateSnapshots(
  root: string,
  snapshots: SLFileSnapshot[],
): Promise<void> {
  const ordered = [
    ...snapshots.filter(
      (snapshot) => snapshot.path !== SL_PATHS.stateCatalog,
    ),
    ...snapshots.filter(
      (snapshot) => snapshot.path === SL_PATHS.stateCatalog,
    ),
  ];
  for (const snapshot of ordered) {
    await slRestoreFileSnapshot(root, snapshot);
  }
}

function slHasActiveIncomingReference(
  registry: SLRegistry,
  targetId: string,
): boolean {
  return registry.artifacts.some(
    (artifact) =>
      artifact.id !== targetId &&
      SL_REFERENCE_PROTECTING_STATUSES.has(artifact.status) &&
      (artifact.dependsOn ?? []).includes(targetId),
  );
}

async function slAssertArtifactFileOwnership(
  root: string,
  artifact: SLRegistryArtifact,
): Promise<void> {
  if (!artifact.path || !artifact.path.endsWith(".md")) {
    throw new Error(
      `Artifact ${artifact.id} is not an SL-managed Markdown artifact.`,
    );
  }
  const absolutePath = slResolveInside(root, artifact.path);
  if (!(await slExists(absolutePath))) {
    throw new Error(`Artifact ${artifact.id} is missing at ${artifact.path}.`);
  }
  let markdown;
  try {
    markdown = slParseMarkdown<Record<string, unknown>>(
      await slReadContainedText(root, artifact.path),
    );
  } catch {
    throw new Error(
      `Artifact ${artifact.id} file ownership does not match the registry.`,
    );
  }
  if (
    markdown.frontmatter.id !== artifact.id ||
    markdown.frontmatter.managedBy !== "SL-Repo" ||
    markdown.frontmatter.status !== artifact.status ||
    markdown.frontmatter.pinned !== artifact.pinned
  ) {
    throw new Error(
      `Artifact ${artifact.id} file ownership does not match the registry.`,
    );
  }
}

async function slSetFileStatus(
  root: string,
  artifact: SLRegistryArtifact,
  status: SLStatus,
  dryRun: boolean,
  changes: SLChange[],
): Promise<void> {
  if (!artifact.path || !artifact.path.endsWith(".md")) {
    return;
  }
  const absolutePath = slResolveInside(root, artifact.path);
  if (!(await slExists(absolutePath))) {
    return;
  }
  const markdown = slParseMarkdown<Record<string, unknown>>(
    await slReadContainedText(root, artifact.path),
  );
  markdown.frontmatter.status = status;
  await slWriteText(
    root,
    artifact.path,
    slStringifyMarkdown(markdown.frontmatter, markdown.body),
    dryRun,
    changes,
  );
}

async function slQuarantine(
  root: string,
  artifact: SLRegistryArtifact,
  reason: NonNullable<SLRegistryArtifact["forgetReason"]>,
  graceDays: number,
  now: Date,
  dryRun: boolean,
  changes: SLChange[],
  events: SLEvent[],
): Promise<void> {
  if (!artifact.path) {
    throw new Error(`Artifact ${artifact.id} has no active path.`);
  }
  const sourcePath = artifact.path;
  const targetPath = `${SL_PATHS.quarantine}/${artifact.id}/${basename(sourcePath)}`;
  const previousStatus = artifact.status;
  await slSetFileStatus(root, artifact, "quarantined", dryRun, changes);
  await slMove(root, sourcePath, targetPath, dryRun, changes);

  artifact.originalPath ??= sourcePath;
  artifact.path = targetPath;
  artifact.previousStatus = previousStatus;
  artifact.status = "quarantined";
  artifact.forgetReason = reason;
  artifact.quarantinedAt = now.toISOString();
  artifact.deleteEligibleAt = slAddDays(now, graceDays).toISOString();
  events.push({
    schemaVersion: 1,
    timestamp: now.toISOString(),
    artifactId: artifact.id,
    action: "quarantined",
    reason,
    fromStatus: previousStatus,
    toStatus: "quarantined",
    fromPath: sourcePath,
    toPath: targetPath,
  });
}

async function slCanDelete(
  root: string,
  registry: SLRegistry,
  artifact: SLRegistryArtifact,
  now: Date,
): Promise<string | null> {
  if (artifact.managedBy !== "SL-Repo") {
    return "artifact is not SL-managed";
  }
  if (artifact.classification === "system") {
    return "system artifacts are protected";
  }
  if (artifact.pinned) {
    return "artifact is pinned";
  }
  if (artifact.status !== "quarantined") {
    return "artifact is not quarantined";
  }
  if (!artifact.path || !artifact.deleteEligibleAt) {
    return "quarantine metadata is incomplete";
  }
  const deleteEligibleAt = new Date(artifact.deleteEligibleAt);
  if (Number.isNaN(deleteEligibleAt.getTime())) {
    return "delete eligibility timestamp is invalid";
  }
  if (deleteEligibleAt > now) {
    return "quarantine grace period has not elapsed";
  }
  if (slHasActiveIncomingReference(registry, artifact.id)) {
    return "artifact has an active dependent";
  }
  await slAssertArtifactFileOwnership(root, artifact);
  return null;
}

export async function slForgetArtifact(
  root: string,
  id: string,
  reason: "wrong" | "irrelevant" | "superseded",
  dryRun: boolean,
  now = new Date(),
): Promise<SLSweepResult> {
  return slWithRepositoryMutationLock(root, () =>
    slForgetArtifactUnlocked(root, id, reason, dryRun, now),
    { dryRun },
  );
}

async function slForgetArtifactUnlocked(
  root: string,
  id: string,
  reason: "wrong" | "irrelevant" | "superseded",
  dryRun: boolean,
  now: Date,
): Promise<SLSweepResult> {
  await slAssertEventPathSafe(root);
  const config = await slLoadConfig(root);
  const registry = await slLoadRegistry(root);
  const artifact = slFindArtifact(registry, id);
  if (artifact.classification === "system") {
    throw new Error("System artifacts cannot be forgotten.");
  }
  if (artifact.pinned) {
    throw new Error("Pinned artifacts must be unpinned before forgetting.");
  }
  if (artifact.status === "deleted") {
    throw new Error("Deleted artifacts cannot be forgotten again.");
  }
  if (artifact.status === "quarantined") {
    throw new Error("Artifact is already quarantined.");
  }
  if (slHasActiveIncomingReference(registry, artifact.id)) {
    throw new Error("Artifact has an active dependent and cannot be forgotten.");
  }
  await slAssertArtifactFileOwnership(root, artifact);

  const changes: SLChange[] = [];
  const events: SLEvent[] = [];
  const graceDays =
    reason === "wrong"
      ? config.retention.wrongDeleteAfterDays
      : config.retention.deleteAfterQuarantineDays;
  await slQuarantine(
    root,
    artifact,
    reason,
    graceDays,
    now,
    dryRun,
    changes,
    events,
  );
  await slSaveRegistry(root, registry, dryRun, changes);
  await slWriteIndex(root, registry, dryRun, changes);
  await slAppendEvents(root, events, dryRun);
  return { changes, events };
}

export async function slRestoreArtifact(
  root: string,
  id: string,
  dryRun: boolean,
  now = new Date(),
  transferHooks: SLArtifactTransferHooks = {},
): Promise<SLSweepResult> {
  return slWithRepositoryMutationLock(root, () =>
    slRestoreArtifactUnlocked(root, id, dryRun, now, transferHooks),
    { dryRun },
  );
}

async function slRestoreArtifactUnlocked(
  root: string,
  id: string,
  dryRun: boolean,
  now: Date,
  transferHooks: SLArtifactTransferHooks,
): Promise<SLSweepResult> {
  await slAssertEventPathSafe(root);
  const registry = await slLoadRegistry(root);
  const artifact = slFindArtifact(registry, id);
  if (
    artifact.status !== "quarantined" ||
    !artifact.path ||
    !artifact.originalPath
  ) {
    throw new Error("Only quarantined artifacts with an original path can be restored.");
  }
  await slAssertArtifactFileOwnership(root, artifact);
  const changes: SLChange[] = [];
  const events: SLEvent[] = [];
  const quarantinePath = artifact.path;
  const promotedRestore =
    artifact.classification === "promoted" &&
    (artifact.artifactType === "instruction" ||
      artifact.artifactType === "skill");
  const promotionTargetPath = promotedRestore
    ? artifact.promotionTargetPath ?? artifact.originalPath
    : undefined;
  const restorePath =
    promotedRestore && promotionTargetPath
      ? slPromotedProbationPath(artifact, promotionTargetPath)
      : artifact.originalPath;
  const restoredStatus = promotedRestore
    ? "probation"
    : artifact.previousStatus ?? "raw";
  const stateSnapshots = dryRun
    ? []
    : await slSnapshotRestoreState(root, registry);
  let rollback: (() => Promise<void>) | undefined;
  try {
    const snapshot = promotedRestore
      ? await slReadOwnedArtifactMarkdown(
          root,
          artifact,
          artifact.artifactType,
          "promoted",
        )
      : await slReadOwnedArtifactMarkdown(root, artifact, undefined, "evidence");
    snapshot.frontmatter.status = restoredStatus;
    if (promotedRestore) {
      rollback = await slRewriteAndMovePromotionToProbation(
        root,
        registry,
        artifact,
        quarantinePath,
        restorePath,
        snapshot.content,
        slStringifyMarkdown(snapshot.frontmatter, snapshot.body),
        dryRun,
        changes,
        transferHooks,
      );
    } else {
      rollback = await slRewriteAndMoveEvidenceFromQuarantine(
        root,
        registry,
        artifact,
        quarantinePath,
        restorePath,
        snapshot.content,
        slStringifyMarkdown(snapshot.frontmatter, snapshot.body),
        dryRun,
        changes,
        transferHooks,
      );
    }
    artifact.path = restorePath;
    artifact.status = restoredStatus;
    if (promotedRestore && promotionTargetPath) {
      artifact.promotionTargetPath = promotionTargetPath;
      delete artifact.promotionEvaluation;
      delete artifact.activatedAt;
      delete artifact.originalPath;
    }
    delete artifact.previousStatus;
    delete artifact.quarantinedAt;
    delete artifact.deleteEligibleAt;
    delete artifact.forgetReason;
    events.push({
      schemaVersion: 1,
      timestamp: now.toISOString(),
      artifactId: artifact.id,
      action: "restored",
      fromStatus: "quarantined",
      toStatus: restoredStatus,
      fromPath: quarantinePath,
      toPath: artifact.path,
    });
    await slSaveRegistry(root, registry, dryRun, changes);
    await slWriteIndex(root, registry, dryRun, changes);
    await slAppendEvents(root, events, dryRun);
    return { changes, events };
  } catch (error) {
    if (!dryRun) {
      const rollbackErrors: unknown[] = [];
      if (rollback) {
        try {
          await rollback();
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      try {
        await slRestoreStateSnapshots(root, stateSnapshots);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          "Artifact restore failed and rollback could not complete.",
        );
      }
    }
    throw error;
  }
}

export async function slSweep(
  root: string,
  dryRun: boolean,
  now = new Date(),
): Promise<SLSweepResult> {
  return slWithRepositoryMutationLock(root, () =>
    slSweepUnlocked(root, dryRun, now),
    { dryRun },
  );
}

async function slSweepUnlocked(
  root: string,
  dryRun: boolean,
  now: Date,
): Promise<SLSweepResult> {
  await slAssertEventPathSafe(root);
  const config = await slLoadConfig(root);
  const changes: SLChange[] = [];
  const registry = await slSynchronizeUsageProjectionUnlocked(
    root,
    dryRun,
    changes,
  );
  const events: SLEvent[] = [];

  for (const artifact of registry.artifacts) {
    if (
      artifact.classification === "system" ||
      artifact.pinned ||
      artifact.status === "deleted" ||
      artifact.status === "superseded"
    ) {
      continue;
    }

    if (
      artifact.status !== "quarantined" &&
      slHasActiveIncomingReference(registry, artifact.id)
    ) {
      changes.push({
        action: "skip",
        path: artifact.path ?? artifact.id,
        detail: "artifact has an active dependent",
      });
      continue;
    }

    if (artifact.status === "quarantined") {
      const blockReason = await slCanDelete(root, registry, artifact, now);
      if (blockReason) {
        changes.push({
          action: "skip",
          path: artifact.path ?? artifact.id,
          detail: blockReason,
        });
        continue;
      }

      await slAssertArtifactFileOwnership(root, artifact);
      const deletedPath = artifact.path;
      await slDelete(root, deletedPath!, dryRun, changes);
      artifact.path = null;
      artifact.status = "deleted";
      artifact.deletedAt = now.toISOString();
      events.push({
        schemaVersion: 1,
        timestamp: now.toISOString(),
        artifactId: artifact.id,
        action: "deleted",
        reason: artifact.forgetReason ?? "retention elapsed",
        fromStatus: "quarantined",
        toStatus: "deleted",
        fromPath: deletedPath,
        toPath: null,
      });
      continue;
    }

    const activityTimestamp =
      artifact.lastSuccessfulUseAt ??
      artifact.usageProjection?.lastVerifiedSuccessAt ??
      artifact.lastVerifiedAt ??
      artifact.createdAt;
    const activityAge = slAgeDays(now, activityTimestamp);
    const isPromoted = artifact.classification === "promoted";

    if (artifact.status === "stale") {
      const staleAge = artifact.staleAt
        ? slAgeDays(now, artifact.staleAt)
        : activityAge;
      const shouldQuarantine = isPromoted
        ? staleAge >= config.retention.promotedQuarantineAfterDays
        : activityAge >= config.retention.quarantineAfterDays;
      if (shouldQuarantine) {
        await slQuarantine(
          root,
          artifact,
          "unused",
          config.retention.deleteAfterQuarantineDays,
          now,
          dryRun,
          changes,
          events,
        );
      }
      continue;
    }

    const staleAfterDays = isPromoted
      ? config.retention.promotedStaleAfterDays
      : config.retention.staleAfterDays;
    if (activityAge >= staleAfterDays) {
      const previousStatus = artifact.status;
      artifact.previousStatus = previousStatus;
      artifact.status = "stale";
      artifact.staleAt = now.toISOString();
      artifact.forgetReason = "unused";
      await slSetFileStatus(root, artifact, "stale", dryRun, changes);
      events.push({
        schemaVersion: 1,
        timestamp: now.toISOString(),
        artifactId: artifact.id,
        action: "marked-stale",
        reason: "unused",
        fromStatus: previousStatus,
        toStatus: "stale",
        fromPath: artifact.path,
        toPath: artifact.path,
      });
    }
  }

  await slSaveRegistry(root, registry, dryRun, changes);
  await slWriteIndex(root, registry, dryRun, changes);
  await slAppendEvents(root, events, dryRun);
  return { changes, events };
}
