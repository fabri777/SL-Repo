import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { slCaptureLesson } from "../../SL-src/SL-core/SL-capture.js";
import {
  slParseMarkdown,
  slStringifyMarkdown,
} from "../../SL-src/SL-core/SL-frontmatter.js";
import { slRetrieveArtifacts } from "../../SL-src/SL-core/SL-retrieval.js";
import {
  slLoadRegistry,
  slSaveRegistry,
} from "../../SL-src/SL-core/SL-registry.js";
import { slScopeDescriptor } from "../../SL-src/SL-core/SL-scope.js";
import {
  slAggregateUsageByScope,
  slAggregateUsageRepository,
  slCreateUsageEvent,
  slFinishUsage,
  slProjectUsage,
  slProjectUsageEvents,
  slStartUsage,
} from "../../SL-src/SL-core/SL-usage.js";
import {
  slForgetArtifact,
  slSweep,
} from "../../SL-src/SL-forgetting/SL-forgetting.js";
import { slValidateRepository } from "../../SL-src/SL-validation/SL-validation.js";
import {
  SL_MONOREPO_SCOPES,
  slCreateMonorepoFixture,
} from "../SL-fixtures/SL-monorepo-fixture.js";
import { slRemoveTestRepository } from "../SL-fixtures/SL-test-repository.js";

const repositories: string[] = [];
const MONOREPO_TEST_TIMEOUT_MS =
  process.platform === "win32" ? 90_000 : 60_000;

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(slRemoveTestRepository));
});

