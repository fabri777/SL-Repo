import { SL_ACTIVE_STATUSES } from "./SL-constants.js";
import { slLoadConfig } from "./SL-config.js";
import { slParseMarkdown } from "./SL-frontmatter.js";
import {
  slEvaluateScopedGuidanceConflicts,
  type SLScopedGuidance,
} from "./SL-promotion-governance.js";
import { slPromotionEvaluationIsCurrent } from "./SL-promotion-lifecycle.js";
import { slLoadRegistry } from "./SL-registry.js";
import {
  slFindScopeDefinition,
  slLoadScopeCatalog,
  slPromotionScopeRef,
  SLScopeResolver,
} from "./SL-scope.js";
import { SL_DEFAULT_SCOPE, slNormalizeScope } from "./SL-state.js";
import type {
  SLRegistryArtifact,
  SLScopeDescriptor,
  SLScopeResolution,
} from "./SL-types.js";
import {
  slCompareOrdinal,
  slExists,
  slReadContainedText,
  slResolveInside,
} from "./SL-utils.js";
import {
  slEvaluateValidationContract,
  slFindValidationContractConflicts,
  slPromotedContractTarget,
  type SLActiveValidationContract,
} from "../SL-validation/SL-validation-contract.js";

export type SLRetrievalRelation =
  | "local"
  | "dependency"
  | "ancestor"
  | "root";

export interface SLRetrievedArtifact {
  id: string;
  path: string;
  artifactType: SLRegistryArtifact["artifactType"];
  status: SLRegistryArtifact["status"];
  scope: SLScopeDescriptor;
  precedence: number;
  relation: SLRetrievalRelation;
  provenance: string[];
  trigger?: string[];
}

export interface SLRetrievalResult {
  path: string;
  primaryScopeId: string;
  orderedScopeIds: string[];
  artifacts: SLRetrievedArtifact[];
}

function slAncestorIds(
  resolution: SLScopeResolution,
  catalog: Awaited<ReturnType<typeof slLoadScopeCatalog>>,
): Set<string> {
  const result = new Set<string>();
  let current = slFindScopeDefinition(catalog, resolution.primaryScopeId);
  while (current.parentScopeId) {
    result.add(current.parentScopeId);
    current = slFindScopeDefinition(catalog, current.parentScopeId);
  }
  return result;
}

export async function slRetrieveArtifacts(
  root: string,
  pathValue: string,
  trigger?: string,
): Promise<SLRetrievalResult> {
  const catalog = await slLoadScopeCatalog(root);
  const resolution = new SLScopeResolver(catalog).resolvePath(
    root,
    pathValue,
  );
  const registry = await slLoadRegistry(root);
  const order = new Map(
    resolution.orderedScopeIds.map((scopeId, index) => [scopeId, index]),
  );
  const ancestors = slAncestorIds(resolution, catalog);
  const rootScopeId = catalog.scopes.find(
    (scope) => scope.parentScopeId === undefined,
  )!.id;
  const selected: Array<{
    artifact: SLRegistryArtifact;
    scope: SLScopeDescriptor;
    precedence: number;
  }> = [];
  for (const artifact of registry.artifacts) {
    const scope = slNormalizeScope(artifact.scope ?? SL_DEFAULT_SCOPE);
    const precedence = order.get(scope.id);
    if (
      precedence === undefined ||
      !artifact.path ||
      artifact.classification === "system" ||
      !SL_ACTIVE_STATUSES.has(artifact.status) ||
      !(await slExists(slResolveInside(root, artifact.path)))
    ) {
      continue;
    }
    if (
      artifact.classification === "promoted" &&
      artifact.status === "active" &&
      !(await slPromotionEvaluationIsCurrent(root, artifact))
    ) {
      continue;
    }
    if (
      trigger &&
      !(artifact.trigger ?? []).some(
        (candidate) => candidate.toLowerCase() === trigger.toLowerCase(),
      )
    ) {
      continue;
    }
    selected.push({ artifact, scope, precedence });
  }

  const scopedGuidance: SLScopedGuidance[] = [];
  const governedContracts: SLActiveValidationContract[] = [];
  const legacyContracts: SLActiveValidationContract[] = [];
  for (const { artifact } of selected) {
    const artifactPath = artifact.path;
    if (!artifactPath) {
      continue;
    }
    const frontmatter = artifactPath.endsWith(".md")
      ? slParseMarkdown<Record<string, unknown>>(
          await slReadContainedText(root, artifactPath),
        ).frontmatter
      : {};
    const target = slPromotedContractTarget(artifact, frontmatter);
    if (!target) {
      continue;
    }
    const evaluation = await slEvaluateValidationContract(root, target);
    if (evaluation.status !== "passed" || !evaluation.contract) {
      continue;
    }
    const governedScope =
      artifact.promotionEvaluation?.governance?.targetScope;
    if (governedScope) {
      governedContracts.push({
        artifactId: artifact.id,
        contract: evaluation.contract,
      });
      scopedGuidance.push({
        artifactId: artifact.id,
        scope: governedScope,
        applicability: evaluation.contract.scope,
        declarations: evaluation.contract.declarations ?? [],
      });
    } else {
      legacyContracts.push({
        artifactId: artifact.id,
        contract: evaluation.contract,
      });
    }
  }
  if (
    legacyContracts.length > 1 &&
    slFindValidationContractConflicts(legacyContracts).length > 0
  ) {
    throw new Error(
      "Unresolved active guidance conflict exists at retrieval time.",
    );
  }
  const legacyGovernedConflicts = legacyContracts.flatMap((legacy) =>
    governedContracts.flatMap((governed) =>
      slFindValidationContractConflicts([legacy, governed]),
    ),
  );
  if (legacyGovernedConflicts.length > 0) {
    throw new Error(
      `Unresolved legacy/governed retrieval conflict: ${legacyGovernedConflicts
        .map((conflict) => conflict.message)
        .join("; ")}`,
    );
  }
  if (scopedGuidance.length > 1) {
    const conflicts = slEvaluateScopedGuidanceConflicts(
      (await slLoadConfig(root)).promotion,
      scopedGuidance,
    );
    const blocked = conflicts.resolutions.filter(
      (resolution) => resolution.status === "blocked",
    );
    if (blocked.length > 0) {
      throw new Error(
        `Unresolved scoped retrieval conflict: ${blocked
          .map((conflict) => conflict.message)
          .join("; ")}`,
      );
    }
  }

  const artifacts = selected
    .map(({ artifact, scope, precedence }): SLRetrievedArtifact => ({
      id: artifact.id,
      path: artifact.path!,
      artifactType: artifact.artifactType,
      status: artifact.status,
      scope,
      precedence,
      relation:
        scope.id === resolution.primaryScopeId
          ? "local"
          : scope.id === rootScopeId
            ? "root"
            : ancestors.has(scope.id)
              ? "ancestor"
              : "dependency",
      provenance: [
        ...(artifact.dependsOn ?? []),
        ...(artifact.relatedTo ?? []),
      ].filter((value, index, values) => values.indexOf(value) === index),
      ...(artifact.trigger
        ? { trigger: [...artifact.trigger].sort(slCompareOrdinal) }
        : {}),
    }))
    .sort(
      (left, right) =>
        left.precedence - right.precedence ||
        slCompareOrdinal(left.id, right.id),
    );
  return {
    path: resolution.normalizedPath,
    primaryScopeId: resolution.primaryScopeId,
    orderedScopeIds: resolution.orderedScopeIds,
    artifacts,
  };
}
