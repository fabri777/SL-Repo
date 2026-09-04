import type { SLRegistryArtifact } from "./SL-types.js";
import { slLoadConfig } from "./SL-config.js";
import { slParseMarkdown } from "./SL-frontmatter.js";
import { slPromotionPolicyHash } from "./SL-promotion-governance.js";
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