describe("SL adversarial monorepo fixture", () => {
  test(
    "validates realistic local, dependency, ancestor, root, override, and inactive behavior",
    async () => {
      const fixture = await slCreateMonorepoFixture();
      repositories.push(fixture.root);

      expect(
        (await slValidateRepository(fixture.root)).filter(
          (issue) => issue.severity === "error",
        ),
      ).toEqual([]);

      const orders = await slRetrieveArtifacts(
        fixture.root,
        "services\\orders\\src\\order.ts",
      );
      expect(orders.orderedScopeIds).toEqual([
        SL_MONOREPO_SCOPES.ordersService.id,
        SL_MONOREPO_SCOPES.commonLibrary.id,
        SL_MONOREPO_SCOPES.ordersSolution.id,
        SL_MONOREPO_SCOPES.shared.id,
        SL_MONOREPO_SCOPES.root.id,
      ]);
      expect(orders.artifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: fixture.artifacts.ordersLesson.id,
            relation: "local",
          }),
          expect.objectContaining({
            id: fixture.artifacts.sharedLesson.id,
            relation: "dependency",
          }),
          expect.objectContaining({
            id: fixture.artifacts.ordersPromotion.id,
            relation: "local",
            provenance: [fixture.artifacts.ordersLesson.id],
          }),
          expect.objectContaining({
            id: fixture.artifacts.rootPromotion.id,
            relation: "root",
            provenance: [fixture.artifacts.sharedLesson.id],
          }),
          expect.objectContaining({
            id: fixture.artifacts.rootLesson.id,
            relation: "root",
          }),
        ]),
      );
      expect(
        orders.artifacts.some(
          (artifact) => artifact.id === fixture.artifacts.inactiveLesson.id,
        ),
      ).toBe(false);

      const billing = await slRetrieveArtifacts(
        fixture.root,
        "services/billing/src/invoice.ts",
      );
      expect(
        billing.artifacts.some(
          (artifact) => artifact.id === fixture.artifacts.ordersPromotion.id,
        ),
      ).toBe(false);
      expect(
        billing.artifacts.some(
          (artifact) => artifact.id === fixture.artifacts.rootPromotion.id,
        ),
      ).toBe(true);

      const generated = JSON.parse(
        await readFile(
          join(
            fixture.root,
            ".github",
            "SL-learning",
            "SL-scope-catalog.json",
          ),
          "utf8",
        ),
      );
      expect(generated.scopes).toHaveLength(7);
      expect(
        (
          await slRetrieveArtifacts(
            fixture.root,
            "services/orders/src/generated/client.ts",
          )
        ).primaryScopeId,
      ).toBe(SL_MONOREPO_SCOPES.ordersSolution.id);
    },
    MONOREPO_TEST_TIMEOUT_MS,
  );

  test(
    "keeps scoped success rates local and repository aggregation counts-only",
    async () => {
      const fixture = await slCreateMonorepoFixture();
      repositories.push(fixture.root);

      const shared = await slProjectUsage(
        fixture.root,
        fixture.artifacts.sharedLesson.id,
      );
      const byScope = slAggregateUsageByScope(shared);
      expect(byScope).toEqual([
        expect.objectContaining({
          scope: {
            id: SL_MONOREPO_SCOPES.billingService.id,
            path: "services/billing",
          },
          verifiedSuccessRate: 1,
        }),
        expect.objectContaining({
          scope: {
            id: SL_MONOREPO_SCOPES.ordersService.id,
            path: "services/orders",
          },
          verifiedSuccessRate: 1,
        }),
      ]);
      expect(slAggregateUsageRepository(shared)).toMatchObject({
        aggregation: "repository-counts-only",
        scopeCount: 2,
        verifiedSuccessCount: 2,
        verifiedFailureCount: 0,
        successRate: null,
        successRateReason: "rates-are-reported-per-scope",
      });
    },
    MONOREPO_TEST_TIMEOUT_MS,
  );

  test(
    "uses verified success in a consuming scope to return stale guidance to probation",
    async () => {
      const fixture = await slCreateMonorepoFixture();
      repositories.push(fixture.root);
      const started = await slStartUsage(
        fixture.root,
        fixture.artifacts.ordersPromotion.id,
        {
          applicationId: "cross-scope-reactivation",
          taskRunId: "cross-scope-reactivation-task",
          idempotencyKey: "cross-scope-reactivation-start",
          scope: slScopeDescriptor(
            SL_MONOREPO_SCOPES.billingService,
          ),
          now: new Date("2026-09-04T14:00:00.000Z"),
        },
      );

      await slSweep(
        fixture.root,
        false,
        new Date("2027-09-05T00:00:00.000Z"),
      );
      await slFinishUsage(fixture.root, started.receiptId, {
        outcome: "success",
        verified: true,
        verifierType: "test-suite",
        evidenceRef: "ci:cross-scope-reactivation",
        idempotencyKey: "cross-scope-reactivation-finish",
        now: new Date("2027-09-06T00:00:00.000Z"),
      });

      const artifact = (await slLoadRegistry(fixture.root)).artifacts.find(
        (candidate) =>
          candidate.id === fixture.artifacts.ordersPromotion.id,
      );
      expect(artifact).toMatchObject({
        status: "probation",
        lastSuccessfulUseAt: "2027-09-06T00:00:00.000Z",
      });
      expect(artifact?.path).toContain(
        `.github/SL-learning/SL-probation/${fixture.artifacts.ordersPromotion.id}/`,
      );
      expect(artifact?.usageProjection).toBeUndefined();
      expect(
        await slProjectUsage(
          fixture.root,
          fixture.artifacts.ordersPromotion.id,
        ),
      ).toEqual([
        expect.objectContaining({
          scope: {
            id: SL_MONOREPO_SCOPES.billingService.id,
            path: "services/billing",
          },
          verifiedSuccessRate: 1,
        }),
      ]);
    },
    MONOREPO_TEST_TIMEOUT_MS,
  );

  test(
    "fails retrieval closed when legacy and governed active guidance contradict",
    async () => {
      const fixture = await slCreateMonorepoFixture();
      repositories.push(fixture.root);
      const registry = await slLoadRegistry(fixture.root);
      const legacy = registry.artifacts.find(
        (artifact) => artifact.id === fixture.artifacts.rootPromotion.id,
      )!;
      const content = await readFile(
        join(fixture.root, ...legacy.path!.split("/")),
        "utf8",
      );
      const markdown = slParseMarkdown<Record<string, unknown>>(content);
      markdown.frontmatter.status = "promoted";
      await writeFile(
        join(fixture.root, ...legacy.path!.split("/")),
        slStringifyMarkdown(markdown.frontmatter, markdown.body),
        "utf8",
      );
      legacy.status = "promoted";
      delete legacy.promotionEvaluation;
      await slSaveRegistry(fixture.root, registry, false, []);

      await expect(
        slRetrieveArtifacts(
          fixture.root,
          "services/orders/src/order.ts",
        ),
      ).rejects.toThrow(
        "Unresolved legacy/governed retrieval conflict",
      );
    },
    MONOREPO_TEST_TIMEOUT_MS,
  );

  test("rejects application identity replay across scopes and artifacts", async () => {
    const fixture = await slCreateMonorepoFixture();
    repositories.push(fixture.root);
    const applicationId = "cross-scope-replay";
    await slStartUsage(fixture.root, fixture.artifacts.ordersLesson.id, {
      applicationId,
      taskRunId: "cross-scope-task",
      idempotencyKey: "cross-scope-start",
      scope: {
        id: SL_MONOREPO_SCOPES.ordersService.id,
        path: "services/orders",
      },
      now: new Date("2026-09-04T13:00:00.000Z"),
    });

    await expect(
      slStartUsage(fixture.root, fixture.artifacts.ordersLesson.id, {
        applicationId,
        taskRunId: "cross-scope-task",
        idempotencyKey: "cross-scope-start",
        scope: {
          id: SL_MONOREPO_SCOPES.billingService.id,
          path: "services/billing",
        },
        now: new Date("2026-09-04T13:00:00.000Z"),
      }),
    ).rejects.toThrow("already bound to different usage identity data");
    await expect(
      slStartUsage(fixture.root, fixture.artifacts.billingLesson.id, {
        applicationId,
        taskRunId: "cross-scope-task",
        idempotencyKey: "cross-artifact-start",
        scope: {
          id: SL_MONOREPO_SCOPES.ordersService.id,
          path: "services/orders",
        },
        now: new Date("2026-09-04T13:00:00.000Z"),
      }),
    ).rejects.toThrow("already bound to different usage identity data");
  }, MONOREPO_TEST_TIMEOUT_MS);

  test("projects independently merged immutable shards deterministically", () => {
    const hash = "a".repeat(64);
    const events = [
      slCreateUsageEvent({
        artifactId: "SL-SHARED-LESSON",
        artifactContentHash: hash,
        taskRunId: "orders-task",
        applicationId: "orders-application",
        stage: "verified",
        outcome: "success",
        verifierType: "test-suite",
        timestamp: "2026-09-04T12:00:00.000Z",
        idempotencyKey: "orders-shard",
        scope: {
          id: SL_MONOREPO_SCOPES.ordersService.id,
          path: "services/orders",
        },
      }),
      slCreateUsageEvent({
        artifactId: "SL-SHARED-LESSON",
        artifactContentHash: hash,
        taskRunId: "billing-task",
        applicationId: "billing-application",
        stage: "verified",
        outcome: "failure",
        verifierType: "test-suite",
        timestamp: "2026-09-04T12:01:00.000Z",
        idempotencyKey: "billing-shard",
        scope: {
          id: SL_MONOREPO_SCOPES.billingService.id,
          path: "services/billing",
        },
      }),
    ];

    expect(slProjectUsageEvents([...events].reverse())).toEqual(
      slProjectUsageEvents(events),
    );
  });

  test(
    "protects cross-scope promotion dependencies and diagnoses orphaned shards",
    async () => {
      const fixture = await slCreateMonorepoFixture();
      repositories.push(fixture.root);

      await expect(
        slForgetArtifact(
          fixture.root,
          fixture.artifacts.sharedLesson.id,
          "irrelevant",
          false,
          new Date("2026-09-04T14:00:00.000Z"),
        ),
      ).rejects.toThrow("active dependent");

      const catalogPath = join(
        fixture.root,
        ".github",
        "SL-learning",
        "SL-scope-catalog.json",
      );
      const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
      catalog.scopes = catalog.scopes.filter(
        (scope: { id: string }) =>
          scope.id !== SL_MONOREPO_SCOPES.billingService.id,
      );
      await writeFile(
        catalogPath,
        `${JSON.stringify(catalog, null, 2)}\n`,
        "utf8",
      );

      const codes = (await slValidateRepository(fixture.root)).map(
        (issue) => issue.code,
      );
      expect(codes).toEqual(
        expect.arrayContaining([
          "artifact-scope-invalid",
          "scope-state-orphan",
          "usage-event-scope",
        ]),
      );
    },
    MONOREPO_TEST_TIMEOUT_MS,
  );

  test("capture dry run cannot create inferred scope state", async () => {
    const fixture = await slCreateMonorepoFixture();
    repositories.push(fixture.root);
    const before = await readFile(
      join(
        fixture.root,
        ".github",
        "SL-learning",
        "SL-state-catalog.json",
      ),
      "utf8",
    );

    await slCaptureLesson(fixture.root, {
      title: "Dry run inferred capture",
      kind: "win",
      scope: "orders",
      triggers: ["dry-run"],
      targetPath: "services/orders/src/order.ts",
      dryRun: true,
      now: new Date("2026-09-04T15:00:00.000Z"),
    });

    expect(
      await readFile(
        join(
          fixture.root,
          ".github",
          "SL-learning",
          "SL-state-catalog.json",
        ),
        "utf8",
      ),
    ).toBe(before);
    await expect(
      readFile(
        join(
          fixture.root,
          ".github",
          "SL-learning",
          "SL-lessons",
          "SL-20260904-DRY-RUN-INFERRED-CAPTURE.md",
        ),
        "utf8",
      ),
    ).rejects.toThrow();
  }, MONOREPO_TEST_TIMEOUT_MS);
});
