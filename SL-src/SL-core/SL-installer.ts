import fg from "fast-glob";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  SL_MANAGED_BLOCK_END,
  SL_MANAGED_BLOCK_START,
  SL_PATHS,
} from "./SL-constants.js";
import { slFindPackageRoot } from "./SL-package.js";
import { slWithRepositoryMutationLock } from "./SL-mutation-lock.js";
import {
  slLoadRegistry,
  slSaveRegistry,
  slUpsertArtifact,
} from "./SL-registry.js";
import type { SLChange, SLRegistryArtifact } from "./SL-types.js";
import {
  slExists,
  slNormalizePath,
  slReadText,
  slResolveInside,
  slSlugify,
  slWriteText,
} from "./SL-utils.js";
import { slWriteIndex } from "../SL-index/SL-index.js";

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
): Promise<SLChange[]> {
  if (!(await slExists(resolve(root, ".git")))) {
    throw new Error(`Target is not a Git repository: ${root}`);
  }
  return slWithRepositoryMutationLock(root, () =>
    slInstallUnlocked(root, mode, dryRun),
    { dryRun },
  );
}

async function slInstallUnlocked(
  root: string,
  mode: "init" | "update",
  dryRun: boolean,
): Promise<SLChange[]> {
  const packageRoot = await slFindPackageRoot(import.meta.url);
  const templateRoot = resolve(packageRoot, "SL-templates/SL-repository");
  const templateFiles = await fg("**/*", {
    cwd: templateRoot,
    dot: true,
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

  for (const templatePathValue of templateFiles.sort()) {
    const templatePath = slNormalizePath(templatePathValue);
    if (templatePath === "SL-copilot-block.md") {
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
    await slWriteText(root, targetPath, content, dryRun, changes);
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
  const instructionsPath = slResolveInside(root, SL_PATHS.copilotInstructions);
  const existingInstructions = (await slExists(instructionsPath))
    ? await slReadText(instructionsPath)
    : "";
  await slWriteText(
    root,
    SL_PATHS.copilotInstructions,
    slMergeManagedBlock(existingInstructions, block),
    dryRun,
    changes,
  );

  const registry = await slLoadRegistry(root);
  const timestamp = new Date().toISOString();
  for (const templatePathValue of templateFiles.sort()) {
    const templatePath = slNormalizePath(templatePathValue);
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
    };
    registry.artifacts = registry.artifacts.filter(
      (candidate) =>
        candidate.id === artifact.id ||
        candidate.path !== artifact.path ||
        candidate.classification !== "system",
    );
    slUpsertArtifact(registry, artifact);
  }
  await slSaveRegistry(root, registry, dryRun, changes);
  await slWriteIndex(root, registry, dryRun, changes);
  return changes;
}
