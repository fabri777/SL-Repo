import fg from "fast-glob";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod as fsChmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  SL_MANAGED_BLOCK_END,
  SL_MANAGED_BLOCK_START,
  SL_PATHS,
  SL_RUNTIME_BASH_LAUNCHER,
  SL_RUNTIME_MANIFEST_FILE,
} from "./SL-constants.js";
import { slFindPackageRoot } from "./SL-package.js";
import { slWithRepositoryMutationLock } from "./SL-mutation-lock.js";
import {
  slLoadRegistry,
  slSaveRegistry,
  slUpsertArtifact,
} from "./SL-registry.js";
import type {
  SLChange,
  SLRegistryArtifact,
  SLRuntimeManifest,
} from "./SL-types.js";
import { SL_DEFAULT_SCOPE } from "./SL-state.js";
import {
  slAssertRealPathInside,
  slExists,
  slCompareOrdinal,
  slNormalizePath,
  slReadText,
  slResolveInside,
  slSlugify,
  slWriteJson,
  slWriteText,
} from "./SL-utils.js";
import { slWriteIndex } from "../SL-index/SL-index.js";
import { slSynchronizeResourceProjectionUnlocked } from "./SL-resource.js";
import {
  slLoadRuntimeManifest,
  slVerifyRuntimeDirectory,
} from "../SL-runtime/SL-runtime-validation.js";

export interface SLInstallerFileOperations {
  writeText: typeof slWriteText;
  remove: (path: string) => Promise<void>;
  chmod: (path: string, mode: number) => Promise<void>;
}

interface SLInstallFileSnapshot {
  content?: Buffer;
  mode?: number;
}

const SL_DEFAULT_INSTALLER_FILE_OPERATIONS: SLInstallerFileOperations = {
  writeText: slWriteText,
  remove: async (path) => rm(path),
  chmod: fsChmod,
};

class SLInstallTransaction {
  readonly writeText: typeof slWriteText;
  readonly writeJson: typeof slWriteJson;
  private readonly snapshots = new Map<string, SLInstallFileSnapshot>();
  private readonly absentDirectories = new Set<string>();

  constructor(
    private readonly root: string,
    private readonly dryRun: boolean,
    private readonly fileOperations: SLInstallerFileOperations,
  ) {
    this.writeText = async (
      root,
      relativePath,
      content,
      dryRun,
      changes,
    ) => {
      await this.snapshot(relativePath);
      await this.fileOperations.writeText(
        root,
        relativePath,
        content,
        dryRun,
        changes,
      );
    };
    this.writeJson = async (
      root,
      relativePath,
      value,
      dryRun,
      changes,
    ) => {
      await this.writeText(
        root,
        relativePath,
        `${JSON.stringify(value, null, 2)}\n`,
        dryRun,
        changes,
      );
    };
  }

  async prepare(): Promise<void> {
    if (!this.dryRun) {
      await this.recordAbsentDirectories(
        slResolveInside(this.root, SL_PATHS.learningRoot),
      );
    }
  }

  async remove(relativePath: string): Promise<void> {
    await this.snapshot(relativePath);
    if (!this.dryRun) {
      await this.fileOperations.remove(
        slResolveInside(this.root, relativePath),
      );
    }
  }

  async chmod(relativePath: string, mode: number): Promise<void> {
    await this.snapshot(relativePath);
    if (!this.dryRun) {
      await this.fileOperations.chmod(
        slResolveInside(this.root, relativePath),
        mode,
      );
    }
  }

