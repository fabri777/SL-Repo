import { randomUUID } from "node:crypto";
import type { BigIntStats } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { SL_PATHS } from "./SL-constants.js";
import type {
  SLChange,
  SLRegistry,
  SLRegistryArtifact,
} from "./SL-types.js";
import {
  slAssertRealPathInside,
  slExists,
  slResolveInside,
  slWriteText,
} from "./SL-utils.js";

export interface SLArtifactTransferHooks {
  beforeDestinationLink?: () => Promise<void>;
}

interface SLFileIdentity {
  dev: bigint;
  ino: bigint;
  size: bigint;
  birthtimeNs: bigint;
}

function slIdentity(info: BigIntStats): SLFileIdentity {
  return {
    dev: info.dev,
    ino: info.ino,
    size: info.size,
    birthtimeNs: info.birthtimeNs,
  };
}

function slSameIdentity(
  left: SLFileIdentity,
  right: SLFileIdentity,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.birthtimeNs === right.birthtimeNs
  );
}

function slMissingPath(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

async function slFileIdentity(
  path: string,
  relativePath: string,
): Promise<SLFileIdentity> {
  const info = await lstat(path, { bigint: true });
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`Refusing to transfer non-file artifact: ${relativePath}`);
  }
  return slIdentity(info);
}

async function slExistingFileIdentity(
  path: string,
  relativePath: string,
): Promise<SLFileIdentity | undefined> {
  try {
    return await slFileIdentity(path, relativePath);
  } catch (error) {
    if (slMissingPath(error)) {
      return undefined;
    }
    throw error;
  }
}

async function slPathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (slMissingPath(error)) {
      return false;
    }
    throw error;
  }
}

async function slRemoveOwnedPath(
  path: string,
  relativePath: string,
  expectedIdentity: SLFileIdentity,
): Promise<void> {
  const currentIdentity = await slExistingFileIdentity(path, relativePath);
  if (!currentIdentity) {
    return;
  }
  if (!slSameIdentity(currentIdentity, expectedIdentity)) {
    throw new Error(
      `Refusing to remove ${relativePath} because it is no longer owned by this operation.`,
    );
  }
  await unlink(path);
}

