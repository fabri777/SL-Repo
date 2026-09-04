import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";
import { SL_SECRET_PATTERNS, SL_USER_PATH_PATTERN } from "../SL-core/SL-constants.js";
import { slParseMarkdown } from "../SL-core/SL-frontmatter.js";
import { slFindPackageRoot } from "../SL-core/SL-package.js";
import { slFindArtifact, slLoadRegistry } from "../SL-core/SL-registry.js";
import type { SLArtifactType, SLRegistryArtifact } from "../SL-core/SL-types.js";
import {
  slAssertRealPathInside,
  slExists,
  slNormalizePath,
  slReadContainedText,
  slReadJson,
  slResolveInside,
} from "../SL-core/SL-utils.js";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as FormatsPlugin;
const SL_CONTRACT_ROOT = ".github/SL-learning/SL-validation-contracts/";
const SL_SAFE_NPM_SCRIPT = /^[A-Za-z0-9][A-Za-z0-9:_-]*$/;
const SL_CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;
const SL_SHELL_META_CHARACTER = /[&|;<>`"'$^%]/;
const SL_UNSUPPORTED_SCOPE_GLOB = /[?[\]{}()!+@|\\]/;
const SL_EXECUTABLE_CLEANUP_TIMEOUT_MS =
  process.platform === "win32" ? 12000 : 2000;
const SL_EXECUTABLE_FORCE_CLOSE_TIMEOUT_MS = 500;
const SL_EXECUTABLE_CLEANUP_POLL_MS = 25;
const SL_POSIX_PROCESS_QUERY_TIMEOUT_MS = 500;
const SL_POSIX_PROCESS_QUERY_MAX_BYTES = 4 * 1024 * 1024;
const SL_WINDOWS_PROCESS_QUERY_TIMEOUT_MS = 10_000;
const SL_WINDOWS_PROCESS_QUERY_MAX_BYTES = 4 * 1024 * 1024;
const SL_WINDOWS_TASKKILL_MAX_BYTES = 64 * 1024;
let slCachedContractValidator:
  | Promise<ReturnType<Ajv2020["compile"]>>
  | undefined;

export type SLPromotedArtifactType = Extract<
  SLArtifactType,
  "instruction" | "skill"
>;

export type SLJsonValue =
  | string
  | number
  | boolean
  | null
  | SLJsonValue[]
  | { [key: string]: SLJsonValue };

export interface SLValidationScenarioCounterexample {
  input: SLJsonValue;
  expectedBehavior: string;
}

export interface SLValidationScenario {
  id: string;
  input: SLJsonValue;
  expectedBehavior: string;
  counterexamples?: SLValidationScenarioCounterexample[];
}

export interface SLValidationDeclaration {
  key: string;
  value: string | number | boolean;
  description?: string;
}

export interface SLExecutableValidationCheck {
  id: string;
  command: "node" | "npm";
  arguments: string[];
  cwd?: string;
  timeoutMs: number;
  expectedExitCode: number;
}

export interface SLValidationContract {
  schemaVersion: 1;
  artifact: {
    id: string;
    type: SLPromotedArtifactType;
    path: string;
  };
  provenance: {
    sourceIds: string[];
    sourcePaths?: string[];
    summary?: string;
  };
  scope:
    | {
        kind: "repository";
        description?: string;
      }
    | {
        kind: "paths";
        paths: string[];
        description?: string;
      };
  scenarios: SLValidationScenario[];
  declarations?: SLValidationDeclaration[];
  executableChecks?: SLExecutableValidationCheck[];
}

export interface SLValidationContractTarget {
  artifactId: string;
  artifactPath: string;
  contentPath?: string;
  artifactType: SLPromotedArtifactType;
  sourceIds: string[];
  contractPath?: string;
  frontmatter?: Record<string, unknown>;
  expectedStatus?: "probation" | "active" | "promoted";
}

export interface SLEvaluationCheckResult {
  id: string;
  kind: "static" | "scenario" | "executable";
  status: "passed" | "failed" | "skipped";
  message: string;
  exitCode?: number | null;
  timedOut?: boolean;
}

export interface SLEvaluationResult {
  schemaVersion: 1;
  artifactId: string;
  artifactType: SLPromotedArtifactType;
  artifactPath: string;
  contractPath: string | null;
  status: "passed" | "failed";
  executableChecksRequested: boolean;
  checks: SLEvaluationCheckResult[];
  contract?: SLValidationContract;
}

export interface SLEvaluateOptions {
  executeCommands?: boolean;
  dryRun?: boolean;
}

export interface SLContractConflict {
  declarationKey: string;
  leftArtifactId: string;
  rightArtifactId: string;
  message: string;
}

export interface SLActiveValidationContract {
  artifactId: string;
  contract: SLValidationContract;
}

function slStaticResult(
  id: string,
  status: "passed" | "failed",
  message: string,
): SLEvaluationCheckResult {
  return { id, kind: "static", status, message };
}

function slAjvMessage(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map(
      (error) =>
        `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
    )
    .join("; ");
}

async function slContractValidator(): Promise<
  ReturnType<Ajv2020["compile"]>
> {
  slCachedContractValidator ??= (async () => {
    const packageRoot = await slFindPackageRoot(import.meta.url);
    const schema = await slReadJson<object>(
      resolve(packageRoot, "SL-schemas/SL-validation-contract.schema.json"),
    );
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    return ajv.compile(schema);
  })();
  return slCachedContractValidator;
}

function slSameStrings(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function slSafeRepositoryPath(value: string): boolean {
  if (
    value !== slNormalizePath(value) ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value) ||
    value.includes("://") ||
    value.split("/").includes("..") ||
    SL_CONTROL_CHARACTER.test(value)
  ) {
    return false;
  }
  try {
    slResolveInside(".", value);
    return true;
  } catch {
    return false;
  }
}

function slSensitiveContentMessage(content: string): string | undefined {
  for (const secret of SL_SECRET_PATTERNS) {
    secret.pattern.lastIndex = 0;
    if (secret.pattern.test(content)) {
      return "Potential secret or credential material detected.";
    }
  }
  SL_USER_PATH_PATTERN.lastIndex = 0;
  if (SL_USER_PATH_PATTERN.test(content)) {
    return "Absolute user-profile path detected; use ~/ or a placeholder.";
  }
  return undefined;
}

