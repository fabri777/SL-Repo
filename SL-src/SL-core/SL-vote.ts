import { randomUUID } from "node:crypto";
import { SL_ACTIVE_STATUSES } from "./SL-constants.js";
import { slWithRepositoryMutationLock } from "./SL-mutation-lock.js";
import {
  slFindArtifact,
  slLoadRegistry,
} from "./SL-registry.js";
import type { SLChange } from "./SL-types.js";
import {
  slArtifactUsageContentHash,
  slArtifactVersion,
  slAssertVoteApplicationMutation,
  slCreateUsageEvent,
  slLoadUsageOwnershipSnapshots,
  slLoadUsageEvents,
  slReadOwnedArtifactMarkdown,
  slSynchronizeUsageProjectionUnlocked,
  slWriteUsageOperationEvent,
} from "./SL-usage.js";

export interface SLVoteContext {
  taskRunId?: string;
  applicationId?: string;
  idempotencyKey?: string;
  verifierType?: string;
  evidenceRef?: string;
}

export async function slVoteOnLesson(
  root: string,
  id: string,
  vote: "useful" | "not-useful",
  dryRun: boolean,
  now = new Date(),
  context: SLVoteContext = {},
): Promise<SLChange[]> {
  return slWithRepositoryMutationLock(root, () =>
    slVoteOnLessonUnlocked(root, id, vote, dryRun, now, context),
    { dryRun },
  );
}

async function slVoteOnLessonUnlocked(
  root: string,
  id: string,
  vote: "useful" | "not-useful",
  dryRun: boolean,
  now: Date,
  context: SLVoteContext,
): Promise<SLChange[]> {
  const registry = await slLoadRegistry(root);
  const artifact = slFindArtifact(registry, id);
  if (
    artifact.artifactType !== "lesson" ||
    artifact.classification !== "evidence"
  ) {
    throw new Error("Only SL lesson evidence can receive reuse votes.");
  }
  if (!SL_ACTIVE_STATUSES.has(artifact.status) || !artifact.path) {
    throw new Error("Only active lesson evidence can receive reuse votes.");
  }

  const snapshot = await slReadOwnedArtifactMarkdown(
    root,
    artifact,
    "lesson",
    "evidence",
  );

  const timestamp = now.toISOString();
  const artifactContentHash = slArtifactUsageContentHash(
    snapshot.content,
  );
  const artifactVersion = slArtifactVersion(artifactContentHash);
  const applicationId = context.applicationId ?? `vote-${randomUUID()}`;
  const taskRunId = context.taskRunId ?? applicationId;
  const usageEvent = slCreateUsageEvent({
    artifactId: id,
    artifactContentHash,
    taskRunId,
    applicationId,
    stage: "verified",
    outcome: vote === "useful" ? "success" : "failure",
    verifierType: context.verifierType ?? "lesson-vote",
    timestamp,
    idempotencyKey:
      context.idempotencyKey ??
      `lesson-vote:${id}:${artifactVersion}:${applicationId}`,
    ...(context.evidenceRef ? { evidenceRef: context.evidenceRef } : {}),
  });
  const existingUsageEvents = await slLoadUsageEvents(root);
  slAssertVoteApplicationMutation(existingUsageEvents, usageEvent);
  const projectedEvents = existingUsageEvents.some(
    (event) => event.eventId === usageEvent.eventId,
  )
    ? existingUsageEvents
    : [...existingUsageEvents, usageEvent];
  await slLoadUsageOwnershipSnapshots(root, registry, projectedEvents);
  const changes: SLChange[] = [];
  changes.push(
    await slWriteUsageOperationEvent(
      root,
      usageEvent,
      existingUsageEvents,
      dryRun,
    ),
  );
  await slSynchronizeUsageProjectionUnlocked(
    root,
    dryRun,
    changes,
    projectedEvents,
  );
  return changes;
}
