import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";

export type SLPortablePlatform = "windows" | "linux" | "darwin";
export type SLPortableArchitecture = "x64" | "arm64";

export interface SLPortableAssetDescriptor {
  schemaVersion: 1;
  version: string;
  sourceCommit: string;
  nodeVersion: string;
  platform: SLPortablePlatform;
  architecture: SLPortableArchitecture;
  fileName: string;
  rootDirectory: string;
}

export interface SLPortableReleaseAsset extends SLPortableAssetDescriptor {
  sha256: string;
  size: number;
}

export interface SLPortableReleaseManifest {
  schemaVersion: 1;
  version: string;
  sourceCommit: string;
  nodeVersion: string;
  assets: SLPortableReleaseAsset[];
}

export interface SLBuildPortableOptions {
  packageRoot: string;
  outputRoot: string;
  version: string;
  sourceCommit: string;
  nodeVersion: string;
  platform: SLPortablePlatform;
  architecture: SLPortableArchitecture;
  nodeExecutablePath: string;
}

const SL_PORTABLE_PACKAGE_PATHS = [
  "package.json",
  "dist",
  "SL-schemas",
  "SL-templates",
  "SL-plugin",
  "SL-docs",
  "CHANGELOG.md",
  "README.md",
  "SECURITY.md",
] as const;

interface SLPackageLock {
  packages?: Record<string, { dev?: boolean }>;
}

