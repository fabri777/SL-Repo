import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { SL_PATHS } from "./SL-constants.js";
import type {
  SLChange,
  SLEvent,
  SLRegistry,
  SLRegistryArtifact,
} from "./SL-types.js";
import {
  slAssertRealPathInside,
  slExists,
  slReadJson,
  slResolveInside,
  slWriteJson,
} from "./SL-utils.js";

export async function slAssertEventPathSafe(root: string): Promise<void> {
  await slAssertRealPathInside(root, SL_PATHS.events);
}

export function slEmptyRegistry(): SLRegistry {
  return { schemaVersion: 1, artifacts: [] };
}

export async function slLoadRegistry(root: string): Promise<SLRegistry> {
  const path = slResolveInside(root, SL_PATHS.registry);
  if (!(await slExists(path))) {
    return slEmptyRegistry();
  }
  return slReadJson<SLRegistry>(path);
}

export async function slSaveRegistry(
  root: string,
  registry: SLRegistry,
  dryRun: boolean,
  changes: SLChange[],
): Promise<void> {
  registry.artifacts.sort((left, right) => left.id.localeCompare(right.id));
  await slWriteJson(root, SL_PATHS.registry, registry, dryRun, changes);
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
  if (dryRun || events.length === 0) {
    return;
  }
  await slAssertEventPathSafe(root);
  const path = slResolveInside(root, SL_PATHS.events);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(
    path,
    events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    "utf8",
  );
}
