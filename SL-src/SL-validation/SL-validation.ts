import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";
import fg from "fast-glob";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";
import {
  SL_ACTIVE_STATUSES,
  SL_PATHS,
  SL_SECRET_PATTERNS,
  SL_USER_PATH_PATTERN,
} from "../SL-core/SL-constants.js";
import { slLoadConfig } from "../SL-core/SL-config.js";
import { slParseMarkdown } from "../SL-core/SL-frontmatter.js";
import { slFindPackageRoot } from "../SL-core/SL-package.js";
import {
  slCreateLifecycleEvent,
  slLifecycleEventPath,
  slLoadRegistry,
  slValidateLifecycleEvent,
} from "../SL-core/SL-registry.js";
import {
  slLoadScopeCatalog,
  slScopeDescriptor,
  slScopeDescriptors,
  SLScopeCatalogValidationError,
} from "../SL-core/SL-scope.js";
import type {
  SLConfig,
  SLIndex,
  SLEvent,
  SLLifecycleEvent,
  SLRegistry,
  SLScopeCatalog,
  SLUsageApplicationEvent,
  SLUsageEvent,
  SLScopeRegistry,
  SLScopeUsageProjection,
  SLStateCatalog,
  SLValidationIssue,
} from "../SL-core/SL-types.js";
import {
  slApplyUsageProjection,
  slProjectUsageEvents,
  slUsageEventPath,
  slValidateUsageEvent,
} from "../SL-core/SL-usage.js";
import {
  slExists,
  slAssertRealPathInside,
  slNormalizePath,
  slReadJson,
  slReadText,
  slResolveInside,
} from "../SL-core/SL-utils.js";
import { slBuildScopeIndexes } from "../SL-index/SL-index.js";
import {
  slAssertCatalogEntryPaths,
  slBuildStateCatalog,
  slLoadStateCatalog,
  slNormalizeScope,
  slScopeKey,
} from "../SL-core/SL-state.js";
import {
  slIsActivePromotionStatus,
  slPromotionEvaluationIsCurrent,
} from "../SL-core/SL-promotion-lifecycle.js";
import {
  slEvaluateScopedGuidanceConflicts,
  type SLScopedGuidance,
} from "../SL-core/SL-promotion-governance.js";
import {
  slEvaluateValidationContract,
  slFindValidationContractConflicts,
  slPromotedContractTarget,
  type SLActiveValidationContract,
} from "./SL-validation-contract.js";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as FormatsPlugin;

