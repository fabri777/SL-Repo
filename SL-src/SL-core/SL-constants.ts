import type { SLConfig } from "./SL-types.js";

export const SL_MANAGED_BLOCK_START = "<!-- sl:start -->";
export const SL_MANAGED_BLOCK_END = "<!-- sl:end -->";

export const SL_RUNTIME_VERSION = "0.6.0";
export const SL_RUNTIME_SCHEMA_VERSION = 1;
export const SL_RUNTIME_CONFIG_CONTRACT_VERSION = 1;
export const SL_RUNTIME_CONFORMANCE_VERSION = 1;
export const SL_RUNTIME_SOURCE_RELEASE_COMMIT =
  "e841414d13bfdcd1c534eb7e101f7f2330dc4709";
export const SL_RUNTIME_MINIMUM_POWERSHELL_VERSION = "7.0.0";
export const SL_RUNTIME_MANIFEST_FILE = "sl-runtime.manifest.json";
export const SL_RUNTIME_MANIFEST_SCHEMA_FILE =
  "sl-runtime-manifest.schema.json";
export const SL_RUNTIME_BASH_LAUNCHER = "sl.sh";
export const SL_RUNTIME_PAYLOAD_FILES = [
  "sl.ps1",
  "sl.runtime.psm1",
  "sl.sh",
] as const;

export const SL_PATHS = {
  learningRoot: ".github/sl-learning",
  runtimeRoot: ".github/sl-learning/sl-runtime",
  runtimeManifest:
    ".github/sl-learning/sl-runtime/sl-runtime.manifest.json",
  runtimePowerShellLauncher: ".github/sl-learning/sl-runtime/sl.ps1",
  runtimeBashLauncher: ".github/sl-learning/sl-runtime/sl.sh",
  config: ".github/sl-learning/sl-config.yml",
  scopeCatalog: ".github/sl-learning/sl-scope-catalog.yml",
  scopeCatalogCandidates: [
    ".github/sl-learning/sl-scope-catalog.yml",
    ".github/sl-learning/sl-scope-catalog.yaml",
    ".github/sl-learning/sl-scope-catalog.json",
  ],
  stateCatalog: ".github/sl-learning/sl-state-catalog.json",
  scopeRoot: ".github/sl-learning/sl-scopes",
  lifecycleEvents: ".github/sl-learning/sl-lifecycle-events",
  lessons: ".github/sl-learning/sl-lessons",
  probation: ".github/sl-learning/sl-probation",
  quarantine: ".github/sl-learning/sl-quarantine",
  agentInstructions: "AGENTS.md",
  copilotInstructions: ".github/copilot-instructions.md",
} as const;

export const SL_DEFAULT_SCOPE_ID = "SL-SCOPE-ROOT";

export const SL_DEFAULT_CONFIG: SLConfig = {
  schemaVersion: 1,
  scope: "repo",
  retention: {
    staleAfterDays: 90,
    quarantineAfterDays: 180,
    deleteAfterQuarantineDays: 30,
    wrongDeleteAfterDays: 7,
    promotedStaleAfterDays: 365,
    promotedQuarantineAfterDays: 30,
  },
  promotion: {
    mode: "single-repository",
    policyVersion: "1",
    local: {
      minimumVerifiedSuccesses: 1,
    },
    shared: {
      minimumDistinctNonRootScopes: 2,
      minimumVerifiedSuccessesPerScope: 1,
    },
    approvals: {
      requireTargetOwnerApproval: true,
    },
    conflicts: {
      allowNarrowerExplicitOverrides: true,
      blockUndeclaredConflicts: true,
    },
  },
};

export const SL_ACTIVE_STATUSES = new Set([
  "active",
  "raw",
  "distilled",
  "promotion-candidate",
  "promoted",
]);

export const SL_REFERENCE_PROTECTING_STATUSES = new Set([
  ...SL_ACTIVE_STATUSES,
  "probation",
]);

export const SL_SECRET_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i },
  { code: "github-token", pattern: /\bgh[oprsu]_[A-Za-z0-9_]{20,}\b/ },
  { code: "generic-secret", pattern: /\b(?:password|api[_-]?key|token)\s*[:=]\s*["']?[^\s"']{12,}/i },
  { code: "connection-string", pattern: /\b(?:AccountKey|SharedAccessKey|Password)=[^;\s]{8,}/i },
];

export const SL_USER_PATH_PATTERN =
  /(?:[A-Za-z]:\\Users\\[^\\\r\n]+|\/Users\/[^/\r\n]+|\/home\/[^/\r\n]+)/;