async function slCreateStagedFile(
  root: string,
  relativePath: string,
  content: string,
): Promise<{ path: string; identity: SLFileIdentity }> {
  const destination = slResolveInside(root, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await slAssertRealPathInside(root, relativePath);
  const stagePath = join(
    dirname(destination),
    `.${basename(destination)}.SL-transfer-${randomUUID()}`,
  );
  const handle = await open(stagePath, "wx");
  try {
    await handle.writeFile(content, "utf8");
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(stagePath).catch(() => undefined);
    throw error;
  }
  await handle.close();
  return {
    path: stagePath,
    identity: await slFileIdentity(stagePath, relativePath),
  };
}

async function slLinkExclusive(
  stagePath: string,
  destinationPath: string,
  destinationRelativePath: string,
  destinationLabel: string,
): Promise<void> {
  try {
    await link(stagePath, destinationPath);
  } catch (error) {
    if (await slPathExists(destinationPath)) {
      throw new Error(
        `${destinationLabel} already exists: ${destinationRelativePath}`,
        { cause: error },
      );
    }
    throw error;
  }
}

export function slPromotedProbationPath(
  artifact: SLRegistryArtifact,
  targetPath: string,
): string {
  const directoryName = artifact.id.toLowerCase();
  return artifact.artifactType === "instruction"
    ? `${SL_PATHS.probation}/${directoryName}/${basename(targetPath)}`
    : `${SL_PATHS.probation}/${directoryName}/SKILL.md`;
}

async function slPreflightOwnedArtifactDestination(
  root: string,
  registry: SLRegistry,
  artifact: SLRegistryArtifact,
  sourcePath: string,
  destinationPath: string,
  destinationLabel: string,
): Promise<void> {
  const owner = registry.artifacts.find(
    (candidate) =>
      candidate.id !== artifact.id &&
      (
        candidate.path === destinationPath ||
        candidate.originalPath === destinationPath ||
        candidate.promotionTargetPath === destinationPath
      ),
  );
  if (owner) {
    throw new Error(
      `${destinationLabel} ${destinationPath} is already owned by ${owner.id}.`,
    );
  }
  await slAssertRealPathInside(root, destinationPath);
  if (
    sourcePath !== destinationPath &&
    (await slExists(slResolveInside(root, destinationPath)))
  ) {
    throw new Error(`${destinationLabel} already exists: ${destinationPath}`);
  }
}

export async function slPreflightPromotedProbationDestination(
  root: string,
  registry: SLRegistry,
  artifact: SLRegistryArtifact,
  sourcePath: string,
  probationPath: string,
): Promise<void> {
  await slPreflightOwnedArtifactDestination(
    root,
    registry,
    artifact,
    sourcePath,
    probationPath,
    "Promotion probation path",
  );
}

export async function slPreflightEvidenceRestoreDestination(
  root: string,
  registry: SLRegistry,
  artifact: SLRegistryArtifact,
  sourcePath: string,
  restorePath: string,
): Promise<void> {
  await slPreflightOwnedArtifactDestination(
    root,
    registry,
    artifact,
    sourcePath,
    restorePath,
    "Evidence restore path",
  );
}

async function slRewriteAndMoveOwnedArtifact(
  root: string,
  sourcePath: string,
  destinationPath: string,
  originalContent: string,
  destinationContent: string,
  dryRun: boolean,
  changes: SLChange[],
  preflight: () => Promise<void>,
  destinationLabel: string,
  hooks: SLArtifactTransferHooks,
): Promise<() => Promise<void>> {
  await preflight();
  if (sourcePath === destinationPath) {
    await slWriteText(
      root,
      sourcePath,
      destinationContent,
      dryRun,
      changes,
    );
    return async () => {
      if (!dryRun) {
        await slWriteText(root, sourcePath, originalContent, false, []);
      }
    };
  }

  changes.push({
    action: "update",
    path: sourcePath,
    detail: dryRun ? "planned" : "written",
  });
  changes.push({
    action: "move",
    path: sourcePath,
    detail: `${sourcePath} -> ${destinationPath}`,
  });
  if (dryRun) {
    return async () => undefined;
  }

  const source = slResolveInside(root, sourcePath);
  const destination = slResolveInside(root, destinationPath);
  await slAssertRealPathInside(root, sourcePath);
  await slAssertRealPathInside(root, destinationPath);
  const sourceIdentity = await slFileIdentity(source, sourcePath);
  const stage = await slCreateStagedFile(
    root,
    destinationPath,
    destinationContent.replaceAll("\r\n", "\n"),
  );
  let destinationCreated = false;
  let sourceRemoved = false;
  let stageRemoved = false;
  try {
    await hooks.beforeDestinationLink?.();
    await slAssertRealPathInside(root, destinationPath);
    await slLinkExclusive(
      stage.path,
      destination,
      destinationPath,
      destinationLabel,
    );
    destinationCreated = true;
    const destinationIdentity = await slFileIdentity(
      destination,
      destinationPath,
    );
    if (!slSameIdentity(destinationIdentity, stage.identity)) {
      throw new Error(
        `Destination identity changed during artifact transfer: ${destinationPath}`,
      );
    }
    await slRemoveOwnedPath(stage.path, destinationPath, stage.identity);
    stageRemoved = true;
    const currentSourceIdentity = await slFileIdentity(source, sourcePath);
    if (!slSameIdentity(currentSourceIdentity, sourceIdentity)) {
      throw new Error(
        `Source identity changed during artifact transfer: ${sourcePath}`,
      );
    }
    await unlink(source);
    sourceRemoved = true;

    return async () => {
      const rollbackStage = await slCreateStagedFile(
        root,
        sourcePath,
        originalContent,
      );
      const rollbackErrors: unknown[] = [];
      try {
        await slLinkExclusive(
          rollbackStage.path,
          source,
          sourcePath,
          "Artifact rollback path",
        );
        try {
          await slRemoveOwnedPath(
            rollbackStage.path,
            sourcePath,
            rollbackStage.identity,
          );
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
        const currentDestinationIdentity = await slExistingFileIdentity(
          destination,
          destinationPath,
        );
        if (
          currentDestinationIdentity &&
          !slSameIdentity(currentDestinationIdentity, destinationIdentity)
        ) {
          throw new Error(
            `Refusing to remove ${destinationPath} because it is no longer owned by this operation.`,
          );
        }
        if (currentDestinationIdentity) {
          try {
            await slRemoveOwnedPath(
              destination,
              destinationPath,
              destinationIdentity,
            );
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
        }
        if (rollbackErrors.length > 0) {
          throw new AggregateError(
            rollbackErrors,
            "Artifact rollback could not clean up every operation-owned path.",
          );
        }
      } catch (error) {
        await slRemoveOwnedPath(
          rollbackStage.path,
          sourcePath,
          rollbackStage.identity,
        ).catch(() => undefined);
        throw error;
      }
    };
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    if (destinationCreated && !sourceRemoved) {
      try {
        await slRemoveOwnedPath(destination, destinationPath, stage.identity);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (!stageRemoved) {
      try {
        await slRemoveOwnedPath(stage.path, destinationPath, stage.identity);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Artifact transfer failed and rollback could not complete.",
      );
    }
    throw error;
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
  hooks: SLArtifactTransferHooks = {},
): Promise<() => Promise<void>> {
  return slRewriteAndMoveOwnedArtifact(
    root,
    sourcePath,
    probationPath,
    originalContent,
    probationContent,
    dryRun,
    changes,
    () =>
      slPreflightPromotedProbationDestination(
        root,
        registry,
        artifact,
        sourcePath,
        probationPath,
      ),
    "Promotion probation path",
    hooks,
  );
}

export async function slRewriteAndMoveEvidenceFromQuarantine(
  root: string,
  registry: SLRegistry,
  artifact: SLRegistryArtifact,
  sourcePath: string,
  restorePath: string,
  originalContent: string,
  restoredContent: string,
  dryRun: boolean,
  changes: SLChange[],
  hooks: SLArtifactTransferHooks = {},
): Promise<() => Promise<void>> {
  return slRewriteAndMoveOwnedArtifact(
    root,
    sourcePath,
    restorePath,
    originalContent,
    restoredContent,
    dryRun,
    changes,
    () =>
      slPreflightEvidenceRestoreDestination(
        root,
        registry,
        artifact,
        sourcePath,
        restorePath,
      ),
    "Evidence restore path",
    hooks,
  );
}
