import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
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

afterEach(
  async () => {
    await Promise.all([
      ...temporaryRoots.splice(0).map((root) =>
        rm(root, { recursive: true, force: true }),
      ),
      ...repositories.splice(0).map(slRemoveTestRepository),
    ]);
  },
  120_000,
);

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

function environmentWithoutSystemNode(): NodeJS.ProcessEnv {
  const nodeDirectory = dirname(process.execPath).toLowerCase();
  const pathEntries = (process.env.PATH ?? "")
    .split(process.platform === "win32" ? ";" : ":")
    .filter((entry) => resolve(entry).toLowerCase() !== nodeDirectory);
  return {
    ...process.env,
    PATH: pathEntries.join(process.platform === "win32" ? ";" : ":"),
  };
}

function readWindowsUserPath(): string {
  const result = run("pwsh", [
    "-NoLogo",
    "-NoProfile",
    "-Command",
    "[Environment]::GetEnvironmentVariable('Path','User')",
  ]);
  expectSuccess(result);
  return result.stdout.trimEnd();
}

function writeWindowsUserPath(value: string): void {
  const encoded = Buffer.from(value, "utf8").toString("base64");
  const result = run("pwsh", [
    "-NoLogo",
    "-NoProfile",
    "-Command",
    `[Environment]::SetEnvironmentVariable('Path',[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')),'User')`,
  ]);
  expectSuccess(result);
}

describe("SL portable installation", () => {
  test("installs exactly one persistent command file", async () => {
    const profileRoot = await mkdtemp(join(tmpdir(), "SL command profile-"));
    temporaryRoots.push(profileRoot);
    const priorUserPath =
      process.platform === "win32" ? readWindowsUserPath() : undefined;

    try {
      const installation = run(
        "pwsh",
        [
          "-NoLogo",
          "-NoProfile",
          "-File",
          resolve("sl.ps1"),
          "install",
        ],
        {
          env: {
            ...process.env,
            LOCALAPPDATA: profileRoot,
            HOME: profileRoot,
            SHELL: "/bin/bash",
          },
        },
      );
      expectSuccess(installation);

      const destinationDirectory =
        process.platform === "win32"
          ? join(profileRoot, "sl", "bin")
          : join(profileRoot, ".local", "bin");
      const destinationName =
        process.platform === "win32" ? "sl.ps1" : "sl";
      expect(await readdir(destinationDirectory)).toEqual([destinationName]);
      expect(
        await readFile(join(destinationDirectory, destinationName), "utf8"),
      ).toBe(await readFile(resolve("sl.ps1"), "utf8"));
      expect(installation.stdout).toContain("No wrapper was created.");
    } finally {
      if (priorUserPath !== undefined) {
        writeWindowsUserPath(priorUserPath);
      }
    }
  }, 120_000);

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
    const noSystemNodeEnvironment = environmentWithoutSystemNode();

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

  test("initializes a repository through the unified offline command", async () => {
    const assetRoot = await mkdtemp(join(tmpdir(), "SL portable assets-"));
    temporaryRoots.push(assetRoot);
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

    const repository = await slCreateTestRepository();
    repositories.push(repository);
    const initialization = run(
      "pwsh",
      [
        "-NoLogo",
        "-NoProfile",
        "-File",
        resolve("sl.ps1"),
        "initrepo",
        repository,
        "-Release",
        VERSION,
        "-AssetDirectory",
        assetRoot,
        "-Yes",
      ],
      {
        env: environmentWithoutSystemNode(),
        timeout: 300_000,
      },
    );
    expectSuccess(initialization);
    expect(initialization.stdout).toContain("Running repository-local SL validate");
    await expect(
      readFile(
        join(
          repository,
          ".github",
          "sl-learning",
          "sl-runtime",
          "sl.ps1",
        ),
        "utf8",
      ),
    ).resolves.toContain("sl.runtime.psm1");

    await writeFile(
      join(assetRoot, descriptor.fileName),
      "corrupted archive",
      "utf8",
    );
    const rejectedRepository = await slCreateTestRepository();
    repositories.push(rejectedRepository);
    const rejected = run(
      "pwsh",
      [
        "-NoLogo",
        "-NoProfile",
        "-File",
        resolve("sl.ps1"),
        "initrepo",
        rejectedRepository,
        "-Release",
        VERSION,
        "-AssetDirectory",
        assetRoot,
        "-Yes",
      ],
      { timeout: 300_000 },
    );
    expect(rejected.status).not.toBe(0);
    expect(`${rejected.stdout}\n${rejected.stderr}`).toContain(
      "Archive size verification failed",
    );
  }, 360_000);
});
