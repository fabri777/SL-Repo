import { slParseMarkdown, slStringifyMarkdown } from "./SL-frontmatter.js";
import {
  slAppendEvents,
  slAssertEventPathSafe,
  slFindArtifact,
  slLoadRegistry,
  slSaveRegistry,
  slUpsertArtifact,
} from "./SL-registry.js";
import type { SLArtifactType, SLChange, SLEvent, SLRegistryArtifact } from "./SL-types.js";
import {
  slExists,
  slNormalizePath,
  slReadText,
  slResolveInside,
  slWriteText,
} from "./SL-utils.js";
import { slWriteIndex } from "../SL-index/SL-index.js";

function slPromotionType(path: string): SLArtifactType {
  if (path.startsWith(".github/instructions/") && path.endsWith(".instructions.md")) {
    return "instruction";
  }
  if (path.startsWith(".github/skills/") && path.endsWith("/SKILL.md")) {
    return "skill";
  }
  throw new Error(
    "Promoted path must be .github/instructions/SL-*.instructions.md or .github/skills/SL-*/SKILL.md.",
  );
}

export async function slRegisterPromotion(
  root: string,
  sourceId: string,
  promotedPathValue: string,
  dryRun: boolean,
  now = new Date(),
): Promise<SLChange[]> {
  const promotedPath = slNormalizePath(promotedPathValue);
  await slAssertEventPathSafe(root);
  const artifactType = slPromotionType(promotedPath);
  const absolutePath = slResolveInside(root, promotedPath);
  if (!(await slExists(absolutePath))) {
    throw new Error(`Promoted artifact does not exist: ${promotedPath}`);
  }
  if (
    artifactType === "instruction" &&
    !promotedPath.split("/").at(-1)?.startsWith("SL-")
  ) {
    throw new Error("Promoted instruction filename must start with SL-.");
  }
  if (
    artifactType === "skill" &&
    !promotedPath.split("/").at(-2)?.startsWith("SL-")
  ) {
    throw new Error("Promoted skill directory must start with SL-.");
  }

  const registry = await slLoadRegistry(root);
  const source = slFindArtifact(registry, sourceId);
  if (source.classification !== "evidence") {
    throw new Error("Only lesson evidence can be promoted.");
  }

  const content = await slReadText(absolutePath);
  const markdown = slParseMarkdown<Record<string, unknown>>(content);
  const promotedId =
    typeof markdown.frontmatter.id === "string"
      ? markdown.frontmatter.id
      : `SL-PROMOTED-${sourceId.replace(/^SL-/, "")}`;
  if (promotedId === sourceId) {
    throw new Error("Promoted artifact ID must differ from its source lesson ID.");
  }
  const existingIdOwner = registry.artifacts.find(
    (artifact) => artifact.id === promotedId,
  );
  if (existingIdOwner && existingIdOwner.path !== promotedPath) {
    throw new Error(
      `Promoted artifact ID ${promotedId} is already owned by ${existingIdOwner.path ?? "a deleted artifact"}.`,
    );
  }
  if (existingIdOwner && existingIdOwner.classification !== "promoted") {
    throw new Error(
      `Promoted artifact ID ${promotedId} is owned by a non-promoted artifact.`,
    );
  }
  if (
    existingIdOwner &&
    (
      existingIdOwner.dependsOn?.length !== 1 ||
      existingIdOwner.dependsOn[0] !== sourceId
    )
  ) {
    throw new Error(
      `Promoted artifact ${promotedId} is already bound to different source evidence.`,
    );
  }
  const existingPathOwner = registry.artifacts.find(
    (artifact) => artifact.path === promotedPath,
  );
  if (existingPathOwner && existingPathOwner.id !== promotedId) {
    throw new Error(
      `Promoted path ${promotedPath} is already owned by ${existingPathOwner.id}.`,
    );
  }
  if (existingPathOwner && existingPathOwner.classification !== "promoted") {
    throw new Error(
      `Promoted path ${promotedPath} is owned by a non-promoted artifact.`,
    );
  }
  markdown.frontmatter.id = promotedId;
  markdown.frontmatter.schemaVersion = 1;
  markdown.frontmatter.managedBy = "SL-Repo";
  markdown.frontmatter.status = "promoted";
  markdown.frontmatter.pinned = false;
  markdown.frontmatter.sourceIds = [sourceId];

  const changes: SLChange[] = [];
  await slWriteText(
    root,
    promotedPath,
    slStringifyMarkdown(markdown.frontmatter, markdown.body),
    dryRun,
    changes,
  );

  source.status = "promoted";
  source.lastVerifiedAt = now.toISOString();
  source.relatedTo = [...new Set([...source.relatedTo, promotedId])];
  const promoted: SLRegistryArtifact = {
    id: promotedId,
    path: promotedPath,
    artifactType,
    classification: "promoted",
    managedBy: "SL-Repo",
    status: "promoted",
    createdAt: existingIdOwner?.createdAt ?? now.toISOString(),
    lastVerifiedAt: now.toISOString(),
    pinned: false,
    relatedTo: [sourceId],
    dependsOn: [sourceId],
  };
  slUpsertArtifact(registry, promoted);
  await slSaveRegistry(root, registry, dryRun, changes);
  await slWriteIndex(root, registry, dryRun, changes);
  const event: SLEvent = {
    schemaVersion: 1,
    timestamp: now.toISOString(),
    artifactId: promotedId,
    action: "promoted",
    toStatus: "promoted",
    toPath: promotedPath,
    reason: `Promoted from ${sourceId}`,
  };
  await slAppendEvents(root, [event], dryRun);
  return changes;
}
