import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  SL_RUNTIME_CONFIG_CONTRACT_VERSION,
  SL_RUNTIME_CONFORMANCE_VERSION,
  SL_RUNTIME_MANIFEST_FILE,
  SL_RUNTIME_MANIFEST_SCHEMA_FILE,
  SL_RUNTIME_MINIMUM_POWERSHELL_VERSION,
  SL_RUNTIME_PAYLOAD_FILES,
  SL_RUNTIME_SCHEMA_VERSION,
  SL_RUNTIME_SOURCE_RELEASE_COMMIT,
  SL_RUNTIME_VERSION,
} from "../SL-core/SL-constants.js";
import { slFindPackageRoot } from "../SL-core/SL-package.js";
import type {
  SLRuntimeManifest,
  SLRuntimeManifestFile,
} from "../SL-core/SL-types.js";
import { slCompareOrdinal, slNormalizePath } from "../SL-core/SL-utils.js";
import { slValidateRuntimeManifest } from "./SL-runtime-contract.js";

async function slListFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await slListFiles(root, path)));
    } else if (entry.isFile()) {
      files.push(slNormalizePath(path.slice(root.length + 1)));
    }
  }
  return files;
}

function slNormalizeRuntimeBytes(value: string): Buffer {
  return Buffer.from(
    value.replaceAll("\r\n", "\n").replaceAll("\r", "\n"),
    "utf8",
  );
}

async function slWriteIfChanged(path: string, content: string): Promise<void> {
  let existing: string | undefined;
  try {
    existing = await readFile(path, "utf8");
  } catch {
    existing = undefined;
  }
  if (existing === content) {
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

interface SLRuntimeBuildOptions {
  injectFailureAfterSchemaWrite?: boolean;
  packageRoot?: string;
}

interface SLRuntimeFileSnapshot {
  path: string;
  content?: Buffer;
}

async function slSnapshotRuntimeFile(
  path: string,
): Promise<SLRuntimeFileSnapshot> {
  try {
    return { path, content: await readFile(path) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { path };
    }
    throw error;
  }
}

async function slRestoreRuntimeFiles(
  snapshots: SLRuntimeFileSnapshot[],
): Promise<void> {
  for (const snapshot of [...snapshots].reverse()) {
    if (snapshot.content === undefined) {
      await rm(snapshot.path, { force: true });
    } else {
      await mkdir(dirname(snapshot.path), { recursive: true });
      await writeFile(snapshot.path, snapshot.content);
    }
  }
}

export async function slBuildRuntimeManifest(
  options: SLRuntimeBuildOptions = {},
): Promise<SLRuntimeManifest> {
  const packageRoot =
    options.packageRoot ?? (await slFindPackageRoot(import.meta.url));
  const runtimeRoot = resolve(
    packageRoot,
    "SL-templates",
    "SL-repository",
    ".github",
    "SL-learning",
    "SL-runtime",
  );
  const schemaSource = resolve(
    packageRoot,
    "SL-schemas",
    "SL-runtime-manifest.schema.json",
  );
  const schemaTarget = resolve(runtimeRoot, SL_RUNTIME_MANIFEST_SCHEMA_FILE);
  const schemaContent = (await readFile(schemaSource, "utf8"))
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n");

  const discoveredPaths = [
    ...new Set([
      ...(await slListFiles(runtimeRoot)).filter(
        (path) =>
          path !== SL_RUNTIME_MANIFEST_FILE &&
          path !== SL_RUNTIME_MANIFEST_SCHEMA_FILE,
      ),
      SL_RUNTIME_MANIFEST_SCHEMA_FILE,
    ]),
  ].sort(slCompareOrdinal);
  const paths = [...SL_RUNTIME_PAYLOAD_FILES];
  if (JSON.stringify(discoveredPaths) !== JSON.stringify(paths)) {
    throw new Error(
      `Runtime template layout differs from SL_RUNTIME_PAYLOAD_FILES: ${JSON.stringify(discoveredPaths)}`,
    );
  }
  const rootModule = await readFile(
    resolve(runtimeRoot, "SL.Runtime.psm1"),
    "utf8",
  );
  const bootstrap = await readFile(resolve(runtimeRoot, "SL.ps1"), "utf8");
  for (const expected of [
    `$script:SLRuntimeVersion = '${SL_RUNTIME_VERSION}'`,
    `runtimeVersion = $script:SLRuntimeVersion`,
    `schemaVersion = ${SL_RUNTIME_SCHEMA_VERSION}`,
    `configContractVersion = ${SL_RUNTIME_CONFIG_CONTRACT_VERSION}`,
    `conformanceVersion = ${SL_RUNTIME_CONFORMANCE_VERSION}`,
    `minimumPowerShellVersion = '${SL_RUNTIME_MINIMUM_POWERSHELL_VERSION}'`,
  ]) {
    if (!rootModule.includes(expected)) {
      throw new Error(`PowerShell runtime constant drift: ${expected}`);
    }
  }
  if (
    !bootstrap.includes(
      `$ExpectedRuntimeVersion = '${SL_RUNTIME_VERSION}'`,
    )
  ) {
    throw new Error("PowerShell bootstrap runtime version drift.");
  }
  for (const path of paths) {
    if (
      !bootstrap.includes(`'${path}'`) ||
      !rootModule.includes(`'${path}'`)
    ) {
      throw new Error(
        `PowerShell bootstrap payload inventory drift: ${path}`,
      );
    }
  }
  const files: SLRuntimeManifestFile[] = [];
  for (const path of paths) {
    const content =
      path === SL_RUNTIME_MANIFEST_SCHEMA_FILE
        ? schemaContent
        : await readFile(resolve(runtimeRoot, path), "utf8");
    files.push({
      path,
      sha256: createHash("sha256")
        .update(slNormalizeRuntimeBytes(content))
        .digest("hex"),
    });
  }
  const manifest: SLRuntimeManifest = {
    schemaVersion: SL_RUNTIME_SCHEMA_VERSION,
    runtimeVersion: SL_RUNTIME_VERSION,
    sourceReleaseCommit: SL_RUNTIME_SOURCE_RELEASE_COMMIT,
    configContractVersion: SL_RUNTIME_CONFIG_CONTRACT_VERSION,
    conformanceVersion: SL_RUNTIME_CONFORMANCE_VERSION,
    minimumPowerShellVersion: SL_RUNTIME_MINIMUM_POWERSHELL_VERSION,
    files,
  };
  slValidateRuntimeManifest(manifest);
  const manifestPath = resolve(runtimeRoot, SL_RUNTIME_MANIFEST_FILE);
  const snapshots = await Promise.all([
    slSnapshotRuntimeFile(schemaTarget),
    slSnapshotRuntimeFile(manifestPath),
  ]);
  try {
    await slWriteIfChanged(schemaTarget, schemaContent);
    if (options.injectFailureAfterSchemaWrite) {
      throw new Error("Injected runtime build failure after schema write.");
    }
    await slWriteIfChanged(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  } catch (error) {
    await slRestoreRuntimeFiles(snapshots);
    throw error;
  }
  return manifest;
}

if (process.argv[1]) {
  if (pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    const manifest = await slBuildRuntimeManifest();
    console.log(
      `Staged PowerShell runtime manifest ${manifest.runtimeVersion} (${manifest.files.length} files).`,
    );
  }
}
