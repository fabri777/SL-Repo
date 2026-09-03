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
} from "./SL-types.js";
import {
  slAssertRealPathInside,
  slCanonicalJson,
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