function slCanonicalJson(value: SLJsonValue | string | number | boolean): string {
  if (Array.isArray(value)) {
    return `[${value.map(slCanonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, entry]) =>
          `${JSON.stringify(key)}:${slCanonicalJson(entry)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function slScopePatternSegments(pattern: string): string[] | undefined {
  const segments = pattern.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        SL_UNSUPPORTED_SCOPE_GLOB.test(segment) ||
        (segment.includes("**") && segment !== "**"),
    )
  ) {
    return undefined;
  }
  return segments;
}

function slSegmentPatternsIntersect(left: string, right: string): boolean {
  const pending: Array<[number, number, boolean]> = [[0, 0, false]];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const [leftIndex, rightIndex, consumed] = pending.pop()!;
    const state = `${leftIndex}:${rightIndex}:${consumed ? 1 : 0}`;
    if (visited.has(state)) {
      continue;
    }
    visited.add(state);
    if (
      leftIndex === left.length &&
      rightIndex === right.length &&
      consumed
    ) {
      return true;
    }
    const leftToken = left[leftIndex];
    const rightToken = right[rightIndex];
    if (leftToken === "*") {
      pending.push([leftIndex + 1, rightIndex, consumed]);
    }
    if (rightToken === "*") {
      pending.push([leftIndex, rightIndex + 1, consumed]);
    }
    if (leftToken === undefined || rightToken === undefined) {
      continue;
    }
    if (
      leftToken === "*" ||
      rightToken === "*" ||
      leftToken.toLowerCase() === rightToken.toLowerCase()
    ) {
      pending.push([
        leftToken === "*" ? leftIndex : leftIndex + 1,
        rightToken === "*" ? rightIndex : rightIndex + 1,
        true,
      ]);
    }
  }
  return false;
}

function slScopePatternsIntersect(left: string, right: string): boolean {
  const leftSegments = slScopePatternSegments(left);
  const rightSegments = slScopePatternSegments(right);
  if (!leftSegments || !rightSegments) {
    return true;
  }
  const pending: Array<[number, number]> = [[0, 0]];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const [leftIndex, rightIndex] = pending.pop()!;
    const state = `${leftIndex}:${rightIndex}`;
    if (visited.has(state)) {
      continue;
    }
    visited.add(state);
    if (
      leftIndex === leftSegments.length &&
      rightIndex === rightSegments.length
    ) {
      return true;
    }
    const leftSegment = leftSegments[leftIndex];
    const rightSegment = rightSegments[rightIndex];
    if (leftSegment === "**") {
      pending.push([leftIndex + 1, rightIndex]);
    }
    if (rightSegment === "**") {
      pending.push([leftIndex, rightIndex + 1]);
    }
    if (leftSegment === undefined || rightSegment === undefined) {
      continue;
    }
    if (leftSegment === "**" && rightSegment !== "**") {
      pending.push([leftIndex, rightIndex + 1]);
    } else if (rightSegment === "**" && leftSegment !== "**") {
      pending.push([leftIndex + 1, rightIndex]);
    } else if (
      leftSegment !== "**" &&
      rightSegment !== "**" &&
      slSegmentPatternsIntersect(leftSegment, rightSegment)
    ) {
      pending.push([leftIndex + 1, rightIndex + 1]);
    }
  }
  return false;
}

function slScopesOverlap(
  left: SLValidationContract["scope"],
  right: SLValidationContract["scope"],
): boolean {
  if (left.kind === "repository" || right.kind === "repository") {
    return true;
  }
  return left.paths.some((leftPath) =>
    right.paths.some((rightPath) =>
      slScopePatternsIntersect(leftPath, rightPath),
    ),
  );
}

export function slFindValidationContractConflicts(
  contracts: SLActiveValidationContract[],
): SLContractConflict[] {
  const conflicts: SLContractConflict[] = [];
  const ordered = [...contracts].sort((left, right) =>
    left.artifactId.localeCompare(right.artifactId),
  );
  for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
    const left = ordered[leftIndex];
    if (!left) {
      continue;
    }
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < ordered.length;
      rightIndex += 1
    ) {
      const right = ordered[rightIndex];
      if (
        !right ||
        !slScopesOverlap(left.contract.scope, right.contract.scope)
      ) {
        continue;
      }
      const rightDeclarations = new Map(
        (right.contract.declarations ?? []).map((declaration) => [
          declaration.key,
          declaration,
        ]),
      );
      for (const declaration of left.contract.declarations ?? []) {
        const competing = rightDeclarations.get(declaration.key);
        if (
          competing &&
          slCanonicalJson(declaration.value) !==
            slCanonicalJson(competing.value)
        ) {
          conflicts.push({
            declarationKey: declaration.key,
            leftArtifactId: left.artifactId,
            rightArtifactId: right.artifactId,
            message: `Active artifacts ${left.artifactId} and ${right.artifactId} declare conflicting values for ${declaration.key} in overlapping scopes.`,
          });
        }
      }
    }
  }
  return conflicts;
}

async function slValidateExecutableCheck(
  root: string,
  check: SLExecutableValidationCheck,
): Promise<string | undefined> {
  const cwd = check.cwd ?? ".";
  if (!slSafeRepositoryPath(cwd)) {
    return `Executable check ${check.id} has an unsafe working directory.`;
  }
  const absoluteCwd = slResolveInside(root, cwd);
  if (!(await slExists(absoluteCwd))) {
    return `Executable check ${check.id} working directory does not exist.`;
  }
  await slAssertRealPathInside(root, cwd);
  if (!(await stat(absoluteCwd)).isDirectory()) {
    return `Executable check ${check.id} working directory is not a directory.`;
  }
  if (
    check.arguments.some(
      (argument) =>
        SL_CONTROL_CHARACTER.test(argument) ||
        SL_SHELL_META_CHARACTER.test(argument),
    )
  ) {
    return `Executable check ${check.id} contains an unsafe command argument.`;
  }
  if (check.command === "node") {
    const scriptPath = check.arguments[0];
    if (
      !scriptPath ||
      !slSafeRepositoryPath(scriptPath) ||
      ![".js", ".mjs", ".cjs"].includes(extname(scriptPath))
    ) {
      return `Executable check ${check.id} must run a repository-contained JavaScript file.`;
    }
    const absoluteScript = slResolveInside(absoluteCwd, scriptPath);
    if (!(await slExists(absoluteScript))) {
      return `Executable check ${check.id} script does not exist.`;
    }
    await slAssertRealPathInside(root, slNormalizePath(
      slNormalizePath(cwd) === "."
        ? scriptPath
        : `${slNormalizePath(cwd)}/${scriptPath}`,
    ));
  } else {
    const [operation, scriptName, separator] = check.arguments;
    if (
      operation !== "run" ||
      !scriptName ||
      !SL_SAFE_NPM_SCRIPT.test(scriptName) ||
      (check.arguments.length > 2 && separator !== "--")
    ) {
      return `Executable check ${check.id} must use npm run <script> with an optional -- argument separator.`;
    }
  }
  return undefined;
}

