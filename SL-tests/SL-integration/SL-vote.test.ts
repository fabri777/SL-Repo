import { afterEach, describe, expect, test } from "vitest";
import { slCaptureLesson } from "../../SL-src/SL-core/SL-capture.js";
import { slInstall } from "../../SL-src/SL-core/SL-installer.js";
import { slLoadRegistry } from "../../SL-src/SL-core/SL-registry.js";
import { slVoteOnLesson } from "../../SL-src/SL-core/SL-vote.js";
import {
  slCreateTestRepository,
  slRemoveTestRepository,
} from "../SL-fixtures/SL-test-repository.js";

const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(slRemoveTestRepository));
});

describe("SL reuse voting", () => {
  test("promotes repeatedly useful evidence to a promotion candidate", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const lesson = await slCaptureLesson(root, {
      title: "Reusable hard-won outcome",
      kind: "win",
      scope: "tests",
      triggers: ["hard-won outcome"],
      dryRun: false,
      now: new Date("2026-09-03T08:00:00.000Z"),
    });

    await slVoteOnLesson(
      root,
      lesson.id,
      "useful",
      false,
      new Date("2026-09-03T09:00:00.000Z"),
    );
    await slVoteOnLesson(
      root,
      lesson.id,
      "useful",
      false,
      new Date("2026-09-03T10:00:00.000Z"),
    );
    await slVoteOnLesson(
      root,
      lesson.id,
      "useful",
      false,
      new Date("2026-09-03T11:00:00.000Z"),
    );

    const registry = await slLoadRegistry(root);
    expect(
      registry.artifacts.find((artifact) => artifact.id === lesson.id),
    ).toMatchObject({
      status: "promotion-candidate",
      hits: 3,
      retrievals: 3,
      notUsefulVotes: 0,
      lastSuccessfulUseAt: "2026-09-03T11:00:00.000Z",
    });
  });

  test("records an unhelpful retrieval without extending successful reuse", async () => {
    const root = await slCreateTestRepository();
    repositories.push(root);
    await slInstall(root, "init", false);
    const lesson = await slCaptureLesson(root, {
      title: "Unhelpful retrieved lesson",
      kind: "pitfall",
      scope: "tests",
      triggers: ["unhelpful lesson"],
      dryRun: false,
      now: new Date("2026-09-03T08:00:00.000Z"),
    });

    await slVoteOnLesson(
      root,
      lesson.id,
      "not-useful",
      false,
      new Date("2026-09-03T09:00:00.000Z"),
    );

    const registry = await slLoadRegistry(root);
    const artifact = registry.artifacts.find(
      (candidate) => candidate.id === lesson.id,
    );
    expect(artifact).toMatchObject({
      status: "raw",
      hits: 0,
      retrievals: 1,
      notUsefulVotes: 1,
    });
    expect(artifact?.lastSuccessfulUseAt).toBeUndefined();
  });
});
