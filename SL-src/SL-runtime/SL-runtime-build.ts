import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  SL_RUNTIME_CONFIG_CONTRACT_VERSION,
  SL_RUNTIME_CONFORMANCE_VERSION,
  SL_RUNTIME_MANIFEST_FILE,
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
import { slBuildSystemArtifacts } from "../SL-distribution/SL-system-build.js";
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
  buildSystemArtifacts?: boolean;
  injectFailureAfterSchemaWrite?: boolean;
  packageRoot?: string;
}

const SL_RUNTIME_SOURCE_FRAGMENTS = [
  "SL.Runtime.Core.ps1",
  "SL.Runtime.Syntax.ps1",
  "SL.Runtime.State.ps1",
  "SL.Runtime.Artifacts.ps1",
  "SL.Runtime.Resource.ps1",
  "SL.Runtime.Promotion.ps1",
  "SL.Runtime.Lifecycle.ps1",
  "SL.Runtime.Conformance.ps1",
  "SL.Runtime.Doctor.ps1",
  "SL.Runtime.Validation.ps1",
] as const;

const SL_RUNTIME_MODULE_SOURCE_TEMPLATE = "SL.Runtime.psm1";
const SL_RUNTIME_MODULE_OUTPUT = "sl.runtime.psm1";
const SL_RUNTIME_CONFORMANCE_SOURCE = "SL-conformance-vectors.json";
const SL_RUNTIME_FRAGMENT_MARKER = "__SL_RUNTIME_FRAGMENTS__";
const SL_RUNTIME_CONFORMANCE_MARKER = "__SL_CONFORMANCE_VECTORS__";

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
  if (options.buildSystemArtifacts !== false) {
    await slBuildSystemArtifacts(packageRoot);
  }
  const runtimeRoot = resolve(
    packageRoot,
    "SL-templates",
    "SL-repository",
    ".github",
    "sl-learning",
    "sl-runtime",
  );
  const sourceRoot = resolve(packageRoot, "SL-runtime-source");
  const expectedSourcePaths = [
    SL_RUNTIME_CONFORMANCE_SOURCE,
    ...SL_RUNTIME_SOURCE_FRAGMENTS,
    SL_RUNTIME_MODULE_SOURCE_TEMPLATE,
  ].sort(slCompareOrdinal);
  const discoveredSourcePaths = (await slListFiles(sourceRoot)).sort(
    slCompareOrdinal,
  );
  if (
    JSON.stringify(discoveredSourcePaths) !==
    JSON.stringify(expectedSourcePaths)
  ) {
    throw new Error(
      `Runtime source layout differs from the build contract: ${JSON.stringify(discoveredSourcePaths)}`,
    );
  }
  const moduleTemplate = (await readFile(
    resolve(sourceRoot, SL_RUNTIME_MODULE_SOURCE_TEMPLATE),
    "utf8",
  ))
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n");
  if (
    moduleTemplate.split(SL_RUNTIME_FRAGMENT_MARKER).length !== 2 ||
    moduleTemplate.split(SL_RUNTIME_CONFORMANCE_MARKER).length !== 2
  ) {
    throw new Error("PowerShell runtime module template markers are invalid.");
  }
  const fragmentContents = await Promise.all(
    SL_RUNTIME_SOURCE_FRAGMENTS.map(async (path) => {
      const content = (await readFile(resolve(sourceRoot, path), "utf8"))
        .replaceAll("\r\n", "\n")
        .replaceAll("\r", "\n")
        .trimEnd();
      return [
        "# ////////////////////////////////////////////////////////////////////////////////",
        `# Generated from ${path}`,
        "# ////////////////////////////////////////////////////////////////////////////////",
        "",
        content,
      ].join("\n");
    }),
  );
  const conformanceVectors = JSON.stringify(
    JSON.parse(
      await readFile(
        resolve(sourceRoot, SL_RUNTIME_CONFORMANCE_SOURCE),
        "utf8",
      ),
    ),
  );
  const moduleContent = moduleTemplate
    .replace(
      SL_RUNTIME_FRAGMENT_MARKER,
      () => fragmentContents.join("\n\n"),
    )
    .replace(SL_RUNTIME_CONFORMANCE_MARKER, () => conformanceVectors);
  const moduleTarget = resolve(runtimeRoot, SL_RUNTIME_MODULE_OUTPUT);
  const manifestPath = resolve(runtimeRoot, SL_RUNTIME_MANIFEST_FILE);
  const discoveredPaths = [
    ...new Set([
      ...(await slListFiles(runtimeRoot)).filter(
        (path) =>
          path !== SL_RUNTIME_MANIFEST_FILE &&
          path !== SL_RUNTIME_MODULE_OUTPUT,
      ),
      SL_RUNTIME_MODULE_OUTPUT,
    ]),
  ].sort(slCompareOrdinal);
  const paths = [...SL_RUNTIME_PAYLOAD_FILES].sort(slCompareOrdinal);
  if (JSON.stringify(discoveredPaths) !== JSON.stringify(paths)) {
    throw new Error(
      `Runtime template layout differs from SL_RUNTIME_PAYLOAD_FILES: ${JSON.stringify(discoveredPaths)}`,
    );
  }
  const rootModule = moduleContent;
  const bootstrap = await readFile(resolve(runtimeRoot, "sl.ps1"), "utf8");
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
      path === SL_RUNTIME_MODULE_OUTPUT
        ? moduleContent
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
  const snapshots = await Promise.all([
    slSnapshotRuntimeFile(moduleTarget),
    slSnapshotRuntimeFile(manifestPath),
  ]);
  try {
    await slWriteIfChanged(moduleTarget, moduleContent);
    if (options.injectFailureAfterSchemaWrite) {
      throw new Error(
        "Injected runtime build failure after generated module write.",
      );
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