async function slRunExecutableCheck(
  root: string,
  check: SLExecutableValidationCheck,
): Promise<SLEvaluationCheckResult> {
  const cwd = slResolveInside(root, check.cwd ?? ".");
  const executable =
    check.command === "npm" && process.platform === "win32"
      ? "npm.cmd"
      : check.command;
  const child = spawn(executable, check.arguments, {
    cwd,
    detached: process.platform !== "win32",
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
  const closePromise = new Promise<number | null>((resolveClose) => {
    child.once("close", resolveClose);
  });
  const errorPromise = new Promise<Error>((resolveError) => {
    child.once("error", resolveError);
  });
  let timeout: NodeJS.Timeout | undefined;
  const firstOutcome = await Promise.race([
    closePromise.then((exitCode) => ({ kind: "close" as const, exitCode })),
    errorPromise.then((error) => ({ kind: "error" as const, error })),
    new Promise<{ kind: "timeout" }>((resolveTimeout) => {
      timeout = setTimeout(
        () => resolveTimeout({ kind: "timeout" }),
        check.timeoutMs,
      );
    }),
  ]);
  if (timeout) {
    clearTimeout(timeout);
  }
  if (firstOutcome.kind === "error") {
    const cleanupFailure =
      child.pid === undefined
        ? undefined
        : await slEnsureExecutableProcessContainment(
            child,
            closePromise,
            false,
          );
    return {
      id: `executable:${check.id}`,
      kind: "executable",
      status: "failed",
      message: cleanupFailure
        ? `Executable check could not start: ${firstOutcome.error.message}; process-tree cleanup could not be confirmed: ${cleanupFailure}`
        : `Executable check could not start: ${firstOutcome.error.message}`,
    };
  }
  if (firstOutcome.kind === "close") {
    const cleanupFailure = await slEnsureExecutableProcessContainment(
      child,
      closePromise,
      true,
    );
    return cleanupFailure
      ? slExecutableCleanupFailureResult(
          check,
          firstOutcome.exitCode,
          false,
          cleanupFailure,
        )
      : slExecutableExitResult(check, firstOutcome.exitCode);
  }
  await new Promise<void>((resolveImmediate) => {
    setImmediate(resolveImmediate);
  });
  if (child.exitCode !== null || child.signalCode !== null) {
    const closeResult = await slWaitForPromise(
      closePromise,
      SL_EXECUTABLE_CLEANUP_TIMEOUT_MS,
    );
    if (closeResult.completed) {
      const cleanupFailure = await slEnsureExecutableProcessContainment(
        child,
        closePromise,
        true,
      );
      return cleanupFailure
        ? slExecutableCleanupFailureResult(
            check,
            closeResult.value,
            false,
            cleanupFailure,
          )
        : slExecutableExitResult(check, closeResult.value);
    }
  }
  const cleanupFailure = await slEnsureExecutableProcessContainment(
    child,
    closePromise,
    false,
  );
  if (cleanupFailure) {
    child.unref();
  }
  return {
    id: `executable:${check.id}`,
    kind: "executable",
    status: "failed",
    message: cleanupFailure
      ? `Executable check exceeded ${check.timeoutMs}ms, but process-tree termination could not be confirmed: ${cleanupFailure}`
      : `Executable check exceeded ${check.timeoutMs}ms.`,
    exitCode: null,
    timedOut: true,
  };
}

function slExecutableCleanupFailureResult(
  check: SLExecutableValidationCheck,
  exitCode: number | null,
  timedOut: boolean,
  cleanupFailure: string,
): SLEvaluationCheckResult {
  const outcome = timedOut
    ? `Executable check exceeded ${check.timeoutMs}ms`
    : exitCode === check.expectedExitCode
      ? `Executable check exited with expected code ${check.expectedExitCode}`
      : `Executable check exited with code ${String(exitCode)}; expected ${check.expectedExitCode}`;
  return {
    id: `executable:${check.id}`,
    kind: "executable",
    status: "failed",
    message: `${outcome}, but process-tree cleanup could not be confirmed: ${cleanupFailure}`,
    exitCode: timedOut ? null : exitCode,
    timedOut,
  };
}

function slExecutableExitResult(
  check: SLExecutableValidationCheck,
  exitCode: number | null,
): SLEvaluationCheckResult {
  return {
    id: `executable:${check.id}`,
    kind: "executable",
    status: exitCode === check.expectedExitCode ? "passed" : "failed",
    message:
      exitCode === check.expectedExitCode
        ? `Executable check exited with expected code ${check.expectedExitCode}.`
        : `Executable check exited with code ${String(exitCode)}; expected ${check.expectedExitCode}.`,
    exitCode,
    timedOut: false,
  };
}

async function slEnsureExecutableProcessContainment(
  child: ChildProcess,
  closePromise: Promise<number | null>,
  directChildCompleted: boolean,
): Promise<string | undefined> {
  const pid = child.pid;
  if (pid === undefined) {
    return "the executable process did not expose a PID";
  }
  if (process.platform === "win32") {
    return slContainWindowsProcessTree(
      pid,
      child,
      closePromise,
      directChildCompleted,
    );
  }
  return slContainPosixProcessGroup(
    pid,
    closePromise,
    directChildCompleted,
  );
}

async function slContainPosixProcessGroup(
  pid: number,
  closePromise: Promise<number | null>,
  directChildCompleted: boolean,
): Promise<string | undefined> {
  let terminationError: string | undefined;
  const groupState = await slReadPosixProcessGroupState(
    pid,
    SL_POSIX_PROCESS_QUERY_TIMEOUT_MS,
  );
  if (typeof groupState === "string") {
    return groupState;
  }
  if (groupState) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ESRCH") {
        terminationError = (error as Error).message;
      }
    }
  }
  const [closeResult, groupResult] = await Promise.all([
    directChildCompleted
      ? Promise.resolve({ completed: true as const, value: null })
      : slWaitForPromise(closePromise, SL_EXECUTABLE_CLEANUP_TIMEOUT_MS),
    slWaitForProcessGroupExit(pid, SL_EXECUTABLE_CLEANUP_TIMEOUT_MS),
  ]);
  const failures = [
    terminationError
      ? `sending SIGKILL to process group ${pid} failed: ${terminationError}`
      : undefined,
    closeResult.completed
      ? undefined
      : `process closure was not observed within ${SL_EXECUTABLE_CLEANUP_TIMEOUT_MS}ms`,
    groupResult,
  ].filter((failure): failure is string => failure !== undefined);
  return failures.length > 0 ? failures.join("; ") : undefined;
}

