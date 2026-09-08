import { SL_ACTIVE_STATUSES } from "../SL-core/SL-constants.js";
import {
  slIsActivePromotionStatus,
  slPromotionEvaluationIsCurrent,
} from "../SL-core/SL-promotion-lifecycle.js";
import {
  SL_DEFAULT_SCOPE,
  slLoadStateCatalog,
  slNormalizeScope,
  slScopeKey,
} from "../SL-core/SL-state.js";
import type {
  SLChange,
  SLIndex,
  SLRegistry,
  SLScopeUsageProjection,
  SLUsageProjection,
} from "../SL-core/SL-types.js";
import {
  slCompareOrdinal,
  slExists,
  slResolveInside,
  slWriteJson,
} from "../SL-core/SL-utils.js";

export async function slBuildIndex(
  root: string,
  registry: SLRegistry,
  scope = SL_DEFAULT_SCOPE,
): Promise<SLIndex> {
  const normalizedScope = slNormalizeScope(scope);
  const artifacts = [];
  for (const artifact of registry.artifacts) {
    if (
      slScopeKey(artifact.scope ?? SL_DEFAULT_SCOPE) !==
        slScopeKey(normalizedScope) ||
      !artifact.path ||
      artifact.classification === "system" ||
      !SL_ACTIVE_STATUSES.has(artifact.status)
    ) {
      continue;
    }
    if (!(await slExists(slResolveInside(root, artifact.path)))) {
      continue;
    }
    if (artifact.classification === "promoted") {
      if (!slIsActivePromotionStatus(artifact.status)) {
        continue;
      }
      if (
        artifact.status === "active" &&
        !(await slPromotionEvaluationIsCurrent(root, artifact))
      ) {
        continue;
      }
    }
    artifacts.push({
      id: artifact.id,
      path: artifact.path,
      artifactType: artifact.artifactType,
      status: artifact.status,
      ...(artifact.trigger
        ? { trigger: [...artifact.trigger].sort(slCompareOrdinal) }
        : {}),
      relatedTo: [...artifact.relatedTo].sort(slCompareOrdinal),
      ...(artifact.dependsOn
        ? { dependsOn: [...artifact.dependsOn].sort(slCompareOrdinal) }
        : {}),
    });
  }
  artifacts.sort((left, right) => slCompareOrdinal(left.id, right.id));
  return { schemaVersion: 2, scope: normalizedScope, artifacts };
}

export async function slBuildScopeIndexes(
  root: string,
  registry: SLRegistry,
): Promise<Map<string, SLIndex>> {
  const catalog = await slLoadStateCatalog(root);
  const scopes = new Map(
    catalog.scopes.map((entry) => [slScopeKey(entry.scope), entry.scope]),
  );
  for (const artifact of registry.artifacts) {
    const scope = slNormalizeScope(artifact.scope ?? SL_DEFAULT_SCOPE);
    scopes.set(slScopeKey(scope), scope);
  }
  const indexes = new Map<string, SLIndex>();
  for (const [key, scope] of [...scopes.entries()].sort(([left], [right]) =>
    slCompareOrdinal(left, right),
  )) {
    indexes.set(key, await slBuildIndex(root, registry, scope));
  }
  return indexes;
}

export async function slWriteIndex(
  root: string,
  registry: SLRegistry,
  dryRun: boolean,
  changes: SLChange[],
  projections?: SLUsageProjection[],
  writeJson: typeof slWriteJson = slWriteJson,
): Promise<Map<string, SLIndex>> {
  const catalog = await slLoadStateCatalog(root);
  const indexes = await slBuildScopeIndexes(root, registry);
  for (const entry of catalog.scopes) {
    const key = slScopeKey(entry.scope);
    const index =
      indexes.get(key) ??
      ({ schemaVersion: 2, scope: entry.scope, artifacts: [] } satisfies SLIndex);
    await writeJson(root, entry.indexPath, index, dryRun, changes);
  }
  if (projections) {
    const completeProjections = new Map(
      projections.map((projection) => [
        `${slScopeKey(projection.scope)}\0${projection.artifactId}\0${projection.artifactVersion}`,
        projection,
      ]),
    );
    for (const artifact of registry.artifacts) {
      if (!artifact.usageProjection) {
        continue;
      }
      const projection = artifact.usageProjection;
      completeProjections.set(
        `${slScopeKey(projection.scope)}\0${projection.artifactId}\0${projection.artifactVersion}`,
        projection,
      );
    }
    for (const entry of catalog.scopes) {
      const key = slScopeKey(entry.scope);
      const shard: SLScopeUsageProjection = {
        schemaVersion: 1,
        scope: entry.scope,
        currentArtifactVersions: Object.fromEntries(
          registry.artifacts
            .filter(
              (artifact) =>
                slScopeKey(artifact.scope ?? SL_DEFAULT_SCOPE) === key &&
                artifact.usageProjection,
            )
            .sort((left, right) => slCompareOrdinal(left.id, right.id))
            .map((artifact) => [
              artifact.id,
              artifact.usageProjection!.artifactVersion,
            ]),
        ),
        projections: [...completeProjections.values()]
          .filter(
            (projection) =>
              slScopeKey(projection.scope) === slScopeKey(entry.scope),
          )
          .sort(
            (left, right) =>
              slCompareOrdinal(left.artifactId, right.artifactId) ||
              slCompareOrdinal(
                left.artifactVersion,
                right.artifactVersion,
              ),
          ),
      };
      if (
        shard.projections.length === 0 &&
        Object.keys(shard.currentArtifactVersions).length === 0 &&
        !(await slExists(slResolveInside(root, entry.projectionPath)))
      ) {
        continue;
      }
      await writeJson(
        root,
        entry.projectionPath,
        shard,
        dryRun,
        changes,
      );
    }
  }
  return indexes;
}