  async rollback(): Promise<void> {
    const rollbackErrors: unknown[] = [];
    for (const [relativePath, snapshot] of [
      ...this.snapshots.entries(),
    ].reverse()) {
      try {
        const absolutePath = slResolveInside(this.root, relativePath);
        if (snapshot.content === undefined) {
          await rm(absolutePath, { force: true });
        } else {
          await this.restoreFile(
            absolutePath,
            snapshot.content,
            snapshot.mode,
          );
        }
      } catch (error) {
        rollbackErrors.push(error);
      }
    }
    for (const directory of [...this.absentDirectories].sort(
      (left, right) => right.length - left.length,
    )) {
      try {
        await rmdir(directory);
      } catch (error) {
        if (
          !["ENOENT", "ENOTEMPTY", "EEXIST"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        ) {
          rollbackErrors.push(error);
        }
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        rollbackErrors,
        "SL installation rollback could not restore every affected path.",
      );
    }
  }

  private async snapshot(relativePath: string): Promise<void> {
    if (this.dryRun || this.snapshots.has(relativePath)) {
      return;
    }
    await slAssertRealPathInside(this.root, relativePath);
    const absolutePath = slResolveInside(this.root, relativePath);
    await this.recordAbsentDirectories(dirname(absolutePath));
    if (!(await slExists(absolutePath))) {
      this.snapshots.set(relativePath, {});
      return;
    }
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      throw new Error(`Installer target is not a file: ${relativePath}`);
    }
    this.snapshots.set(relativePath, {
      content: await readFile(absolutePath),
      mode: fileStat.mode,
    });
  }

  private async recordAbsentDirectories(
    absoluteDirectory: string,
  ): Promise<void> {
    const absoluteRoot = resolve(this.root);
    let directory = absoluteDirectory;
    while (
      directory !== absoluteRoot &&
      !(await slExists(directory))
    ) {
      this.absentDirectories.add(directory);
      directory = dirname(directory);
    }
  }

  private async restoreFile(
    absolutePath: string,
    content: Buffer,
    mode?: number,
  ): Promise<void> {
    await mkdir(dirname(absolutePath), { recursive: true });
    const temporaryPath =
      `${absolutePath}.SL-rollback-${randomUUID()}`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporaryPath, "wx");
      await handle.writeFile(content);
      await handle.close();
      handle = undefined;
      if (mode !== undefined) {
        await fsChmod(temporaryPath, mode & 0o777);
      }
      await rename(temporaryPath, absolutePath);
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => undefined);
      }
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

function slRuntimeTargetPath(relativePath: string): string {
  return `${SL_PATHS.runtimeRoot}/${relativePath}`;
}

