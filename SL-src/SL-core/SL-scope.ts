import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { posix, win32 } from "node:path";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import { parse } from "yaml";
import {
  SL_DEFAULT_SCOPE_ID,
  SL_PATHS,
} from "./SL-constants.js";
import { slFindPackageRoot } from "./SL-package.js";
import type {
  SLScopeCatalog,
  SLScopeCatalogIssue,
  SLScopeCatalogSource,
  SLScopeDefinition,
  SLScopeDescriptor,
  SLPromotionScopeRef,
  SLScopeResolution,
  SLScopeSetResolution,
} from "./SL-types.js";
import {
  slAssertRealPathInside,
  slExists,
  slReadContainedText,
  slReadJson,
  slResolveInside,
} from "./SL-utils.js";

interface SLMicromatch {
  isMatch(
    value: string,
    pattern: string,
    options: {
      dot: boolean;
      nonegate: boolean;
      noextglob?: boolean;
      noglobstar?: boolean;
    },
  ): boolean;
  makeRe(
    pattern: string,
    options: {
      dot: boolean;
      nonegate: boolean;
    },
  ): RegExp;
}

const require = createRequire(import.meta.url);
const micromatch = require("micromatch") as SLMicromatch;

const SL_SCOPE_ID_PATTERN = /^SL-SCOPE-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const SL_OWNER_ALIAS_PATTERN =
  /^@[A-Za-z0-9](?:[A-Za-z0-9_.-]*)(?:\/[A-Za-z0-9](?:[A-Za-z0-9_.-]*))?$/;
const SL_WINDOWS_ABSOLUTE_PATTERN = /^[A-Za-z]:[\\/]/;
const SL_WINDOWS_DRIVE_RELATIVE_PATTERN = /^[A-Za-z]:[^\\/]/;
const SL_GLOB_MAGIC_PATTERN = /[*?[\]{}()!+@]/;

export const SL_DEFAULT_SCOPE_CATALOG: SLScopeCatalog = {
  schemaVersion: 1,
  scopes: [
    {
      id: SL_DEFAULT_SCOPE_ID,
      displayName: "Repository",
      kind: "repository",
      includePaths: ["**"],
      excludePaths: [],
      dependencyScopeIds: [],
      ownerAliases: [],
    },
  ],
};

function slLiteralPatternPrefix(pattern: string): string[] {
  const segments = pattern.split("/");
  const prefix: string[] = [];
  for (const segment of segments) {
    if (SL_GLOB_MAGIC_PATTERN.test(segment)) {
      break;
    }
    prefix.push(segment);
  }
  return prefix;
}

export function slScopeDefinitionPath(
  scope: SLScopeDefinition,
): string {
  if (!scope.parentScopeId) {
    return ".";
  }
  const prefixes = scope.includePaths
    .map(slLiteralPatternPrefix)
    .filter((prefix) => prefix.length > 0);
  if (prefixes.length === 0) {
    return ".";
  }
  const common = [...prefixes[0]!];
  for (const prefix of prefixes.slice(1)) {
    while (
      common.length > 0 &&
      common.some((segment, index) => prefix[index] !== segment)
    ) {
      common.pop();
    }
  }
  return common.length > 0 ? common.join("/") : ".";
}

export function slScopeDescriptor(
  scope: SLScopeDefinition,
): SLScopeDescriptor {
  return {
    id: scope.id,
    path: slScopeDefinitionPath(scope),
  };
}

export function slScopeDescriptors(
  catalog: SLScopeCatalog,
): SLScopeDescriptor[] {
  return [...catalog.scopes]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(slScopeDescriptor);
}

export function slFindScopeDefinition(
  catalog: SLScopeCatalog,
  scopeId: string,
): SLScopeDefinition {
  const scope = catalog.scopes.find((candidate) => candidate.id === scopeId);
  if (!scope) {
    throw new Error(`SL scope does not exist in the catalog: ${scopeId}`);
  }
  return scope;
}

