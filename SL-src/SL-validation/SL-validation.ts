import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";
import fg from "fast-glob";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";
import { SL_PATHS, SL_SECRET_PATTERNS, SL_USER_PATH_PATTERN } from "../SL-core/SL-constants.js";
import { slLoadConfig } from "../SL-core/SL-config.js";
import { slParseMarkdown } from "../SL-core/SL-frontmatter.js";
import { slFindPackageRoot } from "../SL-core/SL-package.js";
import { slLoadRegistry } from "../SL-core/SL-registry.js";
import type {
  SLConfig,
  SLIndex,
  SLRegistry,
  SLValidationIssue,
} from "../SL-core/SL-types.js";
import {
  slExists,
  slAssertRealPathInside,
  slNormalizePath,
  slReadJson,
  slReadText,
  slResolveInside,
} from "../SL-core/SL-utils.js";
import { slBuildIndex } from "../SL-index/SL-index.js";

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
  const [configSchema, lessonSchema, registrySchema, indexSchema] = await Promise.all([
    slReadJson<object>(resolve(packageRoot, "SL-schemas/SL-config.schema.json")),
    slReadJson<object>(resolve(packageRoot, "SL-schemas/SL-lesson.schema.json")),
    slReadJson<object>(resolve(packageRoot, "SL-schemas/SL-registry.schema.json")),
    slReadJson<object>(resolve(packageRoot, "SL-schemas/SL-index.schema.json")),
  ]);
  const validateConfig = ajv.compile<SLConfig>(configSchema);
  const validateLesson = ajv.compile<Record<string, unknown>>(lessonSchema);
  const validateRegistry = ajv.compile<SLRegistry>(registrySchema);
  const validateIndex = ajv.compile<SLIndex>(indexSchema);
  const issues: SLValidationIssue[] = [];

  const config = await slLoadConfig(root);
  if (!validateConfig(config)) {
    issues.push(...slAjvIssues("config-schema", SL_PATHS.config, validateConfig.errors));
  }

  const registry = await slLoadRegistry(root);
  if (!validateRegistry(registry)) {
    issues.push(...slAjvIssues("registry-schema", SL_PATHS.registry, validateRegistry.errors));
  }

  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const artifact of registry.artifacts) {
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
      if (paths.has(normalizedPath)) {
        issues.push({
          severity: "error",
          code: "duplicate-path",
          path: normalizedPath,
          message: "Multiple registry entries own the same path.",
        });
      }
      paths.add(normalizedPath);

      const absolutePath = slResolveInside(root, normalizedPath);
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

  const indexPath = slResolveInside(root, SL_PATHS.index);
  if (await slExists(indexPath)) {
    const actualIndex = await slReadJson<SLIndex>(indexPath);
    if (!validateIndex(actualIndex)) {
      issues.push(...slAjvIssues("index-schema", SL_PATHS.index, validateIndex.errors));
    }
    const expectedIndex = await slBuildIndex(root, registry);
    if (JSON.stringify(actualIndex) !== JSON.stringify(expectedIndex)) {
      issues.push({
        severity: "error",
        code: "index-drift",
        path: SL_PATHS.index,
        message: "Generated index is stale; run sl-repo index.",
      });
    }
  } else {
    issues.push({
      severity: "error",
      code: "missing-index",
      path: SL_PATHS.index,
      message: "Generated index is missing.",
    });
  }

  return issues;
}
