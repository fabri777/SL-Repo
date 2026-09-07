import { resolve } from "node:path";
import {
  slBuildPortableDirectory,
  slPortableArchitecture,
  slPortablePlatform,
} from "./SL-portable.js";

function slArgument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const descriptor = await slBuildPortableDirectory({
    packageRoot: resolve(slArgument("--package-root")),
    outputRoot: resolve(slArgument("--output")),
    version: slArgument("--version"),
    sourceCommit: slArgument("--source-commit"),
    nodeVersion: process.version,
    platform: slPortablePlatform(process.platform),
    architecture: slPortableArchitecture(process.arch),
    nodeExecutablePath: process.execPath,
  });
  console.log(JSON.stringify(descriptor, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
