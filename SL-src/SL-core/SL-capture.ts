import { SL_PATHS } from "./SL-constants.js";
import { slStringifyMarkdown } from "./SL-frontmatter.js";
import { slWithRepositoryMutationLock } from "./SL-mutation-lock.js";
import {
  slAppendEvents,
  slAssertEventPathSafe,
  slLoadRegistry,
  slSaveRegistry,
  slUpsertArtifact,
} from "./SL-registry.js";
import type {
  SLChange,
  SLEvent,
  SLRegistryArtifact,
  SLScopeDescriptor,
} from "./SL-types.js";
import { SL_DEFAULT_SCOPE, slNormalizeScope } from "./SL-state.js";
import { slResolveScopeDescriptor } from "./SL-scope.js";
import {
  slDateOnly,
  slExists,
  slResolveInside,
  slSlugify,
  slWriteText,
} from "./SL-utils.js";
import { slWriteIndex } from "../SL-index/SL-index.js";

export interface SLCaptureOptions {
  title: string;
  kind: "win" | "pitfall" | "mixed";
  scope: string;
  triggers: string[];
  dryRun: boolean;
  now?: Date;
  stateScope?: SLScopeDescriptor;
  scopeId?: string;
  targetPath?: string;
  currentDirectory?: string;
}

export async function slCaptureLesson(
  root: string,
  options: SLCaptureOptions,
): Promise<{ id: string; path: string; changes: SLChange[] }> {
  return slWithRepositoryMutationLock(root, () =>
    slCaptureLessonUnlocked(root, options),
    { dryRun: options.dryRun },
  );
}

async function slCaptureLessonUnlocked(
  root: string,
  options: SLCaptureOptions,
): Promise<{ id: string; path: string; changes: SLChange[] }> {
  const now = options.now ?? new Date();
  await slAssertEventPathSafe(root);
  const date = slDateOnly(now);
  const slug = slSlugify(options.title);
  if (!slug) {
    throw new Error("Lesson title must contain letters or numbers.");
  }
  if (options.triggers.length === 0) {
    throw new Error("At least one trigger is required.");
  }

  const registry = await slLoadRegistry(root);
  const resolvedStateScope = options.stateScope
    ? slNormalizeScope(options.stateScope)
    : (
        await slResolveScopeDescriptor(root, {
          ...(options.scopeId ? { scopeId: options.scopeId } : {}),
          ...(options.targetPath ? { targetPath: options.targetPath } : {}),
          ...(options.currentDirectory
            ? { currentDirectory: options.currentDirectory }
            : {}),
        })
      ).scope;
  const baseId = `SL-${date.replaceAll("-", "")}-${slug.toUpperCase()}`;
  let id = baseId;
  let suffix = 2;
  while (registry.artifacts.some((artifact) => artifact.id === id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }

  const month = date.slice(0, 7);
  const path = `${SL_PATHS.lessons}/${month}/SL-${date}-${slug}.md`;
  if (await slExists(slResolveInside(root, path))) {
    throw new Error(`Lesson file already exists: ${path}`);
  }

  const frontmatter = {
    id,
    schemaVersion: 1,
    managedBy: "SL-Repo",
    date,
    kind: options.kind,
    scope: options.scope,
    status: "raw",
    trigger: [...new Set(options.triggers.map((value) => value.trim()).filter(Boolean))],
    hits: 0,
    retrievals: 0,
    lastVerifiedAt: date,
    pinned: false,
    relatedTo: [],
  };
  const body = [
    "## Context",
    "Describe the verified situation that produced this lesson.",
    "",
    ...(options.kind !== "pitfall"
      ? ["## What worked", "- Replace with the verified reusable approach.", ""]
      : []),
    ...(options.kind !== "win"
      ? [
          "## What did NOT work",
          "- Replace with the failed approach and the symptom that exposed it.",
          "",
        ]
      : []),
    "## Why",
    "Explain the underlying reason so the lesson generalizes.",
    "",
    "## Re-use cue",
    "- Describe when a future agent should retrieve this lesson.",
  ].join("\n");

  const changes: SLChange[] = [];
  await slWriteText(
    root,
    path,
    slStringifyMarkdown(frontmatter, body),
    options.dryRun,
    changes,
  );

  const timestamp = now.toISOString();
  const artifact: SLRegistryArtifact = {
    id,
    path,
    artifactType: "lesson",
    classification: "evidence",
    managedBy: "SL-Repo",
    status: "raw",
    createdAt: timestamp,
    lastVerifiedAt: timestamp,
    pinned: false,
    relatedTo: [],
    trigger: frontmatter.trigger,
    hits: 0,
    retrievals: 0,
    notUsefulVotes: 0,
    scope: resolvedStateScope ?? SL_DEFAULT_SCOPE,
  };
  slUpsertArtifact(registry, artifact);
  await slSaveRegistry(root, registry, options.dryRun, changes);
  await slWriteIndex(root, registry, options.dryRun, changes);

  const event: SLEvent = {
    schemaVersion: 1,
    timestamp,
    artifactId: id,
    action: "captured",
    toStatus: "raw",
    toPath: path,
  };
  await slAppendEvents(root, [event], options.dryRun);
  return { id, path, changes };
}