export function slParseLivePosixProcessGroups(
  output: string,
): { processGroupIds: Set<number> } | { error: string } {
  const processGroupIds = new Set<number>();
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const match = /^\s*(\d+)\s+(\S+)\s*$/.exec(line);
    if (!match) {
      return {
        error: `POSIX process snapshot contained an unrecognized row: ${line.trim()}`,
      };
    }
    const processGroupId = Number.parseInt(match[1]!, 10);
    const status = match[2]!;
    if (!Number.isSafeInteger(processGroupId)) {
      return {
        error: `POSIX process snapshot contained an invalid process group ID: ${match[1]}`,
      };
    }
    // GNU ps reports kernel processes with PGID 0. They can never match a
    // positive child process group and are safe to ignore.
    if (processGroupId === 0) {
      continue;
    }
    if (!status.startsWith("Z")) {
      processGroupIds.add(processGroupId);
    }
  }
  return { processGroupIds };
}

async function slReadPosixProcessGroupState(
  pid: number,
  timeoutMs: number,
): Promise<boolean | string> {
  const query = spawn(
    "/bin/ps",
    ["-ax", "-o", "pgid=,stat="],
    {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let output = "";
  let errorOutput = "";
  let exceededBuffer = false;
  query.stdout.setEncoding("utf8");
  query.stderr.setEncoding("utf8");
  query.stdout.on("data", (chunk: string) => {
    output += chunk;
    if (output.length > SL_POSIX_PROCESS_QUERY_MAX_BYTES) {
      exceededBuffer = true;
      query.kill("SIGKILL");
    }
  });
  query.stderr.on("data", (chunk: string) => {
    errorOutput += chunk;
    if (errorOutput.length > SL_POSIX_PROCESS_QUERY_MAX_BYTES) {
      exceededBuffer = true;
      query.kill("SIGKILL");
    }
  });
  const outcomePromise = new Promise<
    | { kind: "close"; exitCode: number | null }
    | { kind: "error"; error: Error }
  >((resolveOutcome) => {
    query.once("close", (exitCode) => {
      resolveOutcome({ kind: "close", exitCode });
    });
    query.once("error", (error) => {
      resolveOutcome({ kind: "error", error });
    });
  });
  const outcome = await slWaitForPromise(outcomePromise, timeoutMs);
  if (!outcome.completed) {
    query.kill("SIGKILL");
    const forcedClose = await slWaitForPromise(
      outcomePromise,
      SL_EXECUTABLE_FORCE_CLOSE_TIMEOUT_MS,
    );
    if (!forcedClose.completed) {
      query.stdout.destroy();
      query.stderr.destroy();
      query.unref();
    }
    return `POSIX process snapshot did not finish within ${timeoutMs}ms${
      forcedClose.completed
        ? ""
        : ` and did not close within ${SL_EXECUTABLE_FORCE_CLOSE_TIMEOUT_MS}ms after termination`
    }`;
  }
  if (exceededBuffer) {
    return "POSIX process snapshot exceeded its output limit";
  }
  if (outcome.value.kind === "error") {
    return `POSIX process snapshot could not start: ${outcome.value.error.message}`;
  }
  if (outcome.value.exitCode !== 0) {
    const detail = errorOutput.trim();
    return `POSIX process snapshot exited with code ${String(outcome.value.exitCode)}${detail ? `: ${detail}` : ""}`;
  }
  const snapshot = slParseLivePosixProcessGroups(output);
  return "error" in snapshot
    ? snapshot.error
    : snapshot.processGroupIds.has(pid);
}

interface SLWindowsProcessEntry {
  pid: number;
  parentPid: number;
}

async function slContainWindowsProcessTree(
  pid: number,
  child: ChildProcess,
  closePromise: Promise<number | null>,
  directChildCompleted: boolean,
): Promise<string | undefined> {
  const deadline = Date.now() + SL_EXECUTABLE_CLEANUP_TIMEOUT_MS;
  const lineage = new Set([pid]);
  const diagnostics: string[] = [];

  if (!directChildCompleted) {
    const initialTermination = await slRunWindowsTaskkill(
      pid,
      Math.max(1, deadline - Date.now()),
    );
    if (initialTermination.error) {
      diagnostics.push(initialTermination.error);
    }
  }

  while (Date.now() < deadline) {
    const snapshot = await slReadWindowsProcessSnapshot(
      Math.min(
        SL_WINDOWS_PROCESS_QUERY_TIMEOUT_MS,
        Math.max(1, deadline - Date.now()),
      ),
    );
    if ("error" in snapshot) {
      diagnostics.push(snapshot.error);
      await new Promise((resolveDelay) => {
        setTimeout(resolveDelay, SL_EXECUTABLE_CLEANUP_POLL_MS);
      });
      continue;
    }
    const descendants = slWindowsDescendants(snapshot.entries, lineage);
    for (const descendant of descendants) {
      lineage.add(descendant.pid);
    }
    const liveLineage = snapshot.entries.filter(
      (entry) =>
        lineage.has(entry.pid) &&
        (!directChildCompleted || entry.pid !== pid),
    );
    if (liveLineage.length === 0) {
      const closeResult = directChildCompleted
        ? { completed: true as const, value: null }
        : await slWaitForPromise(
            closePromise,
            Math.max(1, deadline - Date.now()),
          );
      if (closeResult.completed) {
        return undefined;
      }
      diagnostics.push(
        `process closure was not observed within ${SL_EXECUTABLE_CLEANUP_TIMEOUT_MS}ms`,
      );
      return diagnostics.join("; ");
    }
    const livePids = new Set(liveLineage.map((entry) => entry.pid));
    const targets = liveLineage
      .filter(
        (entry) =>
          entry.pid === pid ||
          !livePids.has(entry.parentPid),
      )
      .map((entry) => entry.pid);
    const terminations = await Promise.all(
      targets.map((targetPid) =>
        slRunWindowsTaskkill(
          targetPid,
          Math.max(1, deadline - Date.now()),
        ),
      ),
    );
    diagnostics.push(
      ...terminations.flatMap((termination) =>
        termination.error ? [termination.error] : [],
      ),
    );
    const verificationTimeout = Math.min(
      SL_EXECUTABLE_FORCE_CLOSE_TIMEOUT_MS,
      Math.max(1, deadline - Date.now()),
    );
    const [closeResult, processesExited] = await Promise.all([
      directChildCompleted
        ? Promise.resolve({ completed: true as const, value: null })
        : slWaitForPromise(closePromise, verificationTimeout),
      slWaitForWindowsProcessesToExit(
        liveLineage.map((entry) => entry.pid),
        verificationTimeout,
      ),
    ]);
    if (closeResult.completed && processesExited) {
      return undefined;
    }
    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, SL_EXECUTABLE_CLEANUP_POLL_MS);
    });
  }

  child.kill("SIGKILL");
  await slWaitForPromise(
    closePromise,
    SL_EXECUTABLE_FORCE_CLOSE_TIMEOUT_MS,
  );
  const remaining = await slReadWindowsProcessSnapshot(
    SL_EXECUTABLE_FORCE_CLOSE_TIMEOUT_MS,
  );
  if ("error" in remaining) {
    diagnostics.push(remaining.error);
  } else {
    const descendants = slWindowsDescendants(remaining.entries, lineage);
    for (const descendant of descendants) {
      lineage.add(descendant.pid);
    }
    const remainingPids = remaining.entries
      .filter(
        (entry) =>
          lineage.has(entry.pid) &&
          (!directChildCompleted || entry.pid !== pid),
      )
      .map((entry) => entry.pid);
    if (remainingPids.length > 0) {
      diagnostics.push(
        `process tree still contained PIDs ${remainingPids.join(", ")} after ${SL_EXECUTABLE_CLEANUP_TIMEOUT_MS}ms`,
      );
    }
  }
  return diagnostics.length > 0
    ? diagnostics.join("; ")
    : `process-tree containment was not confirmed within ${SL_EXECUTABLE_CLEANUP_TIMEOUT_MS}ms`;
}