export function slPromotionScopeRef(
  catalog: SLScopeCatalog,
  scopeId: string,
): SLPromotionScopeRef {
  const scope = slFindScopeDefinition(catalog, scopeId);
  const ancestors: string[] = [];
  let current = scope;
  while (current.parentScopeId) {
    ancestors.push(current.parentScopeId);
    current = slFindScopeDefinition(catalog, current.parentScopeId);
  }
  const root = ancestors.length === 0;
  const ownerSetHash = createHash("sha256")
    .update(JSON.stringify([...scope.ownerAliases].sort()))
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
  return {
    id: scope.id,
    kind: root ? "repository" : scope.kind,
    root,
    precedence: ancestors.length,
    ancestorScopeIds: ancestors,
    ownerSetId: `SL-OWNERS-${ownerSetHash}`,
  };
}

export interface SLResolveScopeOptions {
  scopeId?: string;
  targetPath?: string;
  currentDirectory?: string;
}

export async function slResolveScopeDescriptor(
  root: string,
  options: SLResolveScopeOptions = {},
): Promise<{
  scope: SLScopeDescriptor;
  resolution?: SLScopeResolution;
}> {
  const catalog = await slLoadScopeCatalog(root);
  if (options.scopeId) {
    return {
      scope: slScopeDescriptor(
        slFindScopeDefinition(catalog, options.scopeId),
      ),
    };
  }
  const targetPath =
    options.targetPath ?? options.currentDirectory ?? root;
  const normalizedPath = slNormalizeRepositoryPath(root, targetPath);
  await slAssertRealPathInside(root, normalizedPath || ".");
  const resolution = new SLScopeResolver(catalog).resolvePath(
    root,
    targetPath,
  );
  return {
    scope: slScopeDescriptor(
      slFindScopeDefinition(catalog, resolution.primaryScopeId),
    ),
    resolution,
  };
}

interface SLScopeMatch {
  scope: SLScopeDefinition;
  specificity: readonly [number, number, number, number];
  hierarchyDepth: number;
}

interface SLCompiledScope {
  scope: SLScopeDefinition;
  includes: string[];
  excludes: string[];
}

export class SLScopeCatalogValidationError extends Error {
  readonly issues: SLScopeCatalogIssue[];
  readonly catalogPath: string | null;

  constructor(issues: SLScopeCatalogIssue[], catalogPath: string | null = null) {
    super(
      `Invalid SL scope catalog: ${issues
        .map((issue) => `${issue.code}: ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "SLScopeCatalogValidationError";
    this.issues = issues;
    this.catalogPath = catalogPath;
  }
}

export class SLScopeAmbiguityError extends Error {
  readonly normalizedPath: string;
  readonly scopeIds: string[];

