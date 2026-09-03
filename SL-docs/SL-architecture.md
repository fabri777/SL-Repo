# SL Repo architecture

SL Repo separates reasoning from deterministic enforcement.

| Layer | Responsibility |
|---|---|
| Copilot skills | Decide whether a verified experience is worth capturing and how to express it |
| CLI | Install, validate, index, register, quarantine, restore, and delete deterministically |
| Repository files | Preserve evidence and promoted knowledge in Git |
| GitHub Actions | Re-run deterministic checks and scheduled retention |

The registry is the authority for ownership and mutable lifecycle state. The
Markdown artifact preserves human-readable evidence. The generated index is a
discovery projection and contains paths and metadata rather than full content.

SL Repo defines future `org` and `company` scopes in documentation only. It
does not copy local lessons to a central service.
