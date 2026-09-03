import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { SL_PATHS } from "./SL-constants.js";
import {
  slAssertRealPathInside,
  slResolveInside,
} from "./SL-utils.js";

export const SL_REPOSITORY_MUTATION_LOCK_PATH =
  `${SL_PATHS.learningRoot}/.SL-repository-mutation.lock`;
export const SL_REPOSITORY_MUTATION_LOCK_OWNER =
  `${SL_REPOSITORY_MUTATION_LOCK_PATH}/SL-owner.json`;

const SL_MUTATION_LOCK_STALE_MS = 120_000;
const SL_MUTATION_LOCK_TIMEOUT_MS = 30_000;
const SL_MUTATION_LOCK_RETRY_MS = 25;
const SL_MUTATION_LOCK_RELEASE_RETRY_MS = 1_000;

interface SLMutationLockOwner {
  schemaVersion: 1;
  token: string;
  pid: number;
  hostname: string;
  acquiredAt: string;
}

interface SLMutationLockSnapshot {
  mtimeMs: number;
  owner?: SLMutationLockOwner;
}

export interface SLMutationLockOptions {
  dryRun?: boolean;
  staleMs?: number;
  timeoutMs?: number;
  retryMs?: number;
}

function slValidOwner(value: unknown): value is SLMutationLockOwner {
  if (!value || typeof value !== "object") {
    return false;
  }
  const owner = value as Partial<SLMutationLockOwner>;
  return (
    owner.schemaVersion === 1 &&
    typeof owner.token === "string" &&
    owner.token.length > 0 &&
    typeof owner.pid === "number" &&
    Number.isSafeInteger(owner.pid) &&
    owner.pid > 0 &&
    typeof owner.hostname === "string" &&
    owner.hostname.length > 0 &&
    typeof owner.acquiredAt === "string" &&
    !Number.isNaN(new Date(owner.acquiredAt).getTime())
  );
}

async function slReadLockOwner(
  ownerPath: string,
): Promise<SLMutationLockOwner | undefined> {
  try {
    const value = JSON.parse(await readFile(ownerPath, "utf8")) as unknown;
    return slValidOwner(value) ? value : undefined;
  } catch (error) {
    if (
      ["ENOENT", "EISDIR"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      ) ||
      error instanceof SyntaxError
    ) {
      return undefined;
    }
    throw error;
  }
}

function slProcessIsAlive(pid: number): boolean {
  if (pid === process.pid) {
    return true;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM") {
      return true;
    }
    if (code === "ESRCH" || code === "EINVAL") {
      return false;
    }
    return true;
  }
}

