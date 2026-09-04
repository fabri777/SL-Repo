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
import { slExists, slResolveInside, slWriteJson } from "../SL-core/SL-utils.js";

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
      ...(artifact.trigger ? { trigger: [...artifact.trigger].sort() } : {}),
      relatedTo: [...artifact.relatedTo].sort(),
      ...(artifact.dependsOn
        ? { dependsOn: [...artifact.dependsOn].sort() }
        : {}),
    });
  }
  artifacts.sort((left, right) => left.id.localeCompare(right.id));
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
    left.localeCompare(right),
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
): Promise<Map<string, SLIndex>> {
  const catalog = await slLoadStateCatalog(root);
  const indexes = await slBuildScopeIndexes(root, registry);
  for (const entry of catalog.scopes) {
    const key = slScopeKey(entry.scope);
    const index =
      indexes.get(key) ??
      ({ schemaVersion: 2, scope: entry.scope, artifacts: [] } satisfies SLIndex);
    await slWriteJson(root, entry.indexPath, index, dryRun, changes);
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
            .sort((left, right) => left.id.localeCompare(right.id))
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
              left.artifactId.localeCompare(right.artifactId) ||
              left.artifactVersion.localeCompare(right.artifactVersion),
          ),
      };
      await slWriteJson(
        root,
        entry.projectionPath,
        shard,
        dryRun,
        changes,
      );
    }
  } else {
    for (const entry of catalog.scopes) {
      if (await slExists(slResolveInside(root, entry.projectionPath))) {
        continue;
      }
      const shard: SLScopeUsageProjection = {
        schemaVersion: 1,
        scope: entry.scope,
        currentArtifactVersions: {},
        projections: [],
      };
      await slWriteJson(
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
