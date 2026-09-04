# SL roadmap

## SL Repo

Repository-local capture, reuse, promotion, validation, installation, and
forgetting.

Implemented lifecycle capabilities include immutable usage and lifecycle
events, version-specific projections, legacy counter migration, governed
probation and activation, validation contracts, bounded executable checks,
deterministic projection repair, and retention integration.

Current limitations:

- Instruction usage requires an applying agent or host to emit a receipt.
- Outcome association is not proof of causal improvement.
- Obvious declaration conflicts are detected; semantic contradictions still
  require repository review.
- The optional GitHub Actions adapter requires `SL_REPO_TOKEN` when it reads
  the current private GitHub source. The Azure Pipelines adapter instead uses
  normal repository-resource authorization. Local operation requires neither
  adapter.

## SL Org

Future work:

- Submit cross-repository promotion candidates.
- Review and publish versioned team or organization packs.
- Enforce repository access boundaries.
- Distribute approved capabilities through a private marketplace.

## SL Company

Future work:

- Federated catalogs across organizations.
- Company policy precedence.
- Permission-aware retrieval.
- Data residency, compliance, and retention governance.

SL Org and SL Company are explicitly outside the current implementation.
