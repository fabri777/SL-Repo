import { SL_ACTIVE_STATUSES } from "./SL-constants.js";
import { slParseMarkdown, slStringifyMarkdown } from "./SL-frontmatter.js";
import {
  slAppendEvents,
  slAssertEventPathSafe,
  slFindArtifact,
  slLoadRegistry,
  slSaveRegistry,
} from "./SL-registry.js";
import type { SLChange, SLEvent } from "./SL-types.js";
import {
  slReadText,
  slResolveInside,
  slWriteText,
} from "./SL-utils.js";
import { slWriteIndex } from "../SL-index/SL-index.js";

export async function slVoteOnLesson(
  root: string,
  id: string,
  vote: "useful" | "not-useful",
  dryRun: boolean,
  now = new Date(),
): Promise<SLChange[]> {
  await slAssertEventPathSafe(root);
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

  const markdown = slParseMarkdown<Record<string, unknown>>(
    await slReadText(slResolveInside(root, artifact.path)),
  );
  if (
    markdown.frontmatter.id !== id ||
    markdown.frontmatter.managedBy !== "SL-Repo"
  ) {
    throw new Error(`Lesson ${id} file ownership does not match the registry.`);
  }

  const timestamp = now.toISOString();
  const retrievals = (artifact.retrievals ?? 0) + 1;
  artifact.retrievals = retrievals;
  artifact.lastRetrievedAt = timestamp;
  markdown.frontmatter.retrievals = retrievals;
  markdown.frontmatter.lastRetrievedAt = timestamp;

  if (vote === "useful") {
    const hits = (artifact.hits ?? 0) + 1;
    artifact.hits = hits;
    artifact.lastSuccessfulUseAt = timestamp;
    artifact.lastVerifiedAt = timestamp;
    markdown.frontmatter.hits = hits;
    markdown.frontmatter.lastSuccessfulUseAt = timestamp;
    markdown.frontmatter.lastVerifiedAt = timestamp.slice(0, 10);
    if (artifact.status !== "promoted") {
      artifact.status =
        hits >= 3 ? "promotion-candidate" : hits >= 2 ? "distilled" : "raw";
      markdown.frontmatter.status = artifact.status;
    }
  } else {
    const notUsefulVotes = (artifact.notUsefulVotes ?? 0) + 1;
    artifact.notUsefulVotes = notUsefulVotes;
    markdown.frontmatter.notUsefulVotes = notUsefulVotes;
  }

  const changes: SLChange[] = [];
  await slWriteText(
    root,
    artifact.path,
    slStringifyMarkdown(markdown.frontmatter, markdown.body),
    dryRun,
    changes,
  );
  await slSaveRegistry(root, registry, dryRun, changes);
  await slWriteIndex(root, registry, dryRun, changes);
  const event: SLEvent = {
    schemaVersion: 1,
    timestamp,
    artifactId: id,
    action: "voted",
    reason: vote,
    toStatus: artifact.status,
    toPath: artifact.path,
  };
  await slAppendEvents(root, [event], dryRun);
  return changes;
}
