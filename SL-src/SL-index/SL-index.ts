import { SL_ACTIVE_STATUSES, SL_PATHS } from "../SL-core/SL-constants.js";
import type { SLChange, SLIndex, SLRegistry } from "../SL-core/SL-types.js";
import { slExists, slResolveInside, slWriteJson } from "../SL-core/SL-utils.js";

export async function slBuildIndex(
  root: string,
  registry: SLRegistry,
): Promise<SLIndex> {
  const artifacts = [];
  for (const artifact of registry.artifacts) {
    if (
      !artifact.path ||
      artifact.classification === "system" ||
      !SL_ACTIVE_STATUSES.has(artifact.status)
    ) {
      continue;
    }
    if (!(await slExists(slResolveInside(root, artifact.path)))) {
      continue;
    }
    artifacts.push({
      id: artifact.id,
      path: artifact.path,
      artifactType: artifact.artifactType,
      status: artifact.status,
      ...(artifact.trigger ? { trigger: [...artifact.trigger].sort() } : {}),
      ...(artifact.hits !== undefined ? { hits: artifact.hits } : {}),
      ...(artifact.retrievals !== undefined
        ? { retrievals: artifact.retrievals }
        : {}),
      ...(artifact.notUsefulVotes !== undefined
        ? { notUsefulVotes: artifact.notUsefulVotes }
        : {}),
      relatedTo: [...artifact.relatedTo].sort(),
      ...(artifact.dependsOn
        ? { dependsOn: [...artifact.dependsOn].sort() }
        : {}),
    });
  }
  artifacts.sort((left, right) => left.id.localeCompare(right.id));
  return { schemaVersion: 1, artifacts };
}

export async function slWriteIndex(
  root: string,
  registry: SLRegistry,
  dryRun: boolean,
  changes: SLChange[],
): Promise<SLIndex> {
  const index = await slBuildIndex(root, registry);
  await slWriteJson(root, SL_PATHS.index, index, dryRun, changes);
  return index;
}
