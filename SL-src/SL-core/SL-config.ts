import { parse, stringify } from "yaml";
import { SL_DEFAULT_CONFIG, SL_PATHS } from "./SL-constants.js";
import type { SLConfig, SLChange } from "./SL-types.js";
import { slExists, slReadText, slResolveInside, slWriteText } from "./SL-utils.js";

export async function slLoadConfig(root: string): Promise<SLConfig> {
  const path = slResolveInside(root, SL_PATHS.config);
  if (!(await slExists(path))) {
    return structuredClone(SL_DEFAULT_CONFIG);
  }

  const parsed = parse(await slReadText(path)) as Partial<SLConfig>;
  const config: SLConfig = {
    schemaVersion: 1,
    scope: "repo",
    retention: {
      ...SL_DEFAULT_CONFIG.retention,
      ...(parsed.retention ?? {}),
    },
    promotion: {
      ...SL_DEFAULT_CONFIG.promotion,
      ...(parsed.promotion ?? {}),
      local: {
        ...SL_DEFAULT_CONFIG.promotion.local,
        ...(parsed.promotion?.local ?? {}),
      },
      shared: {
        ...SL_DEFAULT_CONFIG.promotion.shared,
        ...(parsed.promotion?.shared ?? {}),
      },
      approvals: {
        ...SL_DEFAULT_CONFIG.promotion.approvals,
        ...(parsed.promotion?.approvals ?? {}),
      },
      conflicts: {
        ...SL_DEFAULT_CONFIG.promotion.conflicts,
        ...(parsed.promotion?.conflicts ?? {}),
      },
    },
  };
  for (const [name, value] of Object.entries(config.retention)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`Retention setting ${name} must be a positive integer.`);
    }
  }
  if (
    config.retention.quarantineAfterDays <
    config.retention.staleAfterDays
  ) {
    throw new Error(
      "retention.quarantineAfterDays must be greater than or equal to staleAfterDays.",
    );
  }
  if (
    !Number.isInteger(config.promotion.local.minimumVerifiedSuccesses) ||
    config.promotion.local.minimumVerifiedSuccesses < 1
  ) {
    throw new Error(
      "promotion.local.minimumVerifiedSuccesses must be a positive integer.",
    );
  }
  for (const [name, value] of Object.entries(config.promotion.shared)) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`promotion.shared.${name} must be a positive integer.`);
    }
  }
  if (
    config.promotion.mode !== "single-repository" &&
    config.promotion.mode !== "monorepo"
  ) {
    throw new Error(
      "promotion.mode must be single-repository or monorepo.",
    );
  }
  if (
    typeof config.promotion.policyVersion !== "string" ||
    config.promotion.policyVersion.trim().length === 0
  ) {
    throw new Error("promotion.policyVersion must be non-empty.");
  }
  return config;
}

export async function slWriteDefaultConfig(
  root: string,
  dryRun: boolean,
  changes: SLChange[],
): Promise<void> {
  await slWriteText(
    root,
    SL_PATHS.config,
    stringify(SL_DEFAULT_CONFIG, { lineWidth: 0 }),
    dryRun,
    changes,
  );
}
