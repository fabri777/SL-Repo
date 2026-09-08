import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  slBuildPortableDirectory,
  slCreatePortableReleaseManifest,
  slPortableArchitecture,
  slPortableArchiveName,
  slPortablePlatform,
} from "../../SL-src/SL-distribution/SL-portable.js";

const temporaryRoots: string[] = [];
const SOURCE_COMMIT = "0123456789abcdef0123456789abcdef01234567";

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

async function createPackageFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "SL-portable-package-"));
  temporaryRoots.push(root);
  for (const directory of [
    "dist/SL-src/SL-cli",
    "SL-schemas",
    "SL-templates",
    "SL-plugin",
    "SL-docs",
  ]) {
    await mkdir(join(root, directory), { recursive: true });
  }
  await Promise.all([
    writeFile(join(root, "package.json"), '{"name":"fixture"}\n', "utf8"),
    writeFile(
      join(root, "package-lock.json"),
      '{"lockfileVersion":3,"packages":{"":{}}}\n',
      "utf8",
    ),
    writeFile(
      join(root, "dist", "SL-src", "SL-cli", "SL-cli.js"),
      "console.log('fixture');\n",
      "utf8",
    ),
    writeFile(join(root, "CHANGELOG.md"), "# Changes\n", "utf8"),
    writeFile(join(root, "README.md"), "# Fixture\n", "utf8"),
    writeFile(join(root, "SECURITY.md"), "# Security\n", "utf8"),
  ]);
  return root;
}

describe("SL portable distribution", () => {
  test("maps supported host platforms and architectures", () => {
    expect(slPortablePlatform("win32")).toBe("windows");
    expect(slPortablePlatform("linux")).toBe("linux");
    expect(slPortablePlatform("darwin")).toBe("darwin");
    expect(slPortableArchitecture("x64")).toBe("x64");
    expect(slPortableArchitecture("arm64")).toBe("arm64");
    expect(() => slPortablePlatform("aix")).toThrow(
      "Unsupported portable platform: aix",
    );
    expect(() => slPortableArchitecture("ia32")).toThrow(
      "Unsupported portable architecture: ia32",
    );
  });

  test("builds a self-contained platform directory and release descriptor", async () => {
    const packageRoot = await createPackageFixture();
    const outputRoot = await mkdtemp(join(tmpdir(), "SL-portable-output-"));
    temporaryRoots.push(outputRoot);
    const nodeExecutable = join(packageRoot, "fixture-node");
    await writeFile(nodeExecutable, "node", "utf8");

    const descriptor = await slBuildPortableDirectory({
      packageRoot,
      outputRoot,
      version: "0.3.0-test",
      sourceCommit: SOURCE_COMMIT,
      nodeVersion: "v20.19.0",
      platform: "linux",
      architecture: "x64",
      nodeExecutablePath: nodeExecutable,
    });

    expect(descriptor).toEqual({
      schemaVersion: 1,
      version: "0.3.0-test",
      sourceCommit: SOURCE_COMMIT,
      nodeVersion: "v20.19.0",
      platform: "linux",
      architecture: "x64",
      fileName: "sl-0.3.0-test-linux-x64.tar.gz",
      rootDirectory: "sl-0.3.0-test-linux-x64",
    });
    const releaseRoot = resolve(outputRoot, descriptor.rootDirectory);
    expect(await readFile(join(releaseRoot, "runtime", "bin", "node"), "utf8"))
      .toBe("node");
    expect(await readFile(join(releaseRoot, "bin", "sl"), "utf8"))
      .toContain('../runtime/bin/node"');
    expect(
      JSON.parse(await readFile(join(releaseRoot, "sl-release.json"), "utf8")),
    ).toEqual(descriptor);
  });

  test("creates a sorted manifest with exact archive hashes", async () => {
    const assetRoot = await mkdtemp(join(tmpdir(), "SL-portable-assets-"));
    temporaryRoots.push(assetRoot);
    const descriptors = [
      {
        schemaVersion: 1 as const,
        version: "0.3.0",
        sourceCommit: SOURCE_COMMIT,
        nodeVersion: "v20.19.0",
        platform: "windows" as const,
        architecture: "x64" as const,
        fileName: slPortableArchiveName("0.3.0", "windows", "x64"),
        rootDirectory: "sl-0.3.0-windows-x64",
      },
      {
        schemaVersion: 1 as const,
        version: "0.3.0",
        sourceCommit: SOURCE_COMMIT,
        nodeVersion: "v20.19.0",
        platform: "linux" as const,
        architecture: "x64" as const,
        fileName: slPortableArchiveName("0.3.0", "linux", "x64"),
        rootDirectory: "sl-0.3.0-linux-x64",
      },
    ];
    for (const descriptor of descriptors) {
      await writeFile(
        join(assetRoot, `${descriptor.rootDirectory}.asset.json`),
        JSON.stringify(descriptor),
        "utf8",
      );
      await writeFile(
        join(assetRoot, descriptor.fileName),
        descriptor.platform,
        "utf8",
      );
    }

    const manifest = await slCreatePortableReleaseManifest(assetRoot);

    expect(manifest.assets.map((asset) => asset.platform)).toEqual([
      "linux",
      "windows",
    ]);
    expect(manifest.assets).toEqual([
      expect.objectContaining({
        platform: "linux",
        size: 5,
        sha256:
          "caf90169eefa5f807d577486b9f795ab86ae2983c5c20806cff959117e90af18",
      }),
      expect.objectContaining({
        platform: "windows",
        size: 7,
        sha256:
          "340d600392818df2413382dc7d8325c360d83ea49a262d31760348484bbc10b5",
      }),
    ]);
  });
});
