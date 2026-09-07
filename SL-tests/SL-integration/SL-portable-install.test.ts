import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  slBuildPortableDirectory,
  slPortableArchitecture,
  slPortablePlatform,
  slWritePortableReleaseManifest,
} from "../../SL-src/SL-distribution/SL-portable.js";
import {
  slCreateTestRepository,
  slRemoveTestRepository,
} from "../SL-fixtures/SL-test-repository.js";

const temporaryRoots: string[] = [];
const repositories: string[] = [];
const SOURCE_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const VERSION = "0.3.0-test";

afterEach(async () => {
  await Promise.all([
    ...temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
    ...repositories.splice(0).map(slRemoveTestRepository),
  ]);
});

function run(
  command: string,
  argumentsList: string[],
  options: { env?: NodeJS.ProcessEnv; timeout?: number } = {},
) {
  return spawnSync(command, argumentsList, {
    encoding: "utf8",
    timeout: options.timeout ?? 60_000,
    env: options.env ?? process.env,
  });
}

function expectSuccess(result: ReturnType<typeof run>): void {
  expect(
    result.status,
    `${result.error?.message ?? ""}\n${result.stdout}\n${result.stderr}`,
  ).toBe(0);
}

describe("SL portable installation", () => {
  test("runs the bundled CLI without system Node and initializes a repository", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "SL-portable-e2e-"));
    temporaryRoots.push(outputRoot);
    const platform = slPortablePlatform(process.platform);
    const architecture = slPortableArchitecture(process.arch);
    const descriptor = await slBuildPortableDirectory({
      packageRoot: resolve("."),
      outputRoot,
      version: VERSION,
      sourceCommit: SOURCE_COMMIT,
      nodeVersion: process.version,
      platform,
      architecture,
      nodeExecutablePath: process.execPath,
    });
    const releaseRoot = join(outputRoot, descriptor.rootDirectory);
    const runtimePath = join(
      releaseRoot,
      platform === "windows" ? "runtime/node.exe" : "runtime/bin/node",
    );
    const cliPath = join(
      releaseRoot,
      "dist",
      "SL-src",
      "SL-cli",
      "SL-cli.js",
    );
    const noSystemNodeEnvironment = { ...process.env, PATH: "" };

    const help = run(runtimePath, [cliPath, "--help"], {
      env: noSystemNodeEnvironment,
    });
    expectSuccess(help);
    expect(help.stdout).toContain("Repository-local self-learning lifecycle");

    const repository = await slCreateTestRepository();
    repositories.push(repository);
    expectSuccess(
      run(runtimePath, [cliPath, "init", repository], {
        env: noSystemNodeEnvironment,
      }),
    );
    expectSuccess(
      run(runtimePath, [cliPath, "doctor", repository], {
        env: noSystemNodeEnvironment,
      }),
    );
    const validation = run(runtimePath, [cliPath, "validate", repository], {
      env: noSystemNodeEnvironment,
    });
    expectSuccess(validation);
    expect(validation.stdout).toContain("SL validation passed.");
  }, 120_000);

  test("installs a verified local release through the native bootstrapper", async () => {
    const assetRoot = await mkdtemp(join(tmpdir(), "SL portable assets-"));
    const installRoot = await mkdtemp(join(tmpdir(), "SL portable install-"));
    temporaryRoots.push(assetRoot, installRoot);
    const platform = slPortablePlatform(process.platform);
    const architecture = slPortableArchitecture(process.arch);
    const descriptor = await slBuildPortableDirectory({
      packageRoot: resolve("."),
      outputRoot: assetRoot,
      version: VERSION,
      sourceCommit: SOURCE_COMMIT,
      nodeVersion: process.version,
      platform,
      architecture,
      nodeExecutablePath: process.execPath,
    });

    const tarResult = run(
      "tar",
      [
        "-czf",
        join(assetRoot, descriptor.fileName),
        "-C",
        assetRoot,
        descriptor.rootDirectory,
      ],
      { timeout: 120_000 },
    );
    expectSuccess(tarResult);
    await slWritePortableReleaseManifest(assetRoot);

    const bootstrapResult =
      platform === "windows"
        ? run(
            process.env.ComSpec
              ? resolve(dirname(process.env.ComSpec), "WindowsPowerShell", "v1.0", "powershell.exe")
              : "powershell.exe",
            [
              "-NoProfile",
              "-File",
              resolve("SL-install.ps1"),
              "-Release",
              VERSION,
              "-AssetDirectory",
              assetRoot,
              "-InstallRoot",
              installRoot,
            ],
            { timeout: 120_000 },
          )
        : run(
            "sh",
            [
              resolve("SL-install.sh"),
              "--release",
              VERSION,
              "--asset-directory",
              assetRoot,
              "--install-root",
              installRoot,
            ],
            { timeout: 120_000 },
          );
    expectSuccess(bootstrapResult);

    const current = await readFile(join(installRoot, "current"), "utf8");
    expect(current.replaceAll("\\", "/")).toBe(
      `versions/${VERSION}/${platform}-${architecture}`,
    );
    const installedRuntime = join(
      installRoot,
      current,
      platform === "windows" ? "runtime/node.exe" : "runtime/bin/node",
    );
    const installedCli = join(
      installRoot,
      current,
      "dist",
      "SL-src",
      "SL-cli",
      "SL-cli.js",
    );
    const result = run(installedRuntime, [installedCli, "--help"], {
      env: { ...process.env, PATH: "" },
    });
    expectSuccess(result);
    expect(result.stdout).toContain("sl-repo");

    await writeFile(
      join(assetRoot, descriptor.fileName),
      "corrupted archive",
      "utf8",
    );
    const rejected =
      platform === "windows"
        ? run(
            process.env.ComSpec
              ? resolve(dirname(process.env.ComSpec), "WindowsPowerShell", "v1.0", "powershell.exe")
              : "powershell.exe",
            [
              "-NoProfile",
              "-File",
              resolve("SL-install.ps1"),
              "-Release",
              VERSION,
              "-AssetDirectory",
              assetRoot,
              "-InstallRoot",
              `${installRoot}-rejected`,
            ],
          )
        : run("sh", [
            resolve("SL-install.sh"),
            "--release",
            VERSION,
            "--asset-directory",
            assetRoot,
            "--install-root",
            `${installRoot}-rejected`,
          ]);
    expect(rejected.status).not.toBe(0);
    expect(`${rejected.stdout}\n${rejected.stderr}`).toContain(
      "SHA-256 verification failed",
    );
  }, 180_000);
});
