import { createHash } from "node:crypto";
import { posix } from "node:path";
import { SL_PATHS } from "./SL-constants.js";
import type {
  SLChange,
  SLScopeCatalogEntry,
  SLScopeDescriptor,
  SLStateCatalog,
} from "./SL-types.js";
import {
  slAssertRealPathInside,
  slExists,
  slReadJson,
  slResolveInside,
  slSlugify,
  slWriteJson,
} from "./SL-utils.js";

export const SL_DEFAULT_SCOPE: SLScopeDescriptor = {
  id: "repo",
  path: ".",
};

const SL_SCOPE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function slNormalizeScope(
  input: SLScopeDescriptor = SL_DEFAULT_SCOPE,
): SLScopeDescriptor {
  const id = input.id.trim();
  if (!SL_SCOPE_ID_PATTERN.test(id)) {
    throw new Error(
      "Scope id must contain only letters, numbers, '.', '_', or '-'.",
    );
  }
  const slashPath = input.path.trim().replaceAll("\\", "/");
  if (
    !slashPath ||
    /^[A-Za-z]:\//.test(slashPath) ||
    slashPath.startsWith("/")
  ) {
    throw new Error("Scope path must be repository-relative.");
  }
  const normalizedPath = posix.normalize(slashPath);
  if (
    normalizedPath === ".." ||
    normalizedPath.startsWith("../") ||
    normalizedPath.includes("/../")
  ) {
    throw new Error("Scope path escapes the repository.");
  }
  return {
    id,
    path:
      normalizedPath === "." ? "." : normalizedPath.replace(/^\.\/|\/$/g, ""),
  };
}

export function slScopeKey(scope: SLScopeDescriptor): string {
  const normalized = slNormalizeScope(scope);
  return `${normalized.id}\0${normalized.path}`;
}

export function slScopeShardName(scope: SLScopeDescriptor): string {
  const normalized = slNormalizeScope(scope);
  const slug =
    slSlugify(
      normalized.path === "."
        ? normalized.id
        : `${normalized.id}-${normalized.path}`,
    ).slice(0, 40) || "scope";
  const hash = createHash("sha256")
    .update(slScopeKey(normalized))
    .digest("hex")
    .slice(0, 12);
  return `SL-${slug}-${hash}`;
}

export function slArtifactShardName(artifactId: string): string {
  const slug = slSlugify(artifactId).slice(0, 48) || "artifact";
  const hash = createHash("sha256")
    .update(artifactId)
    .digest("hex")
    .slice(0, 12);
  return `SL-${slug}-${hash}`;
}

export function slScopeCatalogEntry(
  scope: SLScopeDescriptor,
): SLScopeCatalogEntry {
  const normalized = slNormalizeScope(scope);
  const shard = slScopeShardName(normalized);
  const root = `${SL_PATHS.scopeRoot}/${shard}`;
  return {
    scope: normalized,
    shard,
    registryPath: `${root}/SL-registry.json`,
    indexPath: `${root}/SL-index.json`,
    projectionPath: `${root}/SL-usage-projection.json`,
    usageEventsPath: `${root}/SL-usage-events`,
  };
}

export function slBuildStateCatalog(
  scopes: Iterable<SLScopeDescriptor>,
): SLStateCatalog {
  const byKey = new Map<string, SLScopeCatalogEntry>();
  const shardOwners = new Map<string, string>();
  for (const scope of scopes) {
    const entry = slScopeCatalogEntry(scope);
    const key = slScopeKey(entry.scope);
    const owner = shardOwners.get(entry.shard);
    if (owner && owner !== key) {
      throw new Error(
        `Normalized scope shard collision: ${entry.shard} is shared by ${owner} and ${key}.`,
      );
    }
    shardOwners.set(entry.shard, key);
    byKey.set(key, entry);
  }
  return {
    schemaVersion: 1,
    scopes: [...byKey.values()].sort((left, right) =>
      slScopeKey(left.scope).localeCompare(slScopeKey(right.scope)),
    ),
  };
}

export async function slLoadStateCatalog(
  root: string,
): Promise<SLStateCatalog> {
  const path = slResolveInside(root, SL_PATHS.stateCatalog);
  if (!(await slExists(path))) {
    return { schemaVersion: 1, scopes: [] };
  }
  await slAssertRealPathInside(root, SL_PATHS.stateCatalog);
  return slReadJson<SLStateCatalog>(path);
}

export async function slWriteStateCatalog(
  root: string,
  scopes: Iterable<SLScopeDescriptor>,
  dryRun: boolean,
  changes: SLChange[],
): Promise<SLStateCatalog> {
  const catalog = slBuildStateCatalog(scopes);
  await slWriteJson(
    root,
    SL_PATHS.stateCatalog,
    catalog,
    dryRun,
    changes,
  );
  return catalog;
}

export function slAssertCatalogEntryPaths(entry: SLScopeCatalogEntry): void {
  const expected = slScopeCatalogEntry(entry.scope);
  if (
    entry.scope.id !== expected.scope.id ||
    entry.scope.path !== expected.scope.path
  ) {
    throw new Error("Scope catalog descriptors must be normalized.");
  }
  if (
    entry.shard !== expected.shard ||
    entry.registryPath !== expected.registryPath ||
    entry.indexPath !== expected.indexPath ||
    entry.projectionPath !== expected.projectionPath ||
    entry.usageEventsPath !== expected.usageEventsPath
  ) {
    throw new Error(
      `Scope catalog paths do not match deterministic shard ${expected.shard}.`,
    );
  }
}