async function slInstallRuntime(
  root: string,
  templateRuntimeRoot: string,
  mode: "init" | "update",
  dryRun: boolean,
  changes: SLChange[],
  transaction: SLInstallTransaction,
): Promise<{
  managedPaths: Set<string>;
  changedPaths: Set<string>;
  removedPaths: Set<string>;
}> {
  const sourceManifest = await slLoadRuntimeManifest(
    resolve(templateRuntimeRoot, SL_RUNTIME_MANIFEST_FILE),
  );
  const sourceIssues = await slVerifyRuntimeDirectory(
    templateRuntimeRoot,
    sourceManifest.runtimeVersion,
  );
  if (sourceIssues.length > 0) {
    throw new Error(
      `Bundled SL runtime is inconsistent: ${sourceIssues
        .map((issue) => `${issue.code} ${issue.path ?? ""}`.trim())
        .join(", ")}`,
    );
  }

  const targetRuntimeRoot = slResolveInside(root, SL_PATHS.runtimeRoot);
  const targetManifestPath = resolve(
    targetRuntimeRoot,
    SL_RUNTIME_MANIFEST_FILE,
  );
  let previousManifest: SLRuntimeManifest | undefined;
  if (await slExists(targetManifestPath)) {
    previousManifest = await slLoadRuntimeManifest(
      targetManifestPath,
      false,
    );
    const previousIssues = await slVerifyRuntimeDirectory(
      targetRuntimeRoot,
      previousManifest.runtimeVersion,
      false,
    );
    if (previousIssues.length > 0) {
      throw new Error(
        `Refusing to update a locally modified or mixed-version SL runtime: ${previousIssues
          .map((issue) => `${issue.code} ${issue.path ?? ""}`.trim())
          .join(", ")}`,
      );
    }
  }
  if (previousManifest && mode === "init") {
    return {
      managedPaths: new Set([
        ...previousManifest.files.map((file) =>
          slRuntimeTargetPath(file.path),
        ),
        slRuntimeTargetPath(SL_RUNTIME_MANIFEST_FILE),
      ]),
      changedPaths: new Set(),
      removedPaths: new Set(),
    };
  }

  const previousPaths = new Set(
    previousManifest?.files.map((file) => file.path) ?? [],
  );
  if (!previousManifest) {
    for (const file of sourceManifest.files) {
      if (await slExists(resolve(targetRuntimeRoot, file.path))) {
        throw new Error(
          `Refusing to claim runtime file without a previous manifest: ${slRuntimeTargetPath(file.path)}`,
        );
      }
    }
  } else {
    for (const file of sourceManifest.files) {
      if (
        !previousPaths.has(file.path) &&
        (await slExists(resolve(targetRuntimeRoot, file.path)))
      ) {
        throw new Error(
          `Refusing to overwrite an unrelated file introduced at a runtime-managed path: ${slRuntimeTargetPath(file.path)}`,
        );
      }
    }
  }

  const managedPaths = new Set<string>();
  const changedPaths = new Set<string>();
  const removedPaths = new Set<string>();
  for (const file of sourceManifest.files) {
    const targetPath = slRuntimeTargetPath(file.path);
    const changeCount = changes.length;
    await transaction.writeText(
      root,
      targetPath,
      await slReadText(resolve(templateRuntimeRoot, file.path)),
      dryRun,
      changes,
    );
    managedPaths.add(targetPath);
    if (
      changes
        .slice(changeCount)
        .some((change) => change.action === "create" || change.action === "update")
    ) {
      changedPaths.add(targetPath);
    }
    if (
      !dryRun &&
      file.path === SL_RUNTIME_BASH_LAUNCHER &&
      process.platform !== "win32"
    ) {
      await transaction.chmod(targetPath, 0o755);
    }
  }

  if (previousManifest && mode === "update") {
    const sourcePaths = new Set(sourceManifest.files.map((file) => file.path));
    for (const previousFile of previousManifest.files) {
      if (sourcePaths.has(previousFile.path)) {
        continue;
      }
      const targetPath = slRuntimeTargetPath(previousFile.path);
      changes.push({
        action: "delete",
        path: targetPath,
        detail: dryRun ? "obsolete managed runtime file planned" : "obsolete managed runtime file removed",
      });
      if (!dryRun) {
        await transaction.remove(targetPath);
      }
      changedPaths.add(targetPath);
      removedPaths.add(targetPath);
    }
  }

  const manifestTargetPath = slRuntimeTargetPath(SL_RUNTIME_MANIFEST_FILE);
  const manifestChangeCount = changes.length;
  await transaction.writeText(
    root,
    manifestTargetPath,
    await readFile(
      resolve(templateRuntimeRoot, SL_RUNTIME_MANIFEST_FILE),
      "utf8",
    ),
    dryRun,
    changes,
  );
  managedPaths.add(manifestTargetPath);
  if (
    changes
      .slice(manifestChangeCount)
      .some((change) => change.action === "create" || change.action === "update")
  ) {
    changedPaths.add(manifestTargetPath);
  }
  return { managedPaths, changedPaths, removedPaths };
}

function slSystemId(path: string): string {
  const slug = slSlugify(path).slice(0, 30).toUpperCase();
  const hash = createHash("sha256").update(path).digest("hex").slice(0, 12).toUpperCase();
  return `SL-SYSTEM-${slug}-${hash}`;
}

function slMergeManagedBlock(existing: string, block: string): string {
  const normalized = existing.replaceAll("\r\n", "\n");
  const start = normalized.indexOf(SL_MANAGED_BLOCK_START);
  const end = normalized.indexOf(SL_MANAGED_BLOCK_END);
  if (start >= 0 && end > start) {
    const afterEnd = end + SL_MANAGED_BLOCK_END.length;
    return `${normalized.slice(0, start)}${block.trim()}${normalized.slice(afterEnd)}`.trimEnd() + "\n";
  }
  const separator = normalized.trim() ? "\n\n" : "";
  return `${normalized.trimEnd()}${separator}${block.trim()}\n`;
}