function slWindowsDescendants(
  entries: SLWindowsProcessEntry[],
  lineage: Set<number>,
): SLWindowsProcessEntry[] {
  const descendants: SLWindowsProcessEntry[] = [];
  let foundDescendant = true;
  while (foundDescendant) {
    foundDescendant = false;
    for (const entry of entries) {
      if (
        !lineage.has(entry.pid) &&
        lineage.has(entry.parentPid)
      ) {
        lineage.add(entry.pid);
        descendants.push(entry);
        foundDescendant = true;
      }
    }
  }
  return descendants;
}

async function slReadWindowsProcessSnapshot(
  timeoutMs: number,
): Promise<
  { entries: SLWindowsProcessEntry[] } | { error: string }
> {
  const command = slWindowsProcessSnapshotCommand();
  if ("error" in command) {
    return command;
  }
  const query = spawn(
    command.executable,
    command.arguments,
    {
      cwd: command.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let output = "";
  let errorOutput = "";
  let exceededBuffer = false;
  query.stdout.setEncoding("utf8");
  query.stderr.setEncoding("utf8");
  query.stdout.on("data", (chunk: string) => {
    output += chunk;
    if (output.length > SL_WINDOWS_PROCESS_QUERY_MAX_BYTES) {
      exceededBuffer = true;
      query.kill("SIGKILL");
    }
  });
  query.stderr.on("data", (chunk: string) => {
    errorOutput += chunk;
    if (errorOutput.length > SL_WINDOWS_PROCESS_QUERY_MAX_BYTES) {
      exceededBuffer = true;
      query.kill("SIGKILL");
    }
  });
  const outcomePromise = new Promise<
    | { kind: "close"; exitCode: number | null }
    | { kind: "error"; error: Error }
  >((resolveOutcome) => {
    query.once("close", (exitCode) => {
      resolveOutcome({ kind: "close", exitCode });
    });
    query.once("error", (error) => {
      resolveOutcome({ kind: "error", error });
    });
  });
  const outcome = await slWaitForPromise(outcomePromise, timeoutMs);
  if (!outcome.completed) {
    query.kill("SIGKILL");
    const forcedClose = await slWaitForPromise(
      outcomePromise,
      SL_EXECUTABLE_FORCE_CLOSE_TIMEOUT_MS,
    );
    if (!forcedClose.completed) {
      query.stdout.destroy();
      query.stderr.destroy();
      query.unref();
    }
    return {
      error: `Windows process snapshot did not finish within ${timeoutMs}ms${
        forcedClose.completed
          ? ""
          : ` and did not close within ${SL_EXECUTABLE_FORCE_CLOSE_TIMEOUT_MS}ms after termination`
      }`,
    };
  }
  if (exceededBuffer) {
    return { error: "Windows process snapshot exceeded its output limit" };
  }
  if (outcome.value.kind === "error") {
    return {
      error: `Windows process snapshot could not start: ${outcome.value.error.message}`,
    };
  }
  if (outcome.value.exitCode !== 0) {
    const detail = errorOutput.trim();
    return {
      error: `Windows process snapshot exited with code ${String(outcome.value.exitCode)}${detail ? `: ${detail}` : ""}`,
    };
  }
  const entries = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(\d+),(\d+)$/.exec(line);
      return match
        ? {
            pid: Number.parseInt(match[1]!, 10),
            parentPid: Number.parseInt(match[2]!, 10),
          }
        : undefined;
    })
    .filter((entry): entry is SLWindowsProcessEntry => entry !== undefined);
  return { entries };
}

async function slWaitForWindowsProcessesToExit(
  pids: number[],
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pids.every((pid) => !slWindowsProcessExists(pid))) {
      return true;
    }
    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, SL_EXECUTABLE_CLEANUP_POLL_MS);
    });
  }
  return pids.every((pid) => !slWindowsProcessExists(pid));
}

function slWindowsProcessExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !["ESRCH", "EINVAL"].includes(
      (error as NodeJS.ErrnoException).code ?? "",
    );
  }
}

function slWindowsProcessSnapshotCommand():
  | { executable: string; arguments: string[]; cwd: string }
  | { error: string } {
  const windowsDirectory = slWindowsDirectory();
  if (typeof windowsDirectory !== "string") {
    return windowsDirectory;
  }
  const programFiles = process.env.ProgramFiles;
  const powerShellCore =
    programFiles && isAbsolute(programFiles)
      ? join(programFiles, "PowerShell", "7", "pwsh.exe")
      : undefined;
  if (powerShellCore && existsSync(powerShellCore)) {
    return {
      executable: powerShellCore,
      arguments: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-Process | ForEach-Object { $parentId = 0; try { $parentId = $_.Parent.Id } catch {}; [Console]::WriteLine(('{0},{1}' -f $_.Id, $parentId)) }",
      ],
      cwd: windowsDirectory,
    };
  }
  return {
    executable: join(
      windowsDirectory,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    arguments: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId | ForEach-Object { [Console]::WriteLine(('{0},{1}' -f $_.ProcessId, $_.ParentProcessId)) }",
    ],
    cwd: windowsDirectory,
  };
}

async function slRunWindowsTaskkill(
  pid: number,
  timeoutMs: number,
): Promise<{ exitCode?: number | null; error?: string }> {
  const windowsDirectory = slWindowsDirectory();
  if (typeof windowsDirectory !== "string") {
    return { error: windowsDirectory.error };
  }
  const taskkill = spawn(
    join(windowsDirectory, "System32", "taskkill.exe"),
    ["/PID", String(pid), "/T", "/F"],
    {
      cwd: windowsDirectory,
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    },
  );
  let errorOutput = "";
  let exceededBuffer = false;
  taskkill.stderr.setEncoding("utf8");
  taskkill.stderr.on("data", (chunk: string) => {
    errorOutput += chunk;
    if (errorOutput.length > SL_WINDOWS_TASKKILL_MAX_BYTES) {
      exceededBuffer = true;
      taskkill.kill("SIGKILL");
    }
  });
  const outcomePromise = new Promise<
    | { kind: "close"; exitCode: number | null }
    | { kind: "error"; error: Error }
  >((resolveOutcome) => {
    taskkill.once("close", (exitCode) => {
      resolveOutcome({ kind: "close", exitCode });
    });
    taskkill.once("error", (error) => {
      resolveOutcome({ kind: "error", error });
    });
  });
  const outcome = await slWaitForPromise(outcomePromise, timeoutMs);
  if (!outcome.completed) {
    taskkill.kill("SIGKILL");
    const forcedClose = await slWaitForPromise(
      outcomePromise,
      SL_EXECUTABLE_FORCE_CLOSE_TIMEOUT_MS,
    );
    if (!forcedClose.completed) {
      taskkill.stderr.destroy();
      taskkill.unref();
    }
    return {
      error: `PID-specific taskkill for ${pid} did not finish within ${timeoutMs}ms`,
    };
  }
  if (exceededBuffer) {
    return {
      error: `PID-specific taskkill for ${pid} exceeded its output limit`,
    };
  }
  if (outcome.value.kind === "error") {
    return {
      error: `PID-specific taskkill for ${pid} could not start: ${outcome.value.error.message}`,
    };
  }
  if (outcome.value.exitCode !== 0) {
    const detail = errorOutput.trim();
    return {
      exitCode: outcome.value.exitCode,
      error: `PID-specific taskkill for ${pid} exited with code ${String(outcome.value.exitCode)}${detail ? `: ${detail}` : ""}`,
    };
  }
  return { exitCode: outcome.value.exitCode };
}

function slWindowsDirectory():
  | string
  | { error: string } {
  const windowsDirectory = process.env.SystemRoot ?? process.env.WINDIR;
  return windowsDirectory && isAbsolute(windowsDirectory)
    ? windowsDirectory
    : { error: "the Windows system directory could not be resolved safely" };
}

async function slWaitForProcessGroupExit(
  pid: number,
  timeoutMs: number,
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const groupState = await slReadPosixProcessGroupState(
      pid,
      Math.min(
        SL_POSIX_PROCESS_QUERY_TIMEOUT_MS,
        Math.max(1, deadline - Date.now()),
      ),
    );
    if (typeof groupState === "string") {
      return `process group ${pid} exit could not be checked: ${groupState}`;
    }
    if (!groupState) {
      return undefined;
    }
    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, SL_EXECUTABLE_CLEANUP_POLL_MS);
    });
  }
  return `process group ${pid} still existed after ${timeoutMs}ms`;
}

async function slWaitForPromise<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<{ completed: true; value: T } | { completed: false }> {
  let timeout: NodeJS.Timeout | undefined;
  const result = await Promise.race([
    promise.then((value) => ({ completed: true as const, value })),
    new Promise<{ completed: false }>((resolveTimeout) => {
      timeout = setTimeout(
        () => resolveTimeout({ completed: false }),
        timeoutMs,
      );
    }),
  ]);
  if (timeout) {
    clearTimeout(timeout);
  }
  return result;
}

function slFrontmatterTypeIssue(
  target: SLValidationContractTarget,
  frontmatter: Record<string, unknown>,
): string | undefined {
  if (target.artifactType === "instruction") {
    if (
      !target.artifactPath.startsWith(".github/instructions/") ||
      !target.artifactPath.endsWith(".instructions.md")
    ) {
      return "Promoted instruction path must be under .github/instructions/ and end with .instructions.md.";
    }
    const applyTo = frontmatter.applyTo;
    if (
      !(
        (typeof applyTo === "string" && applyTo.trim().length > 0) ||
        (Array.isArray(applyTo) &&
          applyTo.length > 0 &&
          applyTo.every(
            (entry) => typeof entry === "string" && entry.trim().length > 0,
          ))
      )
    ) {
      return "Promoted instruction frontmatter requires a non-empty applyTo declaration.";
    }
    return undefined;
  }
  if (
    !target.artifactPath.startsWith(".github/skills/") ||
    !target.artifactPath.endsWith("/SKILL.md")
  ) {
    return "Promoted skill path must be under .github/skills/ and end with /SKILL.md.";
  }
  const expectedName = basename(dirname(target.artifactPath));
  if (frontmatter.name !== expectedName) {
    return `Promoted skill frontmatter name must be ${expectedName}.`;
  }
  return undefined;
}