  constructor(normalizedPath: string, scopeIds: string[]) {
    super(
      `Ambiguous SL scope resolution for ${normalizedPath || "."}: ${scopeIds.join(", ")}`,
    );
    this.name = "SLScopeAmbiguityError";
    this.normalizedPath = normalizedPath;
    this.scopeIds = scopeIds;
  }
}

function slIsWindowsAbsolute(value: string): boolean {
  return SL_WINDOWS_ABSOLUTE_PATTERN.test(value) || value.startsWith("\\\\");
}

function slIsPosixAbsolute(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}

function slEscapesRoot(relativePath: string, separator: string): boolean {
  return (
    relativePath === ".." ||
    relativePath.startsWith(`..${separator}`) ||
    slIsWindowsAbsolute(relativePath) ||
    slIsPosixAbsolute(relativePath)
  );
}

export function slNormalizeRepositoryPath(
  root: string,
  pathValue: string,
): string {
  if (pathValue.includes("\0")) {
    throw new Error("Repository paths cannot contain a NUL character.");
  }

  if (slIsWindowsAbsolute(pathValue)) {
    if (!slIsWindowsAbsolute(root)) {
      throw new Error(`Absolute path is not compatible with repository root: ${pathValue}`);
    }
    const relativePath = win32.relative(win32.resolve(root), win32.resolve(pathValue));
    if (slEscapesRoot(relativePath, win32.sep)) {
      throw new Error(`Path escapes repository root: ${pathValue}`);
    }
    return relativePath.replaceAll("\\", "/");
  }

  if (slIsPosixAbsolute(pathValue)) {
    if (!slIsPosixAbsolute(root)) {
      throw new Error(`Absolute path is not compatible with repository root: ${pathValue}`);
    }
    const relativePath = posix.relative(posix.resolve(root), posix.resolve(pathValue));
    if (slEscapesRoot(relativePath, posix.sep)) {
      throw new Error(`Path escapes repository root: ${pathValue}`);
    }
    return relativePath;
  }

  if (SL_WINDOWS_DRIVE_RELATIVE_PATTERN.test(pathValue)) {
    throw new Error(`Drive-relative paths are not allowed: ${pathValue}`);
  }

  const normalized = posix.normalize(pathValue.replaceAll("\\", "/"));
  if (slEscapesRoot(normalized, posix.sep)) {
    throw new Error(`Path escapes repository root: ${pathValue}`);
  }
  return normalized === "." ? "" : normalized.replace(/^\.\//, "");
}

export function slNormalizeScopePattern(pattern: string): string {
  const normalized = pattern
    .trim()
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/$/, "");
  if (!normalized) {
    throw new Error("Scope path patterns cannot be empty.");
  }
  if (
    slIsWindowsAbsolute(normalized) ||
    slIsPosixAbsolute(normalized) ||
    SL_WINDOWS_DRIVE_RELATIVE_PATTERN.test(normalized)
  ) {
    throw new Error(`Scope path pattern must be repository-relative: ${pattern}`);
  }
  if (normalized.startsWith("!") || normalized.startsWith("#")) {
    throw new Error(
      `Scope path pattern cannot use negation or comment syntax: ${pattern}`,
    );
  }
  if (normalized.split("/").includes("..")) {
    throw new Error(`Scope path pattern escapes repository root: ${pattern}`);
  }
  try {
    micromatch.makeRe(normalized, {
      dot: true,
      nonegate: true,
    });
  } catch (error) {
    throw new Error(
      `Invalid scope glob ${pattern}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return normalized;
}

function slMatchPath(pattern: string, normalizedPath: string): boolean {
  return (
    normalizedPath !== "" &&
    micromatch.isMatch(normalizedPath, pattern, {
      dot: true,
      nonegate: true,
    })
  );
}

function slPatternSpecificity(
  pattern: string,
): readonly [number, number, number, number] {
  const segments = pattern.split("/");
  const literalSegments = segments.filter(
    (segment) => !SL_GLOB_MAGIC_PATTERN.test(segment),
  ).length;
  const literalCharacters = pattern.replace(/[*?[\]{}()!+@]/g, "").length;
  const wildcardCharacters = pattern.length - literalCharacters;
  return [
    literalSegments,
    literalCharacters,
    segments.length,
    -wildcardCharacters,
  ];
}

function slCompareSpecificity(
  left: readonly number[],
  right: readonly number[],
): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function slDefiniteExclusionCoversInclude(
  includePattern: string,
  excludePattern: string,
): boolean {
  if (excludePattern === "**" || includePattern === excludePattern) {
    return true;
  }
  if (excludePattern.endsWith("/**")) {
    const excludedRoot = excludePattern.slice(0, -3);
    return includePattern.startsWith(`${excludedRoot}/`);
  }
  if (!SL_GLOB_MAGIC_PATTERN.test(includePattern)) {
    return micromatch.isMatch(includePattern, excludePattern, {
      dot: true,
      nonegate: true,
    });
  }
  return false;
}

function slScopeCanEverMatch(scope: SLScopeDefinition): boolean {
  try {
    return scope.includePaths.some(
      (includePattern) =>
        !scope.excludePaths.some((excludePattern) =>
          slDefiniteExclusionCoversInclude(includePattern, excludePattern),
        ),
    );
  } catch {
    return true;
  }
}

function slDetectGraphCycles(
  scopes: Map<string, SLScopeDefinition>,
): SLScopeCatalogIssue[] {
  const issues: SLScopeCatalogIssue[] = [];
  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];

  const visit = (scopeId: string): void => {
    if (active.has(scopeId)) {
      const cycleStart = stack.indexOf(scopeId);
      const cycle = [...stack.slice(cycleStart), scopeId];
      issues.push({
        code: "scope-cycle",
        path: scopeId,
        message: `Scope relationship cycle detected: ${cycle.join(" -> ")}`,
      });
      return;
    }
    if (visited.has(scopeId)) {
      return;
    }
    const scope = scopes.get(scopeId);
    if (!scope) {
      return;
    }

    active.add(scopeId);
    stack.push(scopeId);
    const relatedScopeIds = [
      ...(scope.parentScopeId ? [scope.parentScopeId] : []),
      ...scope.dependencyScopeIds,
    ].sort();
    for (const relatedScopeId of relatedScopeIds) {
      if (scopes.has(relatedScopeId)) {
        visit(relatedScopeId);
      }
    }
    stack.pop();
    active.delete(scopeId);
    visited.add(scopeId);
  };

  for (const scopeId of [...scopes.keys()].sort()) {
    visit(scopeId);
  }
  return issues;
}

export function slValidateScopeCatalog(
  catalog: SLScopeCatalog,
): SLScopeCatalogIssue[] {
  const issues: SLScopeCatalogIssue[] = [];
  const scopes = new Map<string, SLScopeDefinition>();

  for (const [index, scope] of catalog.scopes.entries()) {
    const scopePath = `scopes/${index}`;
    if (!SL_SCOPE_ID_PATTERN.test(scope.id)) {
      issues.push({
        code: "invalid-scope-id",
        path: `${scopePath}/id`,
        message: `Scope ID must match SL-SCOPE-* naming: ${scope.id}`,
      });
    }
    if (scopes.has(scope.id)) {
      issues.push({
        code: "duplicate-scope-id",
        path: `${scopePath}/id`,
        message: `Duplicate scope ID: ${scope.id}`,
      });
    } else {
      scopes.set(scope.id, scope);
    }

    for (const [pathKind, patterns] of [
      ["includePaths", scope.includePaths],
      ["excludePaths", scope.excludePaths],
    ] as const) {
      for (const [patternIndex, pattern] of patterns.entries()) {
        try {
          const normalized = slNormalizeScopePattern(pattern);
          if (normalized !== pattern) {
            issues.push({
              code: "non-canonical-scope-path",
              path: `${scopePath}/${pathKind}/${patternIndex}`,
              message: `Scope paths must use canonical repository-relative / form: ${pattern}`,
            });
          }
        } catch (error) {
          issues.push({
            code: "unsafe-scope-path",
            path: `${scopePath}/${pathKind}/${patternIndex}`,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    for (const [ownerIndex, ownerAlias] of scope.ownerAliases.entries()) {
      if (!SL_OWNER_ALIAS_PATTERN.test(ownerAlias)) {
        issues.push({
          code: "invalid-owner-alias",
          path: `${scopePath}/ownerAliases/${ownerIndex}`,
          message: `Owner aliases must use @user or @organization/team syntax: ${ownerAlias}`,
        });
      }
    }

    if (!slScopeCanEverMatch(scope)) {
      issues.push({
        code: "unmatchable-scope",
        path: scopePath,
        message: `Scope ${scope.id} has no include pattern outside its exclusions.`,
      });
    }
  }

  const roots = catalog.scopes.filter((scope) => scope.parentScopeId === undefined);
  if (roots.length !== 1) {
    issues.push({
      code: "scope-root-count",
      message: `Scope catalog must define exactly one parentless root; found ${roots.length}.`,
    });
  } else {
    const root = roots[0];
    if (root && root.kind !== "repository" && root.kind !== "shared") {
      issues.push({
        code: "invalid-root-kind",
        path: root.id,
        message: "The root scope kind must be repository or shared.",
      });
    }
    if (root && !root.includePaths.includes("**")) {
      issues.push({
        code: "root-not-universal",
        path: root.id,
        message: "The root scope must include ** so every repository path has a fallback.",
      });
    }
    if (root && root.excludePaths.length > 0) {
      issues.push({
        code: "root-has-exclusions",
        path: root.id,
        message: "The root scope cannot exclude repository paths.",
      });
    }
  }

  for (const scope of catalog.scopes) {
    if (
      scope.parentScopeId !== undefined &&
      !scopes.has(scope.parentScopeId)
    ) {
      issues.push({
        code: "missing-parent-scope",
        path: scope.id,
        message: `Missing parent scope ${scope.parentScopeId} for ${scope.id}.`,
      });
    }
    const dependencies = new Set<string>();
    for (const dependencyScopeId of scope.dependencyScopeIds) {
      if (dependencies.has(dependencyScopeId)) {
        issues.push({
          code: "duplicate-scope-dependency",
          path: scope.id,
          message: `Duplicate dependency ${dependencyScopeId} for ${scope.id}.`,
        });
      }
      dependencies.add(dependencyScopeId);
      if (!scopes.has(dependencyScopeId)) {
        issues.push({
          code: "missing-dependency-scope",
          path: scope.id,
          message: `Missing dependency scope ${dependencyScopeId} for ${scope.id}.`,
        });
      }
    }
  }

  issues.push(...slDetectGraphCycles(scopes));
  return issues;
}

function slSchemaIssues(
  errors: ErrorObject[] | null | undefined,
): SLScopeCatalogIssue[] {
  return (errors ?? []).map((error) => ({
    code: "scope-catalog-schema",
    path: error.instancePath || "/",
    message: error.message ?? "Scope catalog is invalid.",
  }));
}

export async function slReadScopeCatalogSource(
  root: string,
): Promise<SLScopeCatalogSource> {
  const existingPaths: string[] = [];
  for (const path of SL_PATHS.scopeCatalogCandidates) {
    if (await slExists(slResolveInside(root, path))) {
      existingPaths.push(path);
    }
  }
  if (existingPaths.length > 1) {
    throw new SLScopeCatalogValidationError([
      {
        code: "multiple-scope-catalogs",
        message: `Only one SL scope catalog is allowed: ${existingPaths.join(", ")}`,
      },
    ]);
  }
  const path = existingPaths[0];
  if (!path) {
    return {
      catalog: structuredClone(SL_DEFAULT_SCOPE_CATALOG),
      path: null,
      format: "default",
    };
  }

  const content = await slReadContainedText(root, path);
  try {
    return {
      catalog: path.endsWith(".json") ? JSON.parse(content) : parse(content),
      path,
      format: path.endsWith(".json") ? "json" : "yaml",
    };
  } catch (error) {
    throw new SLScopeCatalogValidationError(
      [
        {
          code: "scope-catalog-parse",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
      path,
    );
  }
}

export async function slLoadScopeCatalog(root: string): Promise<SLScopeCatalog> {
  const source = await slReadScopeCatalogSource(root);
  const packageRoot = await slFindPackageRoot(import.meta.url);
  const schema = await slReadJson<object>(
    slResolveInside(packageRoot, "SL-schemas/SL-scope-catalog.schema.json"),
  );
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile<SLScopeCatalog>(schema);
  if (!validate(source.catalog)) {
    throw new SLScopeCatalogValidationError(
      slSchemaIssues(validate.errors),
      source.path,
    );
  }
  const catalog = source.catalog;
  const issues = slValidateScopeCatalog(catalog);
  if (issues.length > 0) {
    throw new SLScopeCatalogValidationError(issues, source.path);
  }
  return catalog;
}

export class SLScopeResolver {
  readonly catalog: SLScopeCatalog;
  private readonly scopes: Map<string, SLScopeDefinition>;
  private readonly compiledScopes: SLCompiledScope[];
  private readonly rootScopeId: string;
  private readonly hierarchyDepths = new Map<string, number>();

  constructor(catalog: SLScopeCatalog) {
    const issues = slValidateScopeCatalog(catalog);
    if (issues.length > 0) {
      throw new SLScopeCatalogValidationError(issues);
    }
    this.catalog = structuredClone(catalog);
    this.scopes = new Map(
      this.catalog.scopes.map((scope) => [scope.id, scope]),
    );
    const root = this.catalog.scopes.find(
      (scope) => scope.parentScopeId === undefined,
    );
    if (!root) {
      throw new Error("Validated scope catalog does not contain a root scope.");
    }
    this.rootScopeId = root.id;
    this.compiledScopes = this.catalog.scopes.map((scope) => ({
      scope,
      includes: [...scope.includePaths],
      excludes: [...scope.excludePaths],
    }));
  }

  private hierarchyDepth(scopeId: string): number {
    const cached = this.hierarchyDepths.get(scopeId);
    if (cached !== undefined) {
      return cached;
    }
    let depth = 0;
    let current = this.scopes.get(scopeId);
    while (current?.parentScopeId) {
      depth += 1;
      current = this.scopes.get(current.parentScopeId);
    }
    this.hierarchyDepths.set(scopeId, depth);
    return depth;
  }

  private matchingScopes(normalizedPath: string): SLScopeMatch[] {
    const matches: SLScopeMatch[] = [];
    for (const compiled of this.compiledScopes) {
      const excluded = compiled.excludes.some((matcher) =>
        slMatchPath(matcher, normalizedPath),
      );
      if (excluded) {
        continue;
      }
      const matchedPatterns = compiled.scope.includePaths.filter(
        (_, index) => {
          const matcher = compiled.includes[index];
          return matcher ? slMatchPath(matcher, normalizedPath) : false;
        },
      );
      if (
        compiled.scope.id === this.rootScopeId &&
        normalizedPath === ""
      ) {
        matchedPatterns.push("**");
      }
      if (matchedPatterns.length === 0) {
        continue;
      }
      const specificity = matchedPatterns
        .map(slPatternSpecificity)
        .sort((left, right) => slCompareSpecificity(right, left))[0];
      if (!specificity) {
        continue;
      }
      matches.push({
        scope: compiled.scope,
        specificity,
        hierarchyDepth: this.hierarchyDepth(compiled.scope.id),
      });
    }
    return matches;
  }

  private compareMatches(left: SLScopeMatch, right: SLScopeMatch): number {
    const specificity = slCompareSpecificity(
      left.specificity,
      right.specificity,
    );
    if (specificity !== 0) {
      return specificity;
    }
    const hierarchy = left.hierarchyDepth - right.hierarchyDepth;
    if (hierarchy !== 0) {
      return hierarchy;
    }
    return (left.scope.priority ?? 0) - (right.scope.priority ?? 0);
  }

  private dependencyOrder(scopeId: string): string[] {
    const ordered: string[] = [];
    const seen = new Set<string>([scopeId]);
    const visit = (currentScopeId: string): void => {
      const current = this.scopes.get(currentScopeId);
      if (!current) {
        return;
      }
      for (const dependencyScopeId of [...current.dependencyScopeIds].sort()) {
        if (seen.has(dependencyScopeId)) {
          continue;
        }
        seen.add(dependencyScopeId);
        ordered.push(dependencyScopeId);
        visit(dependencyScopeId);
      }
    };
    visit(scopeId);
    return ordered;
  }

  private ancestorOrder(scopeIds: string[]): string[] {
    const ancestorIds = new Set<string>();
    for (const scopeId of scopeIds) {
      let current = this.scopes.get(scopeId);
      while (current?.parentScopeId) {
        ancestorIds.add(current.parentScopeId);
        current = this.scopes.get(current.parentScopeId);
      }
    }
    return [...ancestorIds].sort((left, right) => {
      const depthDifference =
        this.hierarchyDepth(right) - this.hierarchyDepth(left);
      return depthDifference !== 0
        ? depthDifference
        : left.localeCompare(right);
    });
  }

  resolvePath(root: string, pathValue: string): SLScopeResolution {
    const normalizedPath = slNormalizeRepositoryPath(root, pathValue);
    const matches = this.matchingScopes(normalizedPath);
    if (matches.length === 0) {
      throw new Error(`No SL scope matches repository path: ${normalizedPath}`);
    }
    matches.sort((left, right) => {
      const precedence = this.compareMatches(right, left);
      return precedence !== 0
        ? precedence
        : left.scope.id.localeCompare(right.scope.id);
    });
    const primary = matches[0];
    if (!primary) {
      throw new Error(`No SL scope matches repository path: ${normalizedPath}`);
    }
    const equalPrecedence = matches.filter(
      (match) => this.compareMatches(match, primary) === 0,
    );
    if (equalPrecedence.length > 1) {
      throw new SLScopeAmbiguityError(
        normalizedPath,
        equalPrecedence.map((match) => match.scope.id).sort(),
      );
    }

    const dependencies = this.dependencyOrder(primary.scope.id);
    const ancestors = this.ancestorOrder([primary.scope.id, ...dependencies]);
    const ancestorIds = new Set(ancestors);
    const orderedScopeIds = [
      primary.scope.id,
      ...dependencies.filter((scopeId) => !ancestorIds.has(scopeId)),
      ...ancestors,
    ].filter(
      (scopeId, index, values) => values.indexOf(scopeId) === index,
    );
    return {
      inputPath: pathValue,
      normalizedPath,
      primaryScopeId: primary.scope.id,
      matchedScopeIds: matches.map((match) => match.scope.id),
      orderedScopeIds,
    };
  }

  resolveCurrentDirectory(
    root: string,
    currentDirectory: string,
  ): SLScopeResolution {
    return this.resolvePath(root, currentDirectory);
  }

  resolveChangedPaths(
    root: string,
    changedPaths: string[],
  ): SLScopeSetResolution {
    const paths = changedPaths.map((path) => this.resolvePath(root, path));
    const primaryScopeIds = paths
      .map((path) => path.primaryScopeId)
      .filter((scopeId, index, values) => values.indexOf(scopeId) === index);
    const dependencies = primaryScopeIds
      .flatMap((scopeId) => this.dependencyOrder(scopeId))
      .filter((scopeId, index, values) => values.indexOf(scopeId) === index);
    const ancestors = this.ancestorOrder([...primaryScopeIds, ...dependencies]);
    const ancestorIds = new Set(ancestors);
    const orderedScopeIds = [
      ...primaryScopeIds,
      ...dependencies.filter((scopeId) => !ancestorIds.has(scopeId)),
      ...ancestors,
    ]
      .filter((scopeId, index, values) => values.indexOf(scopeId) === index);
    return { paths, primaryScopeIds, orderedScopeIds };
  }
}

export async function slResolveRepositoryScopes(
  root: string,
  paths: string[],
): Promise<SLScopeSetResolution> {
  const catalog = await slLoadScopeCatalog(root);
  return new SLScopeResolver(catalog).resolveChangedPaths(root, paths);
}