function slAssertReleaseValue(
  label: string,
  value: string,
  pattern: RegExp,
): void {
  if (!pattern.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

export function slPortablePlatform(
  platform: NodeJS.Platform,
): SLPortablePlatform {
  switch (platform) {
    case "win32":
      return "windows";
    case "linux":
      return "linux";
    case "darwin":
      return "darwin";
    default:
      throw new Error(`Unsupported portable platform: ${platform}`);
  }
}

export function slPortableArchitecture(
  architecture: string,
): SLPortableArchitecture {
  if (architecture === "x64" || architecture === "arm64") {
    return architecture;
  }
  throw new Error(`Unsupported portable architecture: ${architecture}`);
}

export function slPortableRootDirectory(
  version: string,
  platform: SLPortablePlatform,
  architecture: SLPortableArchitecture,
): string {
  return `sl-repo-${version}-${platform}-${architecture}`;
}

export function slPortableArchiveName(
  version: string,
  platform: SLPortablePlatform,
  architecture: SLPortableArchitecture,
): string {
  return `${slPortableRootDirectory(version, platform, architecture)}.tar.gz`;
}

export function slPortableRuntimePath(
  platform: SLPortablePlatform,
): string {
  return platform === "windows"
    ? "runtime/node.exe"
    : "runtime/bin/node";
}

function slPortableLauncher(
  platform: SLPortablePlatform,
): { path: string; content: string } {
  if (platform === "windows") {
    return {
      path: "bin/sl-repo.cmd",
      content: [
        "@echo off",
        "setlocal",
        '"%~dp0..\\runtime\\node.exe" "%~dp0..\\dist\\SL-src\\SL-cli\\SL-cli.js" %*',
        "",
      ].join("\n"),
    };
  }
  return {
    path: "bin/sl-repo",
    content: [
      "#!/bin/sh",
      "set -eu",
      'SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
      'exec "$SCRIPT_DIR/../runtime/bin/node" "$SCRIPT_DIR/../dist/SL-src/SL-cli/SL-cli.js" "$@"',
      "",
    ].join("\n"),
  };
}

export async function slBuildPortableDirectory(
  options: SLBuildPortableOptions,
): Promise<SLPortableAssetDescriptor> {
  slAssertReleaseValue(
    "release version",
    options.version,
    /^[0-9A-Za-z][0-9A-Za-z._-]*$/,
  );
  slAssertReleaseValue(
    "source commit",
    options.sourceCommit,
    /^[0-9a-f]{40}$/i,
  );
  slAssertReleaseValue(
    "Node.js version",
    options.nodeVersion,
    /^v[0-9]+\.[0-9]+\.[0-9]+$/,
  );

  const rootDirectory = slPortableRootDirectory(
    options.version,
    options.platform,
    options.architecture,
  );
  const destinationRoot = resolve(options.outputRoot, rootDirectory);
  await rm(destinationRoot, { recursive: true, force: true });
  await mkdir(destinationRoot, { recursive: true });

  for (const packagePath of SL_PORTABLE_PACKAGE_PATHS) {
    const source = resolve(options.packageRoot, packagePath);
    await cp(source, resolve(destinationRoot, packagePath), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  }

  const packageLock = JSON.parse(
    await readFile(resolve(options.packageRoot, "package-lock.json"), "utf8"),
  ) as SLPackageLock;
  const productionPackagePaths = Object.entries(packageLock.packages ?? {})
    .filter(
      ([packagePath, metadata]) =>
        packagePath.startsWith("node_modules/") && metadata.dev !== true,
    )
    .map(([packagePath]) => packagePath)
    .sort();
  for (const packagePath of productionPackagePaths) {
    const source = resolve(options.packageRoot, packagePath);
    const destination = resolve(destinationRoot, packagePath);
    try {
      await stat(source);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
    await cp(source, destination, {
      recursive: true,
      force: true,
      errorOnExist: false,
    });
  }

  const runtimePath = slPortableRuntimePath(options.platform);
  const runtimeTarget = resolve(destinationRoot, runtimePath);
  await mkdir(resolve(runtimeTarget, ".."), { recursive: true });
  await cp(options.nodeExecutablePath, runtimeTarget, {
    force: false,
    errorOnExist: true,
  });

  const launcher = slPortableLauncher(options.platform);
  const launcherPath = resolve(destinationRoot, launcher.path);
  await mkdir(resolve(launcherPath, ".."), { recursive: true });
  await writeFile(launcherPath, launcher.content, "utf8");
  if (options.platform !== "windows") {
    await chmod(runtimeTarget, 0o755);
    await chmod(launcherPath, 0o755);
  }

  const descriptor: SLPortableAssetDescriptor = {
    schemaVersion: 1,
    version: options.version,
    sourceCommit: options.sourceCommit.toLowerCase(),
    nodeVersion: options.nodeVersion,
    platform: options.platform,
    architecture: options.architecture,
    fileName: slPortableArchiveName(
      options.version,
      options.platform,
      options.architecture,
    ),
    rootDirectory,
  };
  await writeFile(
    resolve(destinationRoot, "SL-release.json"),
    `${JSON.stringify(descriptor, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    resolve(options.outputRoot, `${rootDirectory}.asset.json`),
    `${JSON.stringify(descriptor, null, 2)}\n`,
    "utf8",
  );
  return descriptor;
}

async function slFileSha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function slAssertSameRelease(
  descriptors: SLPortableAssetDescriptor[],
  key: "version" | "sourceCommit" | "nodeVersion",
): string {
  const values = new Set(descriptors.map((descriptor) => descriptor[key]));
  if (values.size !== 1) {
    throw new Error(`Portable asset descriptors disagree on ${key}.`);
  }
  return descriptors[0]![key];
}

export async function slCreatePortableReleaseManifest(
  assetDirectory: string,
): Promise<SLPortableReleaseManifest> {
  const descriptorNames = (await readdir(assetDirectory))
    .filter((name) => name.endsWith(".asset.json"))
    .sort();
  if (descriptorNames.length === 0) {
    throw new Error("No portable asset descriptors were found.");
  }

  const descriptors = await Promise.all(
    descriptorNames.map(async (name) =>
      JSON.parse(
        await readFile(resolve(assetDirectory, name), "utf8"),
      ) as SLPortableAssetDescriptor,
    ),
  );
  const version = slAssertSameRelease(descriptors, "version");
  const sourceCommit = slAssertSameRelease(descriptors, "sourceCommit");
  const nodeVersion = slAssertSameRelease(descriptors, "nodeVersion");
  const assets: SLPortableReleaseAsset[] = [];

  for (const descriptor of descriptors) {
    if (
      descriptor.schemaVersion !== 1 ||
      basename(descriptor.fileName) !== descriptor.fileName
    ) {
      throw new Error(
        `Invalid portable asset descriptor for ${descriptor.fileName}.`,
      );
    }
    const archivePath = resolve(assetDirectory, descriptor.fileName);
    const archiveInfo = await stat(archivePath);
    if (!archiveInfo.isFile()) {
      throw new Error(`Portable archive is not a file: ${descriptor.fileName}`);
    }
    assets.push({
      ...descriptor,
      sha256: await slFileSha256(archivePath),
      size: archiveInfo.size,
    });
  }

  assets.sort((left, right) => {
    const platformOrder =
      left.platform === right.platform
        ? 0
        : left.platform < right.platform
          ? -1
          : 1;
    return platformOrder !== 0
      ? platformOrder
      : left.architecture === right.architecture
        ? 0
        : left.architecture < right.architecture
          ? -1
          : 1;
  });
  return {
    schemaVersion: 1,
    version,
    sourceCommit,
    nodeVersion,
    assets,
  };
}

export async function slWritePortableReleaseManifest(
  assetDirectory: string,
  outputPath = join(assetDirectory, "SL-release-manifest.json"),
): Promise<SLPortableReleaseManifest> {
  const manifest = await slCreatePortableReleaseManifest(assetDirectory);
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(
    join(assetDirectory, "SL-checksums.txt"),
    `${manifest.assets
      .map((asset) => `${asset.sha256}  ${asset.fileName}`)
      .join("\n")}\n`,
    "utf8",
  );
  return manifest;
}
