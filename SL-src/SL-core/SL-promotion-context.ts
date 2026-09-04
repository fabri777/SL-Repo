import {
  slCreatePromotionGovernanceContext,
  type SLPromotionGovernanceContext,
} from "./SL-promotion-governance.js";
import {
  slFindArtifact,
  slLoadRegistry,
} from "./SL-registry.js";
import {
  slFindScopeDefinition,
  slLoadScopeCatalog,
  slPromotionScopeRef,
} from "./SL-scope.js";
import { SL_DEFAULT_SCOPE, slNormalizeScope } from "./SL-state.js";
import {
  slArtifactUsageContentHash,
  slArtifactVersion,
  slLoadUsageEvents,
} from "./SL-usage.js";
import { slReadContainedText } from "./SL-utils.js";

export interface SLBuildPromotionGovernanceContextOptions {
  targetScopeId?: string;
  ownerApprovalRefs?: string[];
}

export async function slBuildPromotionGovernanceContext(
  root: string,
  artifactId: string,
  options: SLBuildPromotionGovernanceContextOptions = {},
): Promise<SLPromotionGovernanceContext> {
  const catalog = await slLoadScopeCatalog(root);
  const registry = await slLoadRegistry(root);
  const artifact = slFindArtifact(registry, artifactId);
  const sourceIds = artifact.dependsOn ?? [];
  if (sourceIds.length === 0) {
    throw new Error(
      `Promotion ${artifactId} does not declare source evidence.`,
    );
  }
  const artifactScope = slNormalizeScope(
    artifact.scope ?? SL_DEFAULT_SCOPE,
  );
  const targetScopeId = options.targetScopeId ?? artifactScope.id;
  slFindScopeDefinition(catalog, targetScopeId);
  const targetScope = slPromotionScopeRef(catalog, targetScopeId);
  const sourceScopes = await Promise.all(
    sourceIds.map(async (sourceId) => {
      const source = slFindArtifact(registry, sourceId);
      if (!source.path) {
        throw new Error(`Promotion source ${sourceId} has no content path.`);
      }
      const sourceScope = slNormalizeScope(
        source.scope ?? SL_DEFAULT_SCOPE,
      );
      slFindScopeDefinition(catalog, sourceScope.id);
      const contentHash = slArtifactUsageContentHash(
        await slReadContainedText(root, source.path),
      );
      return {
        artifactId: sourceId,
        artifactVersion: slArtifactVersion(contentHash),
        scope: slPromotionScopeRef(catalog, sourceScope.id),
      };
    }),
  );
  const sourceVersions = new Map(
    sourceScopes.map((source) => [
      source.artifactId,
      source.artifactVersion,
    ]),
  );
  const evidence = (await slLoadUsageEvents(root))
    .filter(
      (event) =>
        event.eventType === "usage" &&
        event.stage === "verified" &&
        (event.outcome === "success" || event.outcome === "failure") &&
        sourceVersions.get(event.artifactId) === event.artifactVersion,
    )
    .map((event) => {
      const scope = slNormalizeScope(event.scope ?? SL_DEFAULT_SCOPE);
      slFindScopeDefinition(catalog, scope.id);
      return {
        sourceArtifactId: event.artifactId,
        artifactVersion: event.artifactVersion,
        applicationScope: slPromotionScopeRef(catalog, scope.id),
        outcome:
          event.outcome === "success"
            ? "verified-success" as const
            : "verified-failure" as const,
        evidenceRef: event.evidenceRef ?? `event:${event.eventId}`,
      };
    });
  const approvals = (options.ownerApprovalRefs ?? []).map((evidenceRef) => ({
    kind: "owner-set-approval" as const,
    scopeId: targetScope.id,
    ownerSetId: targetScope.ownerSetId,
    evidenceRef,
  }));
  return slCreatePromotionGovernanceContext({
    artifactId,
    sourceScopes,
    targetScope,
    evidence,
    approvals,
  });
}