function slAjvIssues(
  code: string,
  path: string,
  errors: ErrorObject[] | null | undefined,
): SLValidationIssue[] {
  return (errors ?? []).map((error) => ({
    severity: "error",
    code,
    path,
    message: `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
  }));
}

function slCheckContent(path: string, content: string): SLValidationIssue[] {
  const issues: SLValidationIssue[] = [];
  for (const secret of SL_SECRET_PATTERNS) {
    if (secret.pattern.test(content)) {
      issues.push({
        severity: "error",
        code: `secret-${secret.code}`,
        path,
        message: "Potential secret or credential material detected.",
      });
    }
  }
  if (SL_USER_PATH_PATTERN.test(content)) {
    issues.push({
      severity: "error",
      code: "absolute-user-path",
      path,
      message: "Absolute user-profile path detected; use ~/ or a placeholder.",
    });
  }
  return issues;
}

export async function slValidateRepository(root: string): Promise<SLValidationIssue[]> {
  const packageRoot = await slFindPackageRoot(import.meta.url);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const [
    configSchema,
    lessonSchema,
    registrySchema,
    indexSchema,
    usageEventSchema,
    lifecycleEventSchema,
    stateCatalogSchema,
    scopeRegistrySchema,
    usageProjectionSchema,
  ] = await Promise.all([
    slReadJson<object>(resolve(packageRoot, "SL-schemas/SL-config.schema.json")),
    slReadJson<object>(resolve(packageRoot, "SL-schemas/SL-lesson.schema.json")),
    slReadJson<object>(resolve(packageRoot, "SL-schemas/SL-registry.schema.json")),
    slReadJson<object>(resolve(packageRoot, "SL-schemas/SL-index.schema.json")),
    slReadJson<object>(resolve(packageRoot, "SL-schemas/SL-usage-event.schema.json")),
    slReadJson<object>(resolve(packageRoot, "SL-schemas/SL-lifecycle-event.schema.json")),
    slReadJson<object>(resolve(packageRoot, "SL-schemas/SL-state-catalog.schema.json")),
    slReadJson<object>(resolve(packageRoot, "SL-schemas/SL-scope-registry.schema.json")),
    slReadJson<object>(resolve(packageRoot, "SL-schemas/SL-usage-projection.schema.json")),
  ]);
  ajv.addSchema(stateCatalogSchema);
  ajv.addSchema(registrySchema);
  const validateConfig = ajv.compile<SLConfig>(configSchema);
  const validateLesson = ajv.compile<Record<string, unknown>>(lessonSchema);
  const validateRegistry = ajv.compile<SLRegistry>(registrySchema);
  const validateIndex = ajv.compile<SLIndex>(indexSchema);
  const validateUsageEvent = ajv.compile<SLUsageEvent>(usageEventSchema);
  const validateLifecycleEvent =
    ajv.compile<SLLifecycleEvent>(lifecycleEventSchema);
  const validateStateCatalog = ajv.compile<SLStateCatalog>(stateCatalogSchema);
  const validateScopeRegistry =
    ajv.compile<SLScopeRegistry>(scopeRegistrySchema);
  const validateUsageProjection =
    ajv.compile<SLScopeUsageProjection>(usageProjectionSchema);
  const issues: SLValidationIssue[] = [];

  const config = await slLoadConfig(root);
  if (!validateConfig(config)) {
    issues.push(...slAjvIssues("config-schema", SL_PATHS.config, validateConfig.errors));
  }

  let scopeCatalog: SLScopeCatalog | undefined;
  try {
    scopeCatalog = await slLoadScopeCatalog(root);
  } catch (error) {
    if (error instanceof SLScopeCatalogValidationError) {
      issues.push(
        ...error.issues.map((issue) => ({
          severity: "error" as const,
          code: issue.code,
          path: error.catalogPath ?? SL_PATHS.scopeCatalog,
          message: issue.path
            ? `${issue.path}: ${issue.message}`
            : issue.message,
        })),
      );
    } else {
      issues.push({
        severity: "error",
        code: "scope-catalog-invalid",
        path: SL_PATHS.scopeCatalog,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let registry: SLRegistry;
  try {
    registry = await slLoadRegistry(root);
  } catch (error) {
    issues.push({
      severity: "error",
      code: "scope-state-load",
      path: SL_PATHS.stateCatalog,
      message: error instanceof Error ? error.message : String(error),
    });
    const legacyRegistryPath = slResolveInside(root, SL_PATHS.registry);
    registry = (await slExists(legacyRegistryPath))
      ? await slReadJson<SLRegistry>(legacyRegistryPath)
      : { schemaVersion: 1, artifacts: [] };
    registry.artifacts = registry.artifacts.map((artifact) => ({
      ...artifact,
      scope: slNormalizeScope(artifact.scope ?? { id: "repo", path: "." }),
    }));
  }
  if (!validateRegistry(registry)) {
    issues.push(...slAjvIssues("registry-schema", SL_PATHS.registry, validateRegistry.errors));
  }

  const catalog = await slLoadStateCatalog(root);
  if (!validateStateCatalog(catalog)) {
    issues.push(
      ...slAjvIssues(
        "state-catalog-schema",
        SL_PATHS.stateCatalog,
        validateStateCatalog.errors,
      ),
    );
  }
  const catalogScopeKeys = new Set<string>();
  const catalogShards = new Map<string, string>();
  const shardArtifactOwners = new Map<string, string>();
  for (const entry of catalog.scopes) {
    const key = slScopeKey(entry.scope);
    if (catalogScopeKeys.has(key)) {
      issues.push({
        severity: "error",
        code: "scope-catalog-duplicate",
        path: SL_PATHS.stateCatalog,
        message: `Scope ${entry.scope.id}:${entry.scope.path} appears more than once.`,
      });
    }
    catalogScopeKeys.add(key);
    if (
      scopeCatalog &&
      !scopeCatalog.scopes.some(
        (scope) =>
          slScopeKey(slScopeDescriptor(scope)) === key,
      )
    ) {
      issues.push({
        severity: "error",
        code: "scope-state-orphan",
        path: SL_PATHS.stateCatalog,
        message: `State shard ${entry.shard} references a scope no longer declared in the hand-authored catalog.`,
      });
    }
    const shardOwner = catalogShards.get(entry.shard);
    if (shardOwner && shardOwner !== key) {
      issues.push({
        severity: "error",
        code: "scope-shard-collision",
        path: SL_PATHS.stateCatalog,
        message: `Normalized shard ${entry.shard} is shared by ${shardOwner} and ${key}.`,
      });
    } else {
      catalogShards.set(entry.shard, key);
    }
    try {
      slAssertCatalogEntryPaths(entry);
      for (const shardPath of [
        entry.registryPath,
        entry.indexPath,
        entry.projectionPath,
        entry.usageEventsPath,
      ]) {
        await slAssertRealPathInside(root, shardPath);
      }
    } catch (error) {
      issues.push({
        severity: "error",
        code: "scope-shard-containment",
        path: SL_PATHS.stateCatalog,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const registryPath = slResolveInside(root, entry.registryPath);
    if (!(await slExists(registryPath))) {
      issues.push({
        severity: "error",
        code: "scope-registry-missing",
        path: entry.registryPath,
        message: "Scope registry shard is missing.",
      });
      continue;
    }
    try {
      const shard = await slReadJson<SLScopeRegistry>(registryPath);
      if (!validateScopeRegistry(shard)) {
        issues.push(
          ...slAjvIssues(
            "scope-registry-schema",
            entry.registryPath,
            validateScopeRegistry.errors,
          ),
        );
        continue;
      }
      if (slScopeKey(shard.scope) !== key) {
        issues.push({
          severity: "error",
          code: "scope-registry-scope",
          path: entry.registryPath,
          message: "Scope registry descriptor does not match its catalog entry.",
        });
      }
      for (const artifact of shard.artifacts) {
        const artifactScope = slNormalizeScope(artifact.scope ?? shard.scope);
        if (slScopeKey(artifactScope) !== key) {
          issues.push({
            severity: "error",
            code: "scope-registry-artifact",
            path: entry.registryPath,
            message: `Artifact ${artifact.id} belongs to a different scope.`,
          });
        }
        const prior = shardArtifactOwners.get(artifact.id);
        if (prior && prior !== entry.registryPath) {
          issues.push({
            severity: "error",
            code: "scope-registry-duplicate-artifact",
            path: entry.registryPath,
            message: `Artifact ${artifact.id} is also present at ${prior}.`,
          });
        } else {
          shardArtifactOwners.set(artifact.id, entry.registryPath);
        }
      }
    } catch (error) {
      issues.push({
        severity: "error",
        code: "scope-registry-json",
        path: entry.registryPath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  try {
    const expectedCatalog = slBuildStateCatalog(
      [
        ...(scopeCatalog ? slScopeDescriptors(scopeCatalog) : []),
        ...registry.artifacts.map((artifact) => artifact.scope ?? {
          id: "SL-SCOPE-ROOT",
          path: ".",
        }),
      ],
    );
    if (JSON.stringify(catalog) !== JSON.stringify(expectedCatalog)) {
      issues.push({
        severity: "error",
        code: "state-catalog-drift",
        path: SL_PATHS.stateCatalog,
        message: "Scope catalog is stale; run sl-repo project after merging.",
      });
    }
  } catch (error) {
    issues.push({
      severity: "error",
      code: "state-catalog-invalid",
      path: SL_PATHS.stateCatalog,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const ids = new Set<string>();
  const paths = new Set<string>();
  const activeContracts: SLActiveValidationContract[] = [];
  for (const artifact of registry.artifacts) {
    const artifactScope = slNormalizeScope(
      artifact.scope ?? { id: "SL-SCOPE-ROOT", path: "." },
    );
    if (
      scopeCatalog &&
      !scopeCatalog.scopes.some(
        (scope) =>
          slScopeKey(slScopeDescriptor(scope)) ===
          slScopeKey(artifactScope),
      )
    ) {
      issues.push({
        severity: "error",
        code: "artifact-scope-invalid",
        ...(artifact.path ? { path: artifact.path } : {}),
        message: `Artifact ${artifact.id} references undeclared scope ${artifactScope.id}:${artifactScope.path}.`,
      });
    }
    if (ids.has(artifact.id)) {
      issues.push({
        severity: "error",
        code: "duplicate-id",
        message: `Duplicate artifact ID: ${artifact.id}`,
      });
    }
    ids.add(artifact.id);

    if (artifact.path) {
      const normalizedPath = slNormalizePath(artifact.path);
      if (artifact.path !== normalizedPath) {
        issues.push({
          severity: "error",
          code: "non-normalized-path",
          path: artifact.path,
          message: "Registry paths must use normalized repository-relative / separators.",
        });
      }
      if (paths.has(normalizedPath)) {
        issues.push({
          severity: "error",
          code: "duplicate-path",
          path: normalizedPath,
          message: "Multiple registry entries own the same path.",
        });
      }
      paths.add(normalizedPath);

      let absolutePath: string;
      try {
        absolutePath = slResolveInside(root, normalizedPath);
      } catch (error) {
        issues.push({
          severity: "error",
          code: "unsafe-artifact-path",
          path: normalizedPath,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      if (!(await slExists(absolutePath)) && artifact.status !== "deleted") {
        issues.push({
          severity: "error",
          code: "missing-artifact",
          path: normalizedPath,
          message: `Registered artifact ${artifact.id} does not exist.`,
        });
        continue;
      }

      if (await slExists(absolutePath)) {
        try {
          await slAssertRealPathInside(root, normalizedPath);
        } catch (error) {
          issues.push({
            severity: "error",
            code: "symlink-escape",
            path: normalizedPath,
            message: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
        const content = await slReadText(absolutePath);
        issues.push(...slCheckContent(normalizedPath, content));
        if (normalizedPath.endsWith(".md")) {
          try {
            const parsed = slParseMarkdown<Record<string, unknown>>(content);
            if (artifact.artifactType === "lesson" && !validateLesson(parsed.frontmatter)) {
              issues.push(
                ...slAjvIssues("lesson-schema", normalizedPath, validateLesson.errors),
              );
            }
            if (
              parsed.frontmatter.id &&
              parsed.frontmatter.id !== artifact.id
            ) {
              issues.push({
                severity: "error",
                code: "id-mismatch",
                path: normalizedPath,
                message: `Frontmatter ID does not match registry ID ${artifact.id}.`,
              });
            }
            if (
              artifact.classification !== "system" &&
              (
                parsed.frontmatter.managedBy !== "SL-Repo" ||
                parsed.frontmatter.status !== artifact.status ||
                parsed.frontmatter.pinned !== artifact.pinned
              )
            ) {
              issues.push({
                severity: "error",
                code: "artifact-ownership-mismatch",
                path: normalizedPath,
                message:
                  "Artifact frontmatter ownership, lifecycle status, or pin state does not match the registry.",
              });
            }
            const promotedTarget = slPromotedContractTarget(
              artifact,
              parsed.frontmatter,
            );
            if (
              artifact.classification === "promoted" &&
              artifact.status === "promoted" &&
              typeof parsed.frontmatter.validationContract !== "string"
            ) {
              issues.push({
                severity: "warning",
                code: "legacy-promoted-compatibility",
                path: normalizedPath,
                message:
                  "Legacy promoted status is treated as active guidance; migrate it through probation to record governed activation evidence.",
              });
            }
            if (promotedTarget) {
              const evaluation = await slEvaluateValidationContract(
                root,
                promotedTarget,
              );
              for (const check of evaluation.checks) {
                if (check.status === "failed") {
                  issues.push({
                    severity: "error",
                    code: `validation-contract-${check.id}`,
                    path: normalizedPath,
                    message: check.message,
                  });
                }
              }
              if (
                slIsActivePromotionStatus(artifact.status) &&
                evaluation.status === "passed" &&
                evaluation.contract
              ) {
                activeContracts.push({
                  artifactId: artifact.id,
                  contract: evaluation.contract,
                });
              }
              const sourceIds = artifact.dependsOn ?? [];
              const invalidSources = await Promise.all(
                sourceIds.map(async (sourceId) => {
                  const source = registry.artifacts.find(
                    (candidate) => candidate.id === sourceId,
                  );
                  return (
                    !source ||
                    source.classification !== "evidence" ||
                    !SL_ACTIVE_STATUSES.has(source.status) ||
                    !source.path ||
                    !(await slExists(slResolveInside(root, source.path)))
                  );
                }),
              );
              if (
                sourceIds.length === 0 ||
                invalidSources.some(Boolean)
              ) {
                issues.push({
                  severity: "error",
                  code: "promotion-source",
                  path: normalizedPath,
                  message:
                    "Promoted artifacts must depend on available active evidence source IDs.",
                });
              }
            }
            if (
              artifact.classification === "promoted" &&
              artifact.status === "active" &&
              !(await slPromotionEvaluationIsCurrent(root, artifact))
            ) {
              issues.push({
                severity: "error",
                code: "promotion-evaluation-stale",
                path: normalizedPath,
                message:
                  "Active promotion evaluation is missing, failed, or no longer matches artifact and contract content.",
              });
            }
            if (
              artifact.classification === "promoted" &&
              artifact.status === "probation" &&
              artifact.promotionEvaluation?.status === "passed" &&
              !(await slPromotionEvaluationIsCurrent(root, artifact))
            ) {
              issues.push({
                severity: "error",
                code: "promotion-evaluation-stale",
                path: normalizedPath,
                message:
                  "Probation promotion content changed after its passing evaluation.",
              });
            }
          } catch (error) {
            issues.push({
              severity: "error",
              code: "frontmatter",
              path: normalizedPath,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      if (
        artifact.artifactType === "lesson" &&
        !basename(normalizedPath).startsWith("SL-")
      ) {
        issues.push({
          severity: "error",
          code: "lesson-prefix",
          path: normalizedPath,
          message: "SL-owned lesson filenames must start with SL-.",
        });
      }
      if (
        artifact.artifactType === "instruction" &&
        !basename(normalizedPath).startsWith("SL-")
      ) {
        issues.push({
          severity: "error",
          code: "instruction-prefix",
          path: normalizedPath,
          message: "SL-produced instruction filenames must start with SL-.",
        });
      }
      if (
        artifact.artifactType === "skill" &&
        !basename(dirname(normalizedPath)).startsWith("SL-")
      ) {
        issues.push({
          severity: "error",
          code: "skill-prefix",
          path: normalizedPath,
          message: "SL-produced skill directories must start with SL-.",
        });
      }
    }

    for (const relatedId of [
      ...artifact.relatedTo,
      ...(artifact.dependsOn ?? []),
    ]) {
      if (!registry.artifacts.some((candidate) => candidate.id === relatedId)) {
        issues.push({
          severity: "error",
          code: "broken-reference",
          message: `${artifact.id} references unknown artifact ${relatedId}.`,
          ...(artifact.path ? { path: artifact.path } : {}),
        });
      }
    }
  }

  const governedContracts: SLActiveValidationContract[] = [];
  const legacyContracts: SLActiveValidationContract[] = [];
  const governedGuidance: SLScopedGuidance[] = [];
  for (const active of activeContracts) {
    const artifact = registry.artifacts.find(
      (candidate) => candidate.id === active.artifactId,
    );
    const scope = artifact?.promotionEvaluation?.governance?.targetScope;
    if (!scope) {
      legacyContracts.push(active);
      continue;
    }
    governedContracts.push(active);
    governedGuidance.push({
      artifactId: active.artifactId,
      scope,
      applicability: active.contract.scope,
      declarations: active.contract.declarations ?? [],
    });
  }
  const legacyConflicts = [
    ...slFindValidationContractConflicts(legacyContracts),
    ...governedContracts.flatMap((governed) =>
      legacyContracts.flatMap((legacy) =>
        slFindValidationContractConflicts([legacy, governed]),
      ),
    ),
  ];
  for (const conflict of legacyConflicts) {
    const artifact = registry.artifacts.find(
      (candidate) => candidate.id === conflict.rightArtifactId,
    );
    issues.push({
      severity: "error",
      code: "validation-contract-conflict",
      ...(artifact?.path ? { path: artifact.path } : {}),
      message: conflict.message,
    });
  }
  if (governedGuidance.length > 0) {
    try {
      const scoped = slEvaluateScopedGuidanceConflicts(
        config.promotion,
        governedGuidance,
      );
      for (const conflict of scoped.resolutions.filter(
        (resolution) => resolution.status === "blocked",
      )) {
        const artifact = registry.artifacts.find(
          (candidate) =>
            candidate.id === conflict.narrowerArtifactId,
        );
        issues.push({
          severity: "error",
          code: "validation-contract-conflict",
          ...(artifact?.path ? { path: artifact.path } : {}),
          message: conflict.message,
        });
      }
    } catch (error) {
      issues.push({
        severity: "error",
        code: "promotion-governance-policy",
        path: SL_PATHS.config,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const usageEvents: SLUsageEvent[] = [];
  const usageEventIds = new Map<string, string>();
  const usageIdempotencyKeys = new Map<string, string>();
  const legacyBaselines = new Map<string, string>();
  const applications = new Map<string, SLUsageApplicationEvent[]>();
  let usageFiles: string[] = [];
  const legacyUsageRoot = slResolveInside(root, SL_PATHS.usageEvents);
  if (await slExists(legacyUsageRoot)) {
    try {
      await slAssertRealPathInside(root, SL_PATHS.usageEvents);
    } catch (error) {
      issues.push({
        severity: "error",
        code: "usage-event-containment",
        path: SL_PATHS.usageEvents,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  try {
    await slAssertRealPathInside(root, SL_PATHS.learningRoot);
    usageFiles = await fg([
      `${SL_PATHS.usageEvents}/**/*`,
      `${SL_PATHS.scopeRoot}/*/SL-usage-events/**/*`,
    ], {
      cwd: root,
      onlyFiles: true,
      followSymbolicLinks: false,
    });
  } catch (error) {
    issues.push({
      severity: "error",
      code: "usage-event-containment",
      path: SL_PATHS.learningRoot,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  for (const usageFileValue of usageFiles.sort()) {
    const usageFile = slNormalizePath(usageFileValue);
    if (!usageFile.endsWith(".json")) {
      issues.push({
        severity: "error",
        code: "usage-event-extension",
        path: usageFile,
        message: "Usage event directories may contain only immutable JSON event files.",
      });
      continue;
    }
    let event: SLUsageEvent;
    try {
      await slAssertRealPathInside(root, usageFile);
      const content = await slReadText(slResolveInside(root, usageFile));
      issues.push(...slCheckContent(usageFile, content));
      event = JSON.parse(content) as SLUsageEvent;
    } catch (error) {
      issues.push({
        severity: "error",
        code: "usage-event-json",
        path: usageFile,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (!validateUsageEvent(event)) {
      issues.push(
        ...slAjvIssues(
          "usage-event-schema",
          usageFile,
          validateUsageEvent.errors,
        ),
      );
      continue;
    }
    try {
      slValidateUsageEvent(event);
    } catch (error) {
      issues.push({
        severity: "error",
        code: "usage-event-integrity",
        path: usageFile,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (slUsageEventPath(event) !== usageFile) {
      issues.push({
        severity: "error",
        code: "usage-event-path",
        path: usageFile,
        message: "Usage event path does not match its timestamp and event ID.",
      });
    }
    const duplicateIdPath = usageEventIds.get(event.eventId);
    if (duplicateIdPath) {
      issues.push({
        severity: "error",
        code: "usage-event-duplicate-id",
        path: usageFile,
        message: `Usage event ID is already present at ${duplicateIdPath}.`,
      });
    } else {
      usageEventIds.set(event.eventId, usageFile);
    }
    const duplicateKeyPath = usageIdempotencyKeys.get(event.idempotencyKey);
    if (duplicateKeyPath && duplicateKeyPath !== usageFile) {
      issues.push({
        severity: "error",
        code: "usage-event-duplicate-idempotency",
        path: usageFile,
        message: `Usage idempotency key is already present at ${duplicateKeyPath}.`,
      });
    } else {
      usageIdempotencyKeys.set(event.idempotencyKey, usageFile);
    }
    const usageArtifact = registry.artifacts.find(
      (artifact) => artifact.id === event.artifactId,
    );
    if (!usageArtifact) {
      issues.push({
        severity: "error",
        code: "usage-event-artifact",
        path: usageFile,
        message: `Usage event references unknown artifact ${event.artifactId}.`,
      });
    } else if (
      scopeCatalog &&
      !scopeCatalog.scopes.some(
        (scope) =>
          slScopeKey(slScopeDescriptor(scope)) ===
          slScopeKey(
            event.scope ?? { id: "SL-SCOPE-ROOT", path: "." },
          ),
      )
    ) {
      issues.push({
        severity: "error",
        code: "usage-event-scope",
        path: usageFile,
        message: `Usage event references an undeclared source scope.`,
      });
    }
    if (event.eventType === "legacy-baseline") {
      const priorBaseline = legacyBaselines.get(event.artifactId);
      if (priorBaseline) {
        issues.push({
          severity: "error",
          code: "usage-event-duplicate-baseline",
          path: usageFile,
          message: `Legacy baseline for ${event.artifactId} is already present at ${priorBaseline}.`,
        });
      } else {
        legacyBaselines.set(event.artifactId, usageFile);
      }
    } else {
      const applicationEvents = applications.get(event.applicationId) ?? [];
      applicationEvents.push(event);
      applications.set(event.applicationId, applicationEvents);
    }
    usageEvents.push(event);
  }

  for (const [applicationId, applicationEvents] of applications) {
    const identities = new Set(
      applicationEvents.map((event) =>
        [
          event.artifactId,
          event.artifactVersion,
          event.artifactContentHash,
          event.taskRunId,
          slScopeKey(
            event.scope ?? { id: "SL-SCOPE-ROOT", path: "." },
          ),
        ].join("\0"),
      ),
    );
    if (identities.size !== 1) {
      issues.push({
        severity: "error",
        code: "usage-application-identity",
        message: `Application ${applicationId} is bound to conflicting artifact identity data.`,
      });
    }
    const stageCounts = new Map<string, number>();
    for (const event of applicationEvents) {
      stageCounts.set(event.stage, (stageCounts.get(event.stage) ?? 0) + 1);
    }
    for (const [stage, count] of stageCounts) {
      if (count > 1) {
        issues.push({
          severity: "error",
          code: "usage-application-duplicate-stage",
          message: `Application ${applicationId} has ${count} distinct ${stage} events.`,
        });
      }
    }
    const terminalOutcomes = new Set(
      applicationEvents
        .filter((event) => event.stage === "outcome" || event.stage === "verified")
        .map((event) => event.outcome),
    );
    if (terminalOutcomes.size > 1) {
      issues.push({
        severity: "error",
        code: "usage-application-outcome",
        message: `Application ${applicationId} has conflicting terminal outcomes.`,
      });
    }
  }

  for (const artifact of registry.artifacts) {
    if (
      artifact.classification === "evidence" &&
      !legacyBaselines.has(artifact.id) &&
      ((artifact.hits ?? 0) > 0 ||
        (artifact.retrievals ?? 0) > 0 ||
        (artifact.notUsefulVotes ?? 0) > 0)
    ) {
      issues.push({
        severity: "error",
        code: "legacy-usage-baseline-missing",
        ...(artifact.path ? { path: artifact.path } : {}),
        message:
          "Legacy mutable usage counters must be captured once as an immutable baseline.",
      });
    }
  }

  const lifecycleEventIds = new Map<string, string>();
  let lifecycleFiles: string[] = [];
  try {
    await slAssertRealPathInside(root, SL_PATHS.lifecycleEvents);
    lifecycleFiles = await fg(`${SL_PATHS.lifecycleEvents}/**/*`, {
      cwd: root,
      onlyFiles: true,
      followSymbolicLinks: false,
    });
  } catch (error) {
    issues.push({
      severity: "error",
      code: "lifecycle-event-containment",
      path: SL_PATHS.lifecycleEvents,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  for (const lifecycleFileValue of lifecycleFiles.sort()) {
    const lifecycleFile = slNormalizePath(lifecycleFileValue);
    if (!lifecycleFile.endsWith(".json")) {
      issues.push({
        severity: "error",
        code: "lifecycle-event-extension",
        path: lifecycleFile,
        message: "Lifecycle event directories may contain only immutable JSON event files.",
      });
      continue;
    }
    let event: SLLifecycleEvent;
    try {
      await slAssertRealPathInside(root, lifecycleFile);
      const content = await slReadText(slResolveInside(root, lifecycleFile));
      issues.push(...slCheckContent(lifecycleFile, content));
      event = JSON.parse(content) as SLLifecycleEvent;
    } catch (error) {
      issues.push({
        severity: "error",
        code: "lifecycle-event-json",
        path: lifecycleFile,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (!validateLifecycleEvent(event)) {
      issues.push(
        ...slAjvIssues(
          "lifecycle-event-schema",
          lifecycleFile,
          validateLifecycleEvent.errors,
        ),
      );
      continue;
    }
    try {
      slValidateLifecycleEvent(event);
    } catch (error) {
      issues.push({
        severity: "error",
        code: "lifecycle-event-integrity",
        path: lifecycleFile,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (slLifecycleEventPath(event) !== lifecycleFile) {
      issues.push({
        severity: "error",
        code: "lifecycle-event-path",
        path: lifecycleFile,
        message: "Lifecycle event path does not match its timestamp and event ID.",
      });
    }
    const duplicatePath = lifecycleEventIds.get(event.eventId);
    if (duplicatePath) {
      issues.push({
        severity: "error",
        code: "lifecycle-event-duplicate-id",
        path: lifecycleFile,
        message: `Lifecycle event ID is already present at ${duplicatePath}.`,
      });
    } else {
      lifecycleEventIds.set(event.eventId, lifecycleFile);
    }
    if (!registry.artifacts.some((artifact) => artifact.id === event.artifactId)) {
      issues.push({
        severity: "error",
        code: "lifecycle-event-artifact",
        path: lifecycleFile,
        message: `Lifecycle event references unknown artifact ${event.artifactId}.`,
      });
    }
    for (const eventPath of [event.fromPath, event.toPath]) {
      if (eventPath === null || eventPath === undefined) {
        continue;
      }
      try {
        if (eventPath !== slNormalizePath(eventPath)) {
          throw new Error("Lifecycle event paths must be normalized.");
        }
        const absoluteEventPath = slResolveInside(root, eventPath);
        if (await slExists(absoluteEventPath)) {
          await slAssertRealPathInside(root, eventPath);
        }
      } catch (error) {
        issues.push({
          severity: "error",
          code: "lifecycle-event-artifact-path",
          path: lifecycleFile,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const legacyEventPath = slResolveInside(root, SL_PATHS.legacyEvents);
  if (await slExists(legacyEventPath)) {
    try {
      await slAssertRealPathInside(root, SL_PATHS.legacyEvents);
      const content = await slReadText(legacyEventPath);
      issues.push(...slCheckContent(SL_PATHS.legacyEvents, content));
      for (const [lineIndex, line] of content.split(/\r?\n/).entries()) {
        if (!line.trim()) {
          continue;
        }
        const event = JSON.parse(line) as SLEvent;
        const persisted = slCreateLifecycleEvent(event);
        if (!validateLifecycleEvent(persisted)) {
          throw new Error(
            `Line ${lineIndex + 1} fails lifecycle event schema validation.`,
          );
        }
        slValidateLifecycleEvent(persisted);
        if (!registry.artifacts.some((artifact) => artifact.id === event.artifactId)) {
          throw new Error(
            `Line ${lineIndex + 1} references unknown artifact ${event.artifactId}.`,
          );
        }
      }
      issues.push({
        severity: "warning",
        code: "legacy-event-log",
        path: SL_PATHS.legacyEvents,
        message:
          "Legacy SL-events.jsonl is read-only compatibility data; new lifecycle events use immutable per-event files.",
      });
    } catch (error) {
      issues.push({
        severity: "error",
        code: "legacy-event-log-invalid",
        path: SL_PATHS.legacyEvents,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const projectedRegistry = structuredClone(registry);
  try {
    await slApplyUsageProjection(root, projectedRegistry, usageEvents);
    for (const artifact of registry.artifacts) {
      const expected = projectedRegistry.artifacts.find(
        (candidate) => candidate.id === artifact.id,
      );
      if (!expected) {
        continue;
      }
      const actualProjection = {
        status: artifact.status,
        lastVerifiedAt: artifact.lastVerifiedAt,
        lastRetrievedAt: artifact.lastRetrievedAt,
        lastSuccessfulUseAt: artifact.lastSuccessfulUseAt,
      };
      const expectedProjection = {
        status: expected.status,
        lastVerifiedAt: expected.lastVerifiedAt,
        lastRetrievedAt: expected.lastRetrievedAt,
        lastSuccessfulUseAt: expected.lastSuccessfulUseAt,
      };
      if (JSON.stringify(actualProjection) !== JSON.stringify(expectedProjection)) {
        issues.push({
          severity: "error",
          code: "usage-projection-drift",
          ...(artifact.path ? { path: artifact.path } : {}),
          message:
            "Scope registry lifecycle projection is stale; run a usage command or sl-repo project.",
        });
      }
    }
  } catch (error) {
    issues.push({
      severity: "error",
      code: "usage-projection-invalid",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const lessonFiles = await fg(".github/SL-learning/SL-lessons/**/*.md", {
    cwd: root,
    onlyFiles: true,
  });
  for (const lessonFile of lessonFiles.map(slNormalizePath)) {
    if (!paths.has(lessonFile)) {
      issues.push({
        severity: "error",
        code: "unregistered-lesson",
        path: lessonFile,
        message: "SL-managed lesson is not present in the registry.",
      });
    }
  }

  const expectedIndexes = await slBuildScopeIndexes(root, projectedRegistry);
  const expectedProjectionMap = new Map(
    slProjectUsageEvents(usageEvents).map((projection) => [
      `${slScopeKey(projection.scope)}\0${projection.artifactId}\0${projection.artifactVersion}`,
      projection,
    ]),
  );
  for (const artifact of projectedRegistry.artifacts) {
    if (!artifact.usageProjection) {
      continue;
    }
    const projection = artifact.usageProjection;
    expectedProjectionMap.set(
      `${slScopeKey(projection.scope)}\0${projection.artifactId}\0${projection.artifactVersion}`,
      projection,
    );
  }
  const expectedProjections = [...expectedProjectionMap.values()];
  for (const entry of catalog.scopes) {
    const key = slScopeKey(entry.scope);
    const indexPath = slResolveInside(root, entry.indexPath);
    if (await slExists(indexPath)) {
      const actualIndex = await slReadJson<SLIndex>(indexPath);
      if (!validateIndex(actualIndex)) {
        issues.push(
          ...slAjvIssues(
            "index-schema",
            entry.indexPath,
            validateIndex.errors,
          ),
        );
      }
      const expectedIndex =
        expectedIndexes.get(key) ??
        ({ schemaVersion: 2, scope: entry.scope, artifacts: [] } satisfies SLIndex);
      if (JSON.stringify(actualIndex) !== JSON.stringify(expectedIndex)) {
        issues.push({
          severity: "error",
          code: "index-drift",
          path: entry.indexPath,
          message: "Generated scope index is stale; run sl-repo project.",
        });
      }
    } else {
      issues.push({
        severity: "error",
        code: "missing-index",
        path: entry.indexPath,
        message: "Generated scope index is missing.",
      });
    }

    const projectionPath = slResolveInside(root, entry.projectionPath);
    const expectedProjection: SLScopeUsageProjection = {
      schemaVersion: 1,
      scope: entry.scope,
      currentArtifactVersions: Object.fromEntries(
        projectedRegistry.artifacts
          .filter(
            (artifact) =>
              slScopeKey(artifact.scope ?? { id: "repo", path: "." }) ===
                key &&
              artifact.usageProjection,
          )
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((artifact) => [
            artifact.id,
            artifact.usageProjection!.artifactVersion,
          ]),
      ),
      projections: expectedProjections.filter(
        (projection) => slScopeKey(projection.scope) === key,
      ),
    };
    if (await slExists(projectionPath)) {
      const actualProjection =
        await slReadJson<SLScopeUsageProjection>(projectionPath);
      if (!validateUsageProjection(actualProjection)) {
        issues.push(
          ...slAjvIssues(
            "usage-projection-schema",
            entry.projectionPath,
            validateUsageProjection.errors,
          ),
        );
      }
      if (
        JSON.stringify(actualProjection) !== JSON.stringify(expectedProjection)
      ) {
        issues.push({
          severity: "error",
          code: "usage-projection-drift",
          path: entry.projectionPath,
          message:
            "Generated scope usage projection is stale; run sl-repo project.",
        });
      }
    } else {
      issues.push({
        severity: "error",
        code: "missing-usage-projection",
        path: entry.projectionPath,
        message: "Generated scope usage projection is missing.",
      });
    }
  }

  return issues;
}