async function slReadLockSnapshot(
  lockPath: string,
  ownerPath: string,
): Promise<SLMutationLockSnapshot | undefined> {
  try {
    const lockInfo = await stat(lockPath);
    const owner = await slReadLockOwner(ownerPath);
    return {
      mtimeMs: lockInfo.mtimeMs,
      ...(owner ? { owner } : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function slSameLockSnapshot(
  left: SLMutationLockSnapshot,
  right: SLMutationLockSnapshot,
): boolean {
  return (
    left.mtimeMs === right.mtimeMs &&
    left.owner?.token === right.owner?.token
  );
}

function slLockLeaseIsFresh(
  snapshot: SLMutationLockSnapshot,
  staleMs: number,
): boolean {
  return Date.now() - snapshot.mtimeMs < staleMs;
}

function slLockOwnerIsLiveLocally(
  owner: SLMutationLockOwner | undefined,
): boolean {
  return owner?.hostname === hostname() && slProcessIsAlive(owner.pid);
}

async function slRestoreRenamedLock(
  renamedPath: string,
  lockPath: string,
): Promise<void> {
  try {
    await rename(renamedPath, lockPath);
  } catch (error) {
    if (
      !["EEXIST", "ENOENT", "ENOTEMPTY"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    ) {
      throw error;
    }
  }
}

async function slTryReclaimStaleMutationLock(
  root: string,
  staleMs: number,
): Promise<boolean> {
  const lockPath = slResolveInside(root, SL_REPOSITORY_MUTATION_LOCK_PATH);
  const ownerPath = slResolveInside(root, SL_REPOSITORY_MUTATION_LOCK_OWNER);
  const observed = await slReadLockSnapshot(lockPath, ownerPath);
  if (!observed) {
    return true;
  }
  if (
    slLockLeaseIsFresh(observed, staleMs) ||
    slLockOwnerIsLiveLocally(observed.owner)
  ) {
    return false;
  }

  const revalidated = await slReadLockSnapshot(lockPath, ownerPath);
  if (!revalidated) {
    return true;
  }
  if (
    !slSameLockSnapshot(observed, revalidated) ||
    slLockLeaseIsFresh(revalidated, staleMs) ||
    slLockOwnerIsLiveLocally(revalidated.owner)
  ) {
    return false;
  }

  const renamedPath = `${lockPath}.SL-stale-${randomUUID()}`;
  try {
    await rename(lockPath, renamedPath);
  } catch (error) {
    if (
      ["ENOENT", "EACCES", "EPERM"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    ) {
      return false;
    }
    throw error;
  }
  const renamedOwnerPath = `${renamedPath}/SL-owner.json`;
  const renamed = await slReadLockSnapshot(renamedPath, renamedOwnerPath);
  if (
    !renamed ||
    !slSameLockSnapshot(revalidated, renamed) ||
    slLockLeaseIsFresh(renamed, staleMs) ||
    slLockOwnerIsLiveLocally(renamed.owner)
  ) {
    await slRestoreRenamedLock(renamedPath, lockPath);
    return false;
  }

  await rm(renamedPath, { recursive: true, force: true });
  return true;
}

async function slRemoveOwnedMutationLock(
  root: string,
  token: string,
): Promise<void> {
  const lockPath = slResolveInside(root, SL_REPOSITORY_MUTATION_LOCK_PATH);
  const ownerPath = slResolveInside(root, SL_REPOSITORY_MUTATION_LOCK_OWNER);
  const owner = await slReadLockOwner(ownerPath);
  if (owner?.token !== token) {
    return;
  }

  const releasePath = `${lockPath}.SL-release-${token}-${randomUUID()}`;
  const releaseDeadline = Date.now() + SL_MUTATION_LOCK_RELEASE_RETRY_MS;
  while (true) {
    try {
      await rename(lockPath, releasePath);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return;
      }
      if (
        process.platform === "win32" &&
        ["EACCES", "EBUSY", "EPERM"].includes(code ?? "") &&
        Date.now() < releaseDeadline
      ) {
        await delay(SL_MUTATION_LOCK_RETRY_MS);
        continue;
      }
      throw error;
    }
  }

  const releasedOwner = await slReadLockOwner(
    `${releasePath}/SL-owner.json`,
  );
  if (releasedOwner?.token !== token) {
    await slRestoreRenamedLock(releasePath, lockPath);
    return;
  }
  await rm(releasePath, { recursive: true, force: true });
}

async function slRefreshOwnedMutationLock(
  lockPath: string,
  ownerPath: string,
  token: string,
): Promise<void> {
  const owner = await slReadLockOwner(ownerPath);
  if (owner?.token !== token) {
    return;
  }
  const now = new Date();
  await utimes(lockPath, now, now).catch(() => undefined);
}

export async function slWithRepositoryMutationLock<T>(
  root: string,
  operation: () => Promise<T>,
  options: SLMutationLockOptions = {},
): Promise<T> {
  if (options.dryRun) {
    return operation();
  }
  const staleMs = options.staleMs ?? SL_MUTATION_LOCK_STALE_MS;
  const timeoutMs = options.timeoutMs ?? SL_MUTATION_LOCK_TIMEOUT_MS;
  const retryMs = options.retryMs ?? SL_MUTATION_LOCK_RETRY_MS;
  if (staleMs <= 0 || timeoutMs <= 0 || retryMs <= 0) {
    throw new Error("SL mutation lock timing values must be positive.");
  }

  await slAssertRealPathInside(root, SL_REPOSITORY_MUTATION_LOCK_PATH);
  const lockPath = slResolveInside(root, SL_REPOSITORY_MUTATION_LOCK_PATH);
  const ownerPath = slResolveInside(root, SL_REPOSITORY_MUTATION_LOCK_OWNER);
  await mkdir(slResolveInside(root, SL_PATHS.learningRoot), {
    recursive: true,
  });

  const token = randomUUID();
  const owner: SLMutationLockOwner = {
    schemaVersion: 1,
    token,
    pid: process.pid,
    hostname: hostname(),
    acquiredAt: new Date().toISOString(),
  };
  const deadline = Date.now() + timeoutMs;
  let acquired = false;

  for (let attempt = 0; Date.now() < deadline; attempt += 1) {
    try {
      await mkdir(lockPath);
      try {
        await writeFile(
          ownerPath,
          `${JSON.stringify(owner, null, 2)}\n`,
          { encoding: "utf8", flag: "wx" },
        );
      } catch (error) {
        const failedPath = `${lockPath}.SL-failed-${token}-${randomUUID()}`;
        await rename(lockPath, failedPath).catch(() => undefined);
        await rm(failedPath, { recursive: true, force: true }).catch(
          () => undefined,
        );
        throw error;
      }
      acquired = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      if (await slTryReclaimStaleMutationLock(root, staleMs)) {
        continue;
      }
      await delay(Math.min(retryMs * (attempt + 1), 250));
    }
  }

  if (!acquired) {
    throw new Error(
      `Timed out waiting for SL repository mutation lock: ${SL_REPOSITORY_MUTATION_LOCK_PATH}`,
    );
  }
  const heartbeat = setInterval(() => {
    void slRefreshOwnedMutationLock(lockPath, ownerPath, token).catch(
      () => undefined,
    );
  }, Math.max(10, Math.floor(staleMs / 3)));
  heartbeat.unref();

  try {
    return await operation();
  } finally {
    clearInterval(heartbeat);
    await slRemoveOwnedMutationLock(root, token);
  }
}