export async function slInstall(
  root: string,
  mode: "init" | "update",
  dryRun: boolean,
  fileOperations: Partial<SLInstallerFileOperations> = {},
): Promise<SLChange[]> {
  if (!(await slExists(resolve(root, ".git")))) {
    throw new Error(`Target is not a Git repository: ${root}`);
  }
  const transaction = new SLInstallTransaction(root, dryRun, {
    ...SL_DEFAULT_INSTALLER_FILE_OPERATIONS,
    ...fileOperations,
  });
  await transaction.prepare();
  let operationStarted = false;
  try {
    return await slWithRepositoryMutationLock(
      root,
      () => {
        operationStarted = true;
        return slInstallUnlocked(root, mode, dryRun, transaction);
      },
      { dryRun },
    );
  } catch (error) {
    if (operationStarted && !dryRun) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "SL installation failed and rollback was incomplete.",
        );
      }
    }
    throw error;
  }
}

async function slInstallUnlocked(
  root: string,
  mode: "init" | "update",
  dryRun: boolean,
  transaction: SLInstallTransaction,
): Promise<SLChange[]> {
  const packageRoot = await slFindPackageRoot(import.meta.url);
  const templateRoot = resolve(packageRoot, "SL-templates/SL-repository");
  const schemaRoot = resolve(packageRoot, "SL-schemas");
  const templateFiles = await fg("**/*", {
    cwd: templateRoot,
    dot: true,
    onlyFiles: true,
  });
  const schemaFiles = await fg("*.schema.json", {
    cwd: schemaRoot,
    onlyFiles: true,
  });
  const changes: SLChange[] = [];
  const existingRegistry = await slLoadRegistry(root);
  const existingScopeCatalogPaths: string[] = [];
  for (const scopeCatalogPath of SL_PATHS.scopeCatalogCandidates) {
    if (await slExists(slResolveInside(root, scopeCatalogPath))) {
      existingScopeCatalogPaths.push(scopeCatalogPath);
    }
  }
  const managedTemplatePaths = new Set<string>();
  const changedTemplatePaths = new Set<string>();
  const runtimeTemplateRoot = resolve(
    templateRoot,
    ".github/SL-learning/SL-runtime",
  );
  const runtime = await slInstallRuntime(
    root,
    runtimeTemplateRoot,
    mode,
    dryRun,
    changes,
    transaction,
  );
  for (const path of runtime.managedPaths) {
    managedTemplatePaths.add(path);
  }
  for (const path of runtime.changedPaths) {
    changedTemplatePaths.add(path);
  }

  for (const templatePathValue of templateFiles.sort(slCompareOrdinal)) {
    const templatePath = slNormalizePath(templatePathValue);
    if (
      templatePath === "SL-copilot-block.md" ||
      templatePath.startsWith(`${SL_PATHS.runtimeRoot}/`)
    ) {
      continue;
    }

    if (
      templatePath === SL_PATHS.scopeCatalog &&
      existingScopeCatalogPaths.length > 0 &&
      !existingScopeCatalogPaths.includes(SL_PATHS.scopeCatalog)
    ) {
      changes.push({
        action: "skip",
        path: templatePath,
        detail: `existing scope catalog preserved at ${existingScopeCatalogPaths.join(", ")}`,
      });
      continue;
    }
    const targetPath = templatePath;
    const targetAbsolutePath = slResolveInside(root, targetPath);
    const existingEntry = existingRegistry.artifacts.find(
      (artifact) => artifact.path === targetPath,
    );
    const canUpdate =
      mode === "update" &&
      existingEntry?.classification === "system" &&
      existingEntry.managedBy === "SL-Repo";
    if ((await slExists(targetAbsolutePath)) && !canUpdate) {
      changes.push({
        action: "skip",
        path: targetPath,
        detail: "existing unowned or configurable file preserved",
      });
      continue;
    }
    const content = await slReadText(resolve(templateRoot, templatePathValue));
    const changeCount = changes.length;
    await transaction.writeText(root, targetPath, content, dryRun, changes);
    managedTemplatePaths.add(targetPath);
    if (
      changes
        .slice(changeCount)
        .some((change) => change.action === "create" || change.action === "update")
    ) {
      changedTemplatePaths.add(targetPath);
    }
  }

  for (const schemaFile of schemaFiles.sort(slCompareOrdinal)) {
    const targetPath = `${SL_PATHS.learningRoot}/SL-schemas/${schemaFile}`;
    const targetAbsolutePath = slResolveInside(root, targetPath);
    const existingEntry = existingRegistry.artifacts.find(
      (artifact) => artifact.path === targetPath,
    );
    const canUpdate =
      mode === "update" &&
      existingEntry?.classification === "system" &&
      existingEntry.managedBy === "SL-Repo";
    if ((await slExists(targetAbsolutePath)) && !canUpdate) {
      changes.push({
        action: "skip",
        path: targetPath,
        detail: "existing unowned schema preserved",
      });
      continue;
    }
    const content = await slReadText(resolve(schemaRoot, schemaFile));
    const changeCount = changes.length;
    await transaction.writeText(root, targetPath, content, dryRun, changes);
    managedTemplatePaths.add(targetPath);
    if (
      changes
        .slice(changeCount)
        .some((change) => change.action === "create" || change.action === "update")
    ) {
      changedTemplatePaths.add(targetPath);
    }
  }

  const block = await slReadText(resolve(templateRoot, "SL-copilot-block.md"));
  for (const instructionsPath of [
    SL_PATHS.agentInstructions,
    SL_PATHS.copilotInstructions,
  ]) {
    const instructionsAbsolutePath = slResolveInside(root, instructionsPath);
    const existingInstructions = (await slExists(instructionsAbsolutePath))
      ? await slReadText(instructionsAbsolutePath)
      : "";
    await transaction.writeText(
      root,
      instructionsPath,
      slMergeManagedBlock(existingInstructions, block),
      dryRun,
      changes,
    );
  }

  const registry = await slLoadRegistry(root);
  if (runtime.removedPaths.size > 0) {
    registry.artifacts = registry.artifacts.filter(
      (artifact) =>
        artifact.path === null ||
        !runtime.removedPaths.has(artifact.path) ||
        artifact.classification !== "system" ||
        artifact.managedBy !== "SL-Repo",
    );
  }
  const timestamp = new Date().toISOString();
  const managedSystemPaths = [
    ...templateFiles.map(slNormalizePath),
    ...schemaFiles.map(
      (schemaFile) => `${SL_PATHS.learningRoot}/SL-schemas/${schemaFile}`,
    ),
  ].sort(slCompareOrdinal);
  for (const templatePath of managedSystemPaths) {
    if (
      templatePath === "SL-copilot-block.md" ||
      templatePath === SL_PATHS.registry ||
      templatePath === SL_PATHS.index ||
      templatePath === SL_PATHS.legacyEvents ||
      templatePath === SL_PATHS.config ||
      SL_PATHS.scopeCatalogCandidates.includes(
        templatePath as (typeof SL_PATHS.scopeCatalogCandidates)[number],
      )
    ) {
      continue;
    }
    const existingEntry = registry.artifacts.find(
      (artifact) => artifact.path === templatePath,
    );
    if (
      !managedTemplatePaths.has(templatePath) &&
      existingEntry?.classification !== "system"
    ) {
      continue;
    }
    const artifact: SLRegistryArtifact = {
      id: slSystemId(templatePath),
      path: templatePath,
      artifactType: templatePath.endsWith("/SKILL.md")
        ? "skill"
        : "system",
      classification: "system",
      managedBy: "SL-Repo",
      status: "active",
      createdAt: existingEntry?.createdAt ?? timestamp,
      lastVerifiedAt:
        existingEntry && !changedTemplatePaths.has(templatePath)
          ? existingEntry.lastVerifiedAt
          : timestamp,
      pinned: true,
      relatedTo: [],
      scope: SL_DEFAULT_SCOPE,
    };
    registry.artifacts = registry.artifacts.filter(
      (candidate) =>
        candidate.id === artifact.id ||
        candidate.path !== artifact.path ||
        candidate.classification !== "system",
    );
    slUpsertArtifact(registry, artifact);
  }
  await slSaveRegistry(
    root,
    registry,
    dryRun,
    changes,
    transaction.writeJson,
  );
  await slWriteIndex(
    root,
    registry,
    dryRun,
    changes,
    undefined,
    transaction.writeJson,
  );
  await slSynchronizeResourceProjectionUnlocked(
    root,
    dryRun,
    changes,
    undefined,
    transaction.writeJson,
  );
  return changes;
}
