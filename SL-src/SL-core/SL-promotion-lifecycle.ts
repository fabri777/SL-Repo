import type { SLRegistryArtifact } from "./SL-types.js";
import { slLoadConfig } from "./SL-config.js";
import { slParseMarkdown } from "./SL-frontmatter.js";
import {
  slEvaluatePromotionGovernance,
  slPromotionPolicyHash,
} from "./SL-promotion-governance.js";
import { slBuildPromotionGovernanceContext } from "./SL-promotion-context.js";
import {
  slArtifactContentHash,
  slArtifactUsageContentHash,
  slArtifactVersion,
} from "./SL-usage.js";
import {
  slExists,
  slReadContainedText,
  slResolveInside,
} from "./SL-utils.js";

export function slPromotionArtifactContentHash(content: string): string {
  return slArtifactUsageContentHash(content);
}

export function slPromotionArtifactVersion(contentHash: string): string {
  return slArtifactVersion(contentHash);
}

export function slIsActivePromotionStatus(status: string): boolean {
  return status === "active" || status === "promoted";
}

export async function slPromotionEvaluationIsCurrent(
  root: string,
  artifact: SLRegistryArtifact,
): Promise<boolean> {
  try {
    const evaluation = artifact.promotionEvaluation;
    if (!evaluation || evaluation.status !== "passed" || !artifact.path) {
      return false;
    }
    if (evaluation.governance) {
      const config = await slLoadConfig(root);
      if (
        config.promotion.policyVersion !==
          evaluation.governance.policyVersion ||
        slPromotionPolicyHash(config.promotion) !==
          evaluation.governance.policyHash
      ) {
        return false;
      }
      try {
        const context = await slBuildPromotionGovernanceContext(
          root,
          artifact.id,
          {
            targetScopeId: evaluation.governance.targetScope.id,
            ownerApprovalRefs: evaluation.governance.ownerApprovals.map(
              (approval) => approval.evidenceRef,
            ),
          },
        );
        const current = slEvaluatePromotionGovernance({
          policy: config.promotion,
          ...context,
        }).record;
        if (
          current.status !== "passed" ||
          JSON.stringify(current.targetScope) !==
            JSON.stringify(evaluation.governance.targetScope) ||
          JSON.stringify(current.sourceScopes) !==
            JSON.stringify(evaluation.governance.sourceScopes) ||
          JSON.stringify(current.evidenceSummary) !==
            JSON.stringify(evaluation.governance.evidenceSummary) ||
          JSON.stringify(current.ownerApprovals) !==
            JSON.stringify(evaluation.governance.ownerApprovals)
        ) {
          return false;
        }
      } catch {
        if (evaluation.governance.targetScope.id.startsWith("SL-SCOPE-")) {
          return false;
        }
      }
    }
    const artifactPath = slResolveInside(root, artifact.path);
    if (!(await slExists(artifactPath))) {
      return false;
    }
    const content = await slReadContainedText(root, artifact.path);
    const artifactContentHash = slPromotionArtifactContentHash(content);
    if (
      artifactContentHash !== evaluation.artifactContentHash ||
      slPromotionArtifactVersion(artifactContentHash) !==
        evaluation.artifactVersion
    ) {
      return false;
    }
    const contractPath = slParseMarkdown<Record<string, unknown>>(
      content,
    ).frontmatter.validationContract;
    if (typeof contractPath !== "string") {
      return evaluation.contractContentHash === null;
    }
    const absoluteContractPath = slResolveInside(root, contractPath);
    if (!(await slExists(absoluteContractPath))) {
      return false;
    }
    return (
      slArtifactContentHash(
        await slReadContainedText(root, contractPath),
      ) ===
      evaluation.contractContentHash
    );
  } catch {
    return false;
  }
}
