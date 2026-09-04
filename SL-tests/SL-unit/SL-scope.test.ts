import { describe, expect, test } from "vitest";
import {
  SL_DEFAULT_SCOPE_CATALOG,
  SLScopeAmbiguityError,
  SLScopeResolver,
  slNormalizeRepositoryPath,
  slValidateScopeCatalog,
} from "../../SL-src/SL-core/SL-scope.js";
import type {
  SLScopeCatalog,
  SLScopeDefinition,
} from "../../SL-src/SL-core/SL-types.js";

const ROOT_SCOPE: SLScopeDefinition = {
  id: "SL-SCOPE-ROOT",
  displayName: "Repository",
  kind: "repository",
  includePaths: ["**"],
  excludePaths: [],
  dependencyScopeIds: [],
  ownerAliases: ["@example/platform"],
};

function createCatalog(scopes: SLScopeDefinition[]): SLScopeCatalog {
  return {
    schemaVersion: 1,
    scopes: [ROOT_SCOPE, ...scopes],
  };
}

describe("SL hierarchical scopes", () => {
  test("uses one backward-compatible root scope by default", () => {
    const resolver = new SLScopeResolver(SL_DEFAULT_SCOPE_CATALOG);
    const resolution = resolver.resolvePath("C:\\repo", "src\\file.ts");

    expect(resolution).toMatchObject({
      normalizedPath: "src/file.ts",
      primaryScopeId: "SL-SCOPE-ROOT",
      orderedScopeIds: ["SL-SCOPE-ROOT"],
    });
    expect(
      resolver.resolveCurrentDirectory("C:\\repo", "C:\\repo"),
    ).toMatchObject({
      normalizedPath: "",
      primaryScopeId: "SL-SCOPE-ROOT",
    });
  });

  test.each([
    ["C:\\repo", "services\\orders\\file.ts", "services/orders/file.ts"],
    ["/repo", "services/orders/file.ts", "services/orders/file.ts"],
    ["C:\\repo", "C:\\repo\\services\\orders\\file.ts", "services/orders/file.ts"],
    ["/repo", "/repo/services/orders/file.ts", "services/orders/file.ts"],
  ])(
    "normalizes repository-contained Windows and POSIX paths",
    (root, input, expected) => {
      expect(slNormalizeRepositoryPath(root, input)).toBe(expected);
    },
  );

  test.each([
    ["C:\\repo", "..\\secret.txt"],
    ["/repo", "../secret.txt"],
    ["C:\\repo", "D:\\secret.txt"],
    ["/repo", "/outside/secret.txt"],
  ])("rejects path escape: %s %s", (root, input) => {
    expect(() => slNormalizeRepositoryPath(root, input)).toThrow();
  });

  test("resolves specificity, excludes, dependencies, and ancestors", () => {
    const catalog = createCatalog([
      {
        id: "SL-SCOPE-SHARED",
        displayName: "Shared",
        kind: "shared",
        includePaths: ["shared/**"],
        excludePaths: [],
        parentScopeId: "SL-SCOPE-ROOT",
        dependencyScopeIds: [],
        ownerAliases: ["@example/platform"],
      },
      {
        id: "SL-SCOPE-ORDERS",
        displayName: "Orders service",
        kind: "service",
        includePaths: ["services/orders/**"],
        excludePaths: ["services/orders/generated/**"],
        parentScopeId: "SL-SCOPE-ROOT",
        dependencyScopeIds: ["SL-SCOPE-SHARED"],
        ownerAliases: ["@example/orders"],
      },
      {
        id: "SL-SCOPE-ORDERS-API",
        displayName: "Orders API package",
        kind: "package",
        includePaths: ["services/orders/packages/api/**"],
        excludePaths: [],
        parentScopeId: "SL-SCOPE-ORDERS",
        dependencyScopeIds: ["SL-SCOPE-SHARED"],
        ownerAliases: ["@example/orders"],
      },
    ]);
    const resolver = new SLScopeResolver(catalog);

    expect(
      resolver.resolvePath(
        "/repo",
        "services/orders/packages/api/src/handler.ts",
      ).orderedScopeIds,
    ).toEqual([
      "SL-SCOPE-ORDERS-API",
      "SL-SCOPE-SHARED",
      "SL-SCOPE-ORDERS",
      "SL-SCOPE-ROOT",
    ]);
    expect(
      resolver.resolvePath("/repo", "services/orders/generated/client.ts")
        .primaryScopeId,
    ).toBe("SL-SCOPE-ROOT");
  });

  test("rejects equal-precedence overlap unless priority resolves the tie", () => {
    const left: SLScopeDefinition = {
      id: "SL-SCOPE-LEFT",
      displayName: "Left",
      kind: "library",
      includePaths: ["libraries/common/**"],
      excludePaths: [],
      parentScopeId: "SL-SCOPE-ROOT",
      dependencyScopeIds: [],
      ownerAliases: ["@example/left"],
    };
    const right: SLScopeDefinition = {
      ...left,
      id: "SL-SCOPE-RIGHT",
      displayName: "Right",
      ownerAliases: ["@example/right"],
    };

    expect(() =>
      new SLScopeResolver(createCatalog([left, right])).resolvePath(
        "/repo",
        "libraries/common/file.ts",
      ),
    ).toThrow(SLScopeAmbiguityError);

    const resolution = new SLScopeResolver(
      createCatalog([left, { ...right, priority: 1 }]),
    ).resolvePath("/repo", "libraries/common/file.ts");
    expect(resolution.primaryScopeId).toBe("SL-SCOPE-RIGHT");
  });

  test("resolves changed paths deterministically without treating separate primaries as ambiguous", () => {
    const catalog = createCatalog([
      {
        id: "SL-SCOPE-SERVICE",
        displayName: "Service",
        kind: "service",
        includePaths: ["services/**"],
        excludePaths: [],
        parentScopeId: "SL-SCOPE-ROOT",
        dependencyScopeIds: [],
        ownerAliases: ["@example/service"],
      },
      {
        id: "SL-SCOPE-LIBRARY",
        displayName: "Library",
        kind: "library",
        includePaths: ["libraries/**"],
        excludePaths: [],
        parentScopeId: "SL-SCOPE-ROOT",
        dependencyScopeIds: [],
        ownerAliases: ["@example/library"],
      },
    ]);

    expect(
      new SLScopeResolver(catalog).resolveChangedPaths("/repo", [
        "services/a.ts",
        "libraries/b.ts",
      ]),
    ).toMatchObject({
      primaryScopeIds: ["SL-SCOPE-SERVICE", "SL-SCOPE-LIBRARY"],
      orderedScopeIds: [
        "SL-SCOPE-SERVICE",
        "SL-SCOPE-LIBRARY",
        "SL-SCOPE-ROOT",
      ],
    });
  });

  test("keeps dependency closure, deepest ancestors, and root ordering deterministic", () => {
    const scopes: SLScopeDefinition[] = [
      {
        id: "SL-SCOPE-SHARED",
        displayName: "Shared",
        kind: "shared",
        includePaths: ["packages/shared/**"],
        excludePaths: [],
        parentScopeId: "SL-SCOPE-ROOT",
        dependencyScopeIds: [],
        ownerAliases: ["@example/shared"],
      },
      {
        id: "SL-SCOPE-LIBRARY",
        displayName: "Library",
        kind: "library",
        includePaths: ["packages/shared/common/**"],
        excludePaths: [],
        parentScopeId: "SL-SCOPE-SHARED",
        dependencyScopeIds: [],
        ownerAliases: ["@example/library"],
      },
      {
        id: "SL-SCOPE-SOLUTION",
        displayName: "Solution",
        kind: "solution",
        includePaths: ["services/orders/**"],
        excludePaths: [],
        parentScopeId: "SL-SCOPE-ROOT",
        dependencyScopeIds: ["SL-SCOPE-LIBRARY"],
        ownerAliases: ["@example/orders"],
      },
      {
        id: "SL-SCOPE-SERVICE",
        displayName: "Service",
        kind: "service",
        includePaths: ["services/orders/src/**"],
        excludePaths: ["services/orders/src/generated/**"],
        parentScopeId: "SL-SCOPE-SOLUTION",
        dependencyScopeIds: ["SL-SCOPE-LIBRARY"],
        ownerAliases: ["@example/orders-api"],
      },
    ];
    const forward = new SLScopeResolver(createCatalog(scopes));
    const reverse = new SLScopeResolver(createCatalog([...scopes].reverse()));

    expect(
      reverse.resolvePath("/repo", "services/orders/src/order.ts"),
    ).toEqual(
      forward.resolvePath("/repo", "services/orders/src/order.ts"),
    );
    expect(
      forward.resolvePath("/repo", "services/orders/src/order.ts")
        .orderedScopeIds,
    ).toEqual([
      "SL-SCOPE-SERVICE",
      "SL-SCOPE-LIBRARY",
      "SL-SCOPE-SHARED",
      "SL-SCOPE-SOLUTION",
      "SL-SCOPE-ROOT",
    ]);
    expect(
      forward.resolvePath(
        "/repo",
        "services/orders/src/generated/client.ts",
      ).primaryScopeId,
    ).toBe("SL-SCOPE-SOLUTION");
  });

  test.each([
    ["C:\\repo", "C:\\repo\\services\\api", "services/api"],
    ["/repo", "/repo/services/api", "services/api"],
    ["/repo", "services\\api", "services/api"],
  ])(
    "resolves current directory consistently across separators",
    (root, currentDirectory, normalizedPath) => {
      const resolver = new SLScopeResolver(
        createCatalog([
          {
            id: "SL-SCOPE-API",
            displayName: "API",
            kind: "service",
            includePaths: ["services/api", "services/api/**"],
            excludePaths: [],
            parentScopeId: "SL-SCOPE-ROOT",
            dependencyScopeIds: [],
            ownerAliases: ["@example/api"],
          },
        ]),
      );

      expect(
        resolver.resolveCurrentDirectory(root, currentDirectory),
      ).toMatchObject({
        normalizedPath,
        primaryScopeId: "SL-SCOPE-API",
        orderedScopeIds: ["SL-SCOPE-API", "SL-SCOPE-ROOT"],
      });
    },
  );

  test("reports structural, relationship, ownership, and matchability failures", () => {
    const invalidCatalog = createCatalog([
      {
        id: "SL-SCOPE-BROKEN",
        displayName: "Broken",
        kind: "solution",
        includePaths: ["services/**"],
        excludePaths: ["services/**"],
        parentScopeId: "SL-SCOPE-MISSING",
        dependencyScopeIds: ["SL-SCOPE-UNKNOWN"],
        ownerAliases: ["platform-team"],
      },
      {
        id: "SL-SCOPE-CYCLE-A",
        displayName: "Cycle A",
        kind: "service",
        includePaths: ["a/**"],
        excludePaths: [],
        parentScopeId: "SL-SCOPE-CYCLE-B",
        dependencyScopeIds: [],
        ownerAliases: [],
      },
      {
        id: "SL-SCOPE-CYCLE-B",
        displayName: "Cycle B",
        kind: "package",
        includePaths: ["b/**"],
        excludePaths: [],
        parentScopeId: "SL-SCOPE-CYCLE-A",
        dependencyScopeIds: [],
        ownerAliases: [],
      },
      {
        id: "SL-SCOPE-BROKEN",
        displayName: "Duplicate broken",
        kind: "library",
        includePaths: ["duplicate/**"],
        excludePaths: [],
        parentScopeId: "SL-SCOPE-ROOT",
        dependencyScopeIds: [],
        ownerAliases: [],
      },
    ]);

    expect(slValidateScopeCatalog(invalidCatalog).map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "unmatchable-scope",
        "missing-parent-scope",
        "missing-dependency-scope",
        "invalid-owner-alias",
        "duplicate-scope-id",
        "scope-cycle",
      ]),
    );
  });
});
