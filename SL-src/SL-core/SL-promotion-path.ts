import { basename } from "node:path";
import { SL_PATHS } from "./SL-constants.js";
import type {
  SLChange,
  SLRegistry,
  SLRegistryArtifact,
} from "./SL-types.js";
import {
  slAssertRealPathInside,
  slExists,
  slMove,
  slResolveInside,
  slWriteText,
} from "./SL-utils.js";

export function slPromotedProbationPath(
  artifact: SLRegistryArtifact,
  targetPath: string,
): string {
  return artifact.artifactType === "instruction"
    ? `${SL_PATHS.probation}/${artifact.id}/${basename(targetPath)}`
    : `${SL_PATHS.probation}/${artifact.id}/SKILL.md`;
}

export async function slPreflightPromotedProbationDestination(
  root: string,
  registry: SLRegistry,
  artifact: SLRegistryArtifact,
  sourcePath: string,
  probationPath: string,
): Promise<void> {
  const owner = registry.artifacts.find(
    (candidate) =>
      candidate.id !== artifact.id &&
      (
        candidate.path === probationPath ||
        candidate.originalPath === probationPath ||
        candidate.promotionTargetPath === probationPath
      ),
  );
  if (owner) {
    throw new Error(
      `Promotion probation path ${probationPath} is already owned by ${owner.id}.`,
    );
  }
  await slAssertRealPathInside(root, probationPath);
  if (
    sourcePath !== probationPath &&
    (await slExists(slResolveInside(root, probationPath)))
  ) {
    throw new Error(`Promotion probation path already exists: ${probationPath}`);
  }
}

export async function slRewriteAndMovePromotionToProbation(
  root: string,
  registry: SLRegistry,
  artifact: SLRegistryArtifact,
  sourcePath: string,
  probationPath: string,
  originalContent: string,
  probationContent: string,
  dryRun: boolean,
  changes: SLChange[],
): Promise<() => Promise<void>> {
  await slPreflightPromotedProbationDestination(
    root,
    registry,
    artifact,
    sourcePath,
    probationPath,
  );
  await slWriteText(
    root,
    sourcePath,
    probationContent,
    dryRun,
    changes,
  );
  let moved = false;
  try {
    if (sourcePath !== probationPath) {
      await slMove(root, sourcePath, probationPath, dryRun, changes);
      moved = !dryRun;
    }
  } catch (error) {
    if (!dryRun) {
      await slWriteText(root, sourcePath, originalContent, false, []).catch(
        () => undefined,
      );
    }
    throw error;
  }

  return async () => {
    if (dryRun) {
      return;
    }
    if (
      moved &&
      (await slExists(slResolveInside(root, probationPath))) &&
      !(await slExists(slResolveInside(root, sourcePath)))
    ) {
      await slMove(root, probationPath, sourcePath, false, []);
    }
    await slWriteText(root, sourcePath, originalContent, false, []);
  };
}
