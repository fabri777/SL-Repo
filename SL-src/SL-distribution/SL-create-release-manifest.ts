import { resolve } from "node:path";
import { slWritePortableReleaseManifest } from "./SL-portable.js";

function slArgument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const assetDirectory = resolve(slArgument("--assets"));
  const outputPath = resolve(
    process.argv.includes("--output")
      ? slArgument("--output")
      : `${assetDirectory}/sl-release-manifest.json`,
  );
  const manifest = await slWritePortableReleaseManifest(
    assetDirectory,
    outputPath,
  );
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
