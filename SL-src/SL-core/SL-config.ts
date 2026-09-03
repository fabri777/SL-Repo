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