export async function slEvaluateValidationContract(
  root: string,
  target: SLValidationContractTarget,
  options: SLEvaluateOptions = {},
): Promise<SLEvaluationResult> {
  const checks: SLEvaluationCheckResult[] = [];
  const executeCommands =
    options.executeCommands === true && options.dryRun !== true;
  const normalizedArtifactPath = slNormalizePath(target.artifactPath);
  const normalizedContentPath = slNormalizePath(
    target.contentPath ?? target.artifactPath,
  );
  const contractPath = target.contractPath
    ? slNormalizePath(target.contractPath)
    : null;
  let contract: SLValidationContract | undefined;

  if (
    !contractPath ||
    !contractPath.startsWith(SL_CONTRACT_ROOT) ||
    !basename(contractPath).startsWith("SL-") ||
    !contractPath.endsWith(".validation.json") ||
    !slSafeRepositoryPath(contractPath)
  ) {
    checks.push(
      slStaticResult(
        "contract-path",
        "failed",
        "validationContract must reference an SL-*.validation.json file under .github/SL-learning/SL-validation-contracts/.",
      ),
    );
  } else {
    const absoluteContractPath = slResolveInside(root, contractPath);
    if (!(await slExists(absoluteContractPath))) {
      checks.push(
        slStaticResult(
          "contract-exists",
          "failed",
          `Validation contract does not exist: ${contractPath}.`,
        ),
      );
    } else {
      try {
        const content = await slReadContainedText(root, contractPath);
        const sensitiveMessage = slSensitiveContentMessage(content);
        checks.push(
          slStaticResult(
            "contract-content-safety",
            sensitiveMessage ? "failed" : "passed",
            sensitiveMessage ?? "Validation contract contains no obvious secrets or personal paths.",
          ),
        );
        let parsed: unknown;
        try {
          parsed = JSON.parse(content);
        } catch (error) {
          checks.push(
            slStaticResult(
              "contract-json",
              "failed",
              error instanceof Error ? error.message : String(error),
            ),
          );
        }
        if (parsed !== undefined) {
          const validate = await slContractValidator();
          if (!validate(parsed)) {
            checks.push(
              slStaticResult(
                "contract-schema",
                "failed",
                slAjvMessage(validate.errors),
              ),
            );
          } else {
            contract = parsed as SLValidationContract;
            checks.push(
              slStaticResult(
                "contract-schema",
                "passed",
                "Validation contract conforms to schema version 1.",
              ),
            );
          }
        }
      } catch (error) {
        checks.push(
          slStaticResult(
            "contract-access",
            "failed",
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    }
  }

  let frontmatter = target.frontmatter;
  try {
    const artifactContent = await slReadContainedText(
      root,
      normalizedContentPath,
    );
    const sensitiveMessage = slSensitiveContentMessage(artifactContent);
    checks.push(
      slStaticResult(
        "artifact-content-safety",
        sensitiveMessage ? "failed" : "passed",
        sensitiveMessage ?? "Promoted artifact contains no obvious secrets or personal paths.",
      ),
    );
    if (!frontmatter) {
      frontmatter = slParseMarkdown<Record<string, unknown>>(
        artifactContent,
      ).frontmatter;
    }
  } catch (error) {
    checks.push(
      slStaticResult(
        "artifact-frontmatter",
        "failed",
        error instanceof Error ? error.message : String(error),
      ),
    );
  }

  if (frontmatter) {
    const ownershipValid =
      frontmatter.id === target.artifactId &&
      frontmatter.schemaVersion === 1 &&
      frontmatter.managedBy === "SL-Repo" &&
      frontmatter.status === (target.expectedStatus ?? "promoted") &&
      frontmatter.pinned === false &&
      Array.isArray(frontmatter.sourceIds) &&
      frontmatter.sourceIds.every((sourceId) => typeof sourceId === "string") &&
      slSameStrings(frontmatter.sourceIds as string[], target.sourceIds) &&
      frontmatter.validationContract === contractPath;
    checks.push(
      slStaticResult(
        "artifact-ownership",
        ownershipValid ? "passed" : "failed",
        ownershipValid
          ? "Promoted artifact ownership and source linkage are valid."
          : "Promoted artifact frontmatter ownership, contract, or source linkage is invalid.",
      ),
    );
    const typeIssue = slFrontmatterTypeIssue(target, frontmatter);
    checks.push(
      slStaticResult(
        "artifact-frontmatter-type",
        typeIssue ? "failed" : "passed",
        typeIssue ?? `Promoted ${target.artifactType} frontmatter is valid.`,
      ),
    );
  }

  if (contract) {
    const artifactMatches =
      contract.artifact.id === target.artifactId &&
      contract.artifact.type === target.artifactType &&
      slNormalizePath(contract.artifact.path) === normalizedArtifactPath;
    checks.push(
      slStaticResult(
        "contract-artifact",
        artifactMatches ? "passed" : "failed",
        artifactMatches
          ? "Contract artifact identity, type, and path match."
          : "Contract artifact identity, type, or path does not match the promoted artifact.",
      ),
    );
    const sourceMatches = slSameStrings(
      contract.provenance.sourceIds,
      target.sourceIds,
    );
    checks.push(
      slStaticResult(
        "contract-sources",
        sourceMatches ? "passed" : "failed",
        sourceMatches
          ? "Contract provenance matches registry source IDs."
          : "Contract provenance source IDs do not match the promotion source IDs.",
      ),
    );
    const sourcePaths = contract.provenance.sourcePaths ?? [];
    let sourcePathsSafe = sourcePaths.every(slSafeRepositoryPath);
    if (sourcePathsSafe) {
      for (const sourcePath of sourcePaths) {
        const absoluteSourcePath = slResolveInside(root, sourcePath);
        if (!(await slExists(absoluteSourcePath))) {
          sourcePathsSafe = false;
          break;
        }
        try {
          await slAssertRealPathInside(root, sourcePath);
        } catch {
          sourcePathsSafe = false;
          break;
        }
      }
    }
    checks.push(
      slStaticResult(
        "contract-source-paths",
        sourcePathsSafe ? "passed" : "failed",
        sourcePathsSafe
          ? "Contract provenance paths are existing repository-contained files."
          : "Contract provenance includes a missing or unsafe path.",
      ),
    );
    const scopePaths =
      contract.scope.kind === "paths" ? contract.scope.paths : [];
    const scopePathsSafe = scopePaths.every(slSafeRepositoryPath);
    checks.push(
      slStaticResult(
        "contract-scope",
        scopePathsSafe ? "passed" : "failed",
        scopePathsSafe
          ? "Contract scope is repository-contained."
          : "Contract scope includes an unsafe path.",
      ),
    );

    const scenarioIds = new Set<string>();
    for (const scenario of contract.scenarios) {
      const duplicate = scenarioIds.has(scenario.id);
      scenarioIds.add(scenario.id);
      const positiveInput = slCanonicalJson(scenario.input);
      const counterexampleDuplicates =
        scenario.counterexamples?.some(
          (counterexample) =>
            slCanonicalJson(counterexample.input) === positiveInput,
        ) ?? false;
      checks.push({
        id: `scenario:${scenario.id}`,
        kind: "scenario",
        status:
          duplicate || counterexampleDuplicates ? "failed" : "passed",
        message: duplicate
          ? `Scenario ID ${scenario.id} is duplicated.`
          : counterexampleDuplicates
            ? `Scenario ${scenario.id} repeats its positive input as a counterexample.`
            : `Scenario ${scenario.id} has a deterministic input and expected behavior.`,
      });
    }

    const declarationValues = new Map<string, string>();
    for (const declaration of contract.declarations ?? []) {
      const value = slCanonicalJson(declaration.value);
      const existing = declarationValues.get(declaration.key);
      checks.push(
        slStaticResult(
          `declaration:${declaration.key}`,
          existing !== undefined && existing !== value ? "failed" : "passed",
          existing !== undefined && existing !== value
            ? `Contract declares multiple values for ${declaration.key}.`
            : `Declaration ${declaration.key} is internally consistent.`,
        ),
      );
      declarationValues.set(declaration.key, value);
    }

    const executableSafety = new Map<string, string | undefined>();
    const executableIds = new Set<string>();
    for (const executableCheck of contract.executableChecks ?? []) {
      let safetyIssue: string | undefined;
      if (executableIds.has(executableCheck.id)) {
        safetyIssue = `Executable check ID ${executableCheck.id} is duplicated.`;
      } else {
        executableIds.add(executableCheck.id);
      }
      try {
        safetyIssue ??= await slValidateExecutableCheck(
          root,
          executableCheck,
        );
      } catch (error) {
        safetyIssue = error instanceof Error ? error.message : String(error);
      }
      executableSafety.set(executableCheck.id, safetyIssue);
      if (safetyIssue) {
        checks.push({
          id: `executable:${executableCheck.id}`,
          kind: "executable",
          status: "failed",
          message: safetyIssue,
        });
      }
    }
    const staticFailure = checks.some((check) => check.status === "failed");
    for (const executableCheck of contract.executableChecks ?? []) {
      if (executableSafety.get(executableCheck.id)) {
        continue;
      }
      if (!executeCommands) {
        checks.push({
          id: `executable:${executableCheck.id}`,
          kind: "executable",
          status: "skipped",
          message: "Executable check requires explicit executeCommands opt-in.",
        });
      } else if (staticFailure) {
        checks.push({
          id: `executable:${executableCheck.id}`,
          kind: "executable",
          status: "skipped",
          message: "Executable check was not run because static validation failed.",
        });
      } else {
        checks.push(await slRunExecutableCheck(root, executableCheck));
      }
    }
  }

  const result: SLEvaluationResult = {
    schemaVersion: 1,
    artifactId: target.artifactId,
    artifactType: target.artifactType,
    artifactPath: normalizedArtifactPath,
    contractPath,
    status: checks.some((check) => check.status === "failed")
      ? "failed"
      : "passed",
    executableChecksRequested: executeCommands,
    checks,
    ...(contract ? { contract } : {}),
  };
  return result;
}

export async function slEvaluate(
  root: string,
  artifactId: string,
  options: SLEvaluateOptions = {},
): Promise<SLEvaluationResult> {
  const registry = await slLoadRegistry(root);
  const artifact = slFindArtifact(registry, artifactId);
  if (
    artifact.classification !== "promoted" ||
    !["probation", "active", "promoted"].includes(artifact.status) ||
    (artifact.artifactType !== "instruction" &&
      artifact.artifactType !== "skill") ||
    !artifact.path
  ) {
    throw new Error(
      `Artifact ${artifactId} is not a registered promoted instruction or skill.`,
    );
  }
  const content = await slReadContainedText(root, artifact.path);
  const frontmatter = slParseMarkdown<Record<string, unknown>>(
    content,
  ).frontmatter;
  return slEvaluateValidationContract(
    root,
    {
      artifactId: artifact.id,
      artifactPath: artifact.promotionTargetPath ?? artifact.path,
      contentPath: artifact.path,
      artifactType: artifact.artifactType,
      sourceIds: artifact.dependsOn ?? [],
      ...(typeof frontmatter.validationContract === "string"
        ? { contractPath: frontmatter.validationContract }
        : {}),
      frontmatter,
      expectedStatus: artifact.status as "probation" | "active" | "promoted",
    },
    options,
  );
}

export function slPromotedContractTarget(
  artifact: SLRegistryArtifact,
  frontmatter: Record<string, unknown>,
): SLValidationContractTarget | undefined {
  if (
    artifact.classification !== "promoted" ||
    !["probation", "active", "promoted"].includes(artifact.status) ||
    (artifact.artifactType !== "instruction" &&
      artifact.artifactType !== "skill") ||
    !artifact.path
  ) {
    return undefined;
  }
  if (
    artifact.status === "promoted" &&
    typeof frontmatter.validationContract !== "string"
  ) {
    return undefined;
  }
  return {
    artifactId: artifact.id,
    artifactPath: artifact.promotionTargetPath ?? artifact.path,
    contentPath: artifact.path,
    artifactType: artifact.artifactType,
    sourceIds: artifact.dependsOn ?? [],
    ...(typeof frontmatter.validationContract === "string"
      ? { contractPath: frontmatter.validationContract }
      : {}),
    frontmatter,
    expectedStatus: artifact.status as "probation" | "active" | "promoted",
  };
}
