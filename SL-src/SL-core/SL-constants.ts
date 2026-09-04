import type { SLConfig } from "./SL-types.js";

export const SL_MANAGED_BLOCK_START = "<!-- SL-REPO:START -->";
export const SL_MANAGED_BLOCK_END = "<!-- SL-REPO:END -->";

export const SL_PATHS = {
  learningRoot: ".github/SL-learning",
  config: ".github/SL-learning/SL-config.yml",
  scopeCatalog: ".github/SL-learning/SL-scope-catalog.yml",
  scopeCatalogCandidates: [
    ".github/SL-learning/SL-scope-catalog.yml",
    ".github/SL-learning/SL-scope-catalog.yaml",
    ".github/SL-learning/SL-scope-catalog.json",
  ],
  registry: ".github/SL-learning/SL-registry.json",
  index: ".github/SL-learning/SL-index.json",
  legacyEvents: ".github/SL-learning/SL-events.jsonl",
  lifecycleEvents: ".github/SL-learning/SL-lifecycle-events",
  usageEvents: ".github/SL-learning/SL-usage-events",
  lessons: ".github/SL-learning/SL-lessons",
  probation: ".github/SL-learning/SL-probation",
  quarantine: ".github/SL-learning/SL-quarantine",
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
