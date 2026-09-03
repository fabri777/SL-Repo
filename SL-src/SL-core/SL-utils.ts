import {
  access,
  mkdir,
  open,
  realpath,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { SLChange } from "./SL-types.js";

export function slNormalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function slResolveInside(root: string, relativePath: string): string {
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, relativePath);
  const relativeValue = relative(absoluteRoot, absolutePath);
  if (
    relativeValue === ".." ||
    relativeValue.startsWith(`..${sep}`) ||
    isAbsolute(relativeValue)
  ) {
    throw new Error(`Path escapes repository root: ${relativePath}`);
  }
  return absolutePath;
}

export async function slAssertRealPathInside(
  root: string,
  relativePath: string,
): Promise<void> {
  const absoluteRoot = resolve(root);
  const realRoot = await realpath(absoluteRoot);
  const target = slResolveInside(absoluteRoot, relativePath);
  let existingAncestor = target;
  while (!(await slExists(existingAncestor))) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) {
      throw new Error(`Unable to resolve an existing ancestor for ${relativePath}`);
    }
    existingAncestor = parent;
  }
  const realAncestor = await realpath(existingAncestor);
  const relativeValue = relative(realRoot, realAncestor);
  if (
    relativeValue === ".." ||
    relativeValue.startsWith(`..${sep}`) ||
    isAbsolute(relativeValue)
  ) {
    throw new Error(`Path resolves outside repository root: ${relativePath}`);
  }
}

export async function slExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function slReadText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function slReadContainedText(
  root: string,
  relativePath: string,
): Promise<string> {
  await slAssertRealPathInside(root, relativePath);
  return slReadText(slResolveInside(root, relativePath));
}

export async function slReadJson<T>(path: string): Promise<T> {
  return JSON.parse(await slReadText(path)) as T;
}

export function slCanonicalJson(value: unknown): string {
  function canonicalize(entry: unknown): unknown {
    if (Array.isArray(entry)) {
      return entry.map(canonicalize);
    }
    if (entry !== null && typeof entry === "object") {
      return Object.fromEntries(
        Object.entries(entry as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, canonicalize(child)]),
      );
    }
    return entry;
  }

  return JSON.stringify(canonicalize(value));
}

export async function slWriteText(
  root: string,
  relativePath: string,
  content: string,
  dryRun: boolean,
  changes: SLChange[],
): Promise<void> {
  const absolutePath = slResolveInside(root, relativePath);
  await slAssertRealPathInside(root, relativePath);
  const normalizedContent = content.replaceAll("\r\n", "\n");
  const exists = await slExists(absolutePath);
  if (exists && (await slReadText(absolutePath)) === normalizedContent) {
    changes.push({ action: "skip", path: relativePath, detail: "already current" });
    return;
  }

  changes.push({
    action: exists ? "update" : "create",
    path: relativePath,
    detail: dryRun ? "planned" : "written",
  });
  if (dryRun) {
    return;
  }

  await mkdir(dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.SL-tmp-${randomUUID()}`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, "wx");
    await handle.writeFile(normalizedContent, "utf8");
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, absolutePath);
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function slWriteJson(
  root: string,
  relativePath: string,
  value: unknown,
  dryRun: boolean,
  changes: SLChange[],
): Promise<void> {
  await slWriteText(
    root,
    relativePath,
    `${JSON.stringify(value, null, 2)}\n`,
    dryRun,
    changes,
  );
}

export async function slMove(
  root: string,
  sourceRelativePath: string,
  targetRelativePath: string,
  dryRun: boolean,
  changes: SLChange[],
): Promise<void> {
  const source = slResolveInside(root, sourceRelativePath);
  const target = slResolveInside(root, targetRelativePath);
  await slAssertRealPathInside(root, sourceRelativePath);
  await slAssertRealPathInside(root, targetRelativePath);
  if (!(await slExists(source))) {
    throw new Error(`Cannot move missing artifact: ${sourceRelativePath}`);
  }
  if (await slExists(target)) {
    throw new Error(`Cannot overwrite quarantine artifact: ${targetRelativePath}`);
  }

  changes.push({
    action: "move",
    path: sourceRelativePath,
    detail: `${sourceRelativePath} -> ${targetRelativePath}`,
  });
  if (dryRun) {
    return;
  }

  await mkdir(dirname(target), { recursive: true });
  await rename(source, target);
}

export async function slDelete(
  root: string,
  relativePath: string,
  dryRun: boolean,
  changes: SLChange[],
): Promise<void> {
  const absolutePath = slResolveInside(root, relativePath);
  await slAssertRealPathInside(root, relativePath);
  if (!(await slExists(absolutePath))) {
    throw new Error(`Cannot delete missing artifact: ${relativePath}`);
  }
  const info = await stat(absolutePath);
  if (!info.isFile()) {
    throw new Error(`Refusing to delete non-file artifact: ${relativePath}`);
  }

  changes.push({ action: "delete", path: relativePath, detail: "retention elapsed" });
  if (!dryRun) {
    await rm(absolutePath);
  }
}

export function slSlugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50)
    .replace(/-+$/, "");
}

export function slDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function slAddDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}

export function slAgeDays(now: Date, timestamp: string): number {
  return Math.floor((now.getTime() - new Date(timestamp).getTime()) / 86_400_000);
}

export function slPrintChanges(changes: SLChange[]): void {
  for (const change of changes) {
    console.log(`${change.action.toUpperCase().padEnd(6)} ${change.path} - ${change.detail}`);
  }
}
