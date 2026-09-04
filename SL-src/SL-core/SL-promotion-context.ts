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
  slScopeDescriptor,
  slPromotionScopeRef,
} from "./SL-scope.js";
import {
  SL_DEFAULT_SCOPE,
  slNormalizeScope,
  slScopeKey,
} from "./SL-state.js";
import type {
  SLPromotionScopeRef,
  SLRegistryArtifact,
  SLScopeCatalog,
} from "./SL-types.js";
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

export function slResolveArtifactPromotionTargetScope(
  catalog: SLScopeCatalog,
  artifact: SLRegistryArtifact,
  requestedTargetScopeId: string,
): SLPromotionScopeRef {
  const artifactScope = slNormalizeScope(
    artifact.scope ?? SL_DEFAULT_SCOPE,
  );
  if (requestedTargetScopeId !== artifactScope.id) {
    throw new Error(
      `Promotion target scope ${requestedTargetScopeId} does not match persisted artifact scope ${artifactScope.id}.`,
    );
  }
  const targetDefinition = slFindScopeDefinition(
    catalog,
    requestedTargetScopeId,
  );
  const catalogScope = slScopeDescriptor(targetDefinition);
  if (slScopeKey(artifactScope) !== slScopeKey(catalogScope)) {
    throw new Error(
      `Persisted artifact scope ${artifactScope.id} does not match its governance catalog scope.`,
    );
  }
  return slPromotionScopeRef(catalog, requestedTargetScopeId);
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
  const targetScope = slResolveArtifactPromotionTargetScope(
    catalog,
    artifact,
    targetScopeId,
  );
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
