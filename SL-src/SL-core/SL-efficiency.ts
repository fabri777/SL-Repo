import { slLoadRegistry } from "./SL-registry.js";
import { slLoadResourceReceipts } from "./SL-resource.js";
import { SL_DEFAULT_SCOPE, slNormalizeScope, slScopeKey } from "./SL-state.js";
import type {
  SLApplicationResourceReceipt,
  SLEfficiencyReport,
  SLEfficiencySegment,
  SLEfficiencySegmentKey,
  SLPromotionLineageResourceReport,
  SLResourceAverage,
  SLResourceBreakEven,
  SLResourceLineageCost,
  SLResourceMetricValues,
  SLResourcePairIncompatibility,
  SLResourcePairSavings,
  SLResourceQuality,
  SLResourceReceipt,
  SLResourceSummary,
  SLUsageEvent,
} from "./SL-types.js";
import { slLoadUsageEvents } from "./SL-usage.js";
import { slCanonicalJson, slCompareOrdinal } from "./SL-utils.js";

export interface SLEfficiencyFilters {
  artifactId?: string;
  scopeId?: string;
  provider?: string;
  modelId?: string;
  quality?: SLResourceQuality;
}

function slEmptyMetricValues(): SLResourceMetricValues {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    wallClockDurationMs: 0,
    modelDurationMs: 0,
    toolDurationMs: 0,
    attemptCount: 0,
    reportedCosts: {},
  };
}

function slDecimalToScaled(value: string): bigint {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const scaled = BigInt(`${whole}${fraction.padEnd(12, "0")}`);
  return negative ? -scaled : scaled;
}

function slScaledToDecimal(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const digits = absolute.toString().padStart(13, "0");
  const whole = digits.slice(0, -12);
  const fraction = digits.slice(-12).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function slDivideScaled(value: bigint, divisor: number): bigint {
  if (divisor < 1) {
    throw new Error("Resource metric divisor must be positive.");
  }
  const bigintDivisor = BigInt(divisor);
  const quotient = value / bigintDivisor;
  const remainder = value % bigintDivisor;
  if (remainder === 0n) {
    return quotient;
  }
  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  if (absoluteRemainder * 2n < bigintDivisor) {
    return quotient;
  }
  return quotient + (value < 0n ? -1n : 1n);
}

function slReceiptMetricValues(
  receipt: SLResourceReceipt,
): SLResourceMetricValues {
  const totalTokens =
    receipt.tokens.input +
    receipt.tokens.output +
    (receipt.tokens.cacheRead ?? 0) +
    (receipt.tokens.cacheWrite ?? 0) +
    (receipt.tokens.reasoning ?? 0);
  return {
    inputTokens: receipt.tokens.input,
    outputTokens: receipt.tokens.output,
    cacheReadTokens: receipt.tokens.cacheRead ?? 0,
    cacheWriteTokens: receipt.tokens.cacheWrite ?? 0,
    reasoningTokens: receipt.tokens.reasoning ?? 0,
    totalTokens,
    wallClockDurationMs: receipt.wallClockDurationMs,
    modelDurationMs: receipt.modelDurationMs ?? 0,
    toolDurationMs: receipt.toolDurationMs ?? 0,
    attemptCount: receipt.attemptCount ?? 1,
    reportedCosts: receipt.reportedCost
      ? {
          [receipt.reportedCost.currency]: receipt.reportedCost.amount,
        }
      : {},
  };
}

function slAddMetricValues(
  left: SLResourceMetricValues,
  right: SLResourceMetricValues,
): SLResourceMetricValues {
  const reportedCosts = { ...left.reportedCosts };
  for (const [currency, amount] of Object.entries(right.reportedCosts)) {
    reportedCosts[currency] = slScaledToDecimal(
      slDecimalToScaled(reportedCosts[currency] ?? "0") +
        slDecimalToScaled(amount),
    );
  }
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    wallClockDurationMs:
      left.wallClockDurationMs + right.wallClockDurationMs,
    modelDurationMs: left.modelDurationMs + right.modelDurationMs,
    toolDurationMs: left.toolDurationMs + right.toolDurationMs,
    attemptCount: left.attemptCount + right.attemptCount,
    reportedCosts,
  };
}

function slSubtractMetricValues(
  baseline: SLResourceMetricValues,
  treatment: SLResourceMetricValues,
): SLResourceMetricValues {
  const reportedCosts: Record<string, string> = {};
  for (const currency of Object.keys(baseline.reportedCosts)) {
    const treatmentAmount = treatment.reportedCosts[currency];
    if (treatmentAmount === undefined) {
      continue;
    }
    reportedCosts[currency] = slScaledToDecimal(
      slDecimalToScaled(baseline.reportedCosts[currency]!) -
        slDecimalToScaled(treatmentAmount),
    );
  }
  return {
    inputTokens: baseline.inputTokens - treatment.inputTokens,
    outputTokens: baseline.outputTokens - treatment.outputTokens,
    cacheReadTokens:
      baseline.cacheReadTokens - treatment.cacheReadTokens,
    cacheWriteTokens:
      baseline.cacheWriteTokens - treatment.cacheWriteTokens,
    reasoningTokens: baseline.reasoningTokens - treatment.reasoningTokens,
    totalTokens: baseline.totalTokens - treatment.totalTokens,
    wallClockDurationMs:
      baseline.wallClockDurationMs - treatment.wallClockDurationMs,
    modelDurationMs:
      baseline.modelDurationMs - treatment.modelDurationMs,
    toolDurationMs: baseline.toolDurationMs - treatment.toolDurationMs,
    attemptCount: baseline.attemptCount - treatment.attemptCount,
    reportedCosts,
  };
}

export function slSummarizeResourceReceipts(
  receipts: SLResourceReceipt[],
): SLResourceSummary {
  let values = slEmptyMetricValues();
  const reportedCostReceiptCounts: Record<string, number> = {};
  for (const receipt of receipts) {
    values = slAddMetricValues(values, slReceiptMetricValues(receipt));
    if (receipt.reportedCost) {
      reportedCostReceiptCounts[receipt.reportedCost.currency] =
        (reportedCostReceiptCounts[receipt.reportedCost.currency] ?? 0) + 1;
    }
  }
  return {
    receiptCount: receipts.length,
    ...values,
    reportedCostReceiptCounts,
  };
}

function slAverageSummary(
  summary: SLResourceSummary,
  divisor: number,
): SLResourceAverage | null {
  if (divisor === 0) {
    return null;
  }
  const reportedCosts: Record<string, string> = {};
  for (const [currency, amount] of Object.entries(summary.reportedCosts)) {
    const costDivisor = summary.reportedCostReceiptCounts[currency] ?? divisor;
    reportedCosts[currency] = slScaledToDecimal(
      slDivideScaled(slDecimalToScaled(amount), costDivisor),
    );
  }
  return {
    sampleCount: divisor,
    inputTokens: summary.inputTokens / divisor,
    outputTokens: summary.outputTokens / divisor,
    cacheReadTokens: summary.cacheReadTokens / divisor,
    cacheWriteTokens: summary.cacheWriteTokens / divisor,
    reasoningTokens: summary.reasoningTokens / divisor,
    totalTokens: summary.totalTokens / divisor,
    wallClockDurationMs: summary.wallClockDurationMs / divisor,
    modelDurationMs: summary.modelDurationMs / divisor,
    toolDurationMs: summary.toolDurationMs / divisor,
    attemptCount: summary.attemptCount / divisor,
    reportedCosts,
    reportedCostSampleCounts: Object.fromEntries(
      Object.keys(reportedCosts).map((currency) => [
        currency,
        summary.reportedCostReceiptCounts[currency] ?? divisor,
      ]),
    ),
  };
}

function slAmortizeSummary(
  summary: SLResourceSummary,
  verifiedSuccessCount: number,
): SLResourceAverage | null {
  if (verifiedSuccessCount === 0 || summary.receiptCount === 0) {
    return null;
  }
  const reportedCosts = Object.fromEntries(
    Object.entries(summary.reportedCosts).map(([currency, amount]) => [
      currency,
      slScaledToDecimal(
        slDivideScaled(
          slDecimalToScaled(amount),
          verifiedSuccessCount,
        ),
      ),
    ]),
  );
  return {
    sampleCount: verifiedSuccessCount,
    inputTokens: summary.inputTokens / verifiedSuccessCount,
    outputTokens: summary.outputTokens / verifiedSuccessCount,
    cacheReadTokens: summary.cacheReadTokens / verifiedSuccessCount,
    cacheWriteTokens: summary.cacheWriteTokens / verifiedSuccessCount,
    reasoningTokens: summary.reasoningTokens / verifiedSuccessCount,
    totalTokens: summary.totalTokens / verifiedSuccessCount,
    wallClockDurationMs:
      summary.wallClockDurationMs / verifiedSuccessCount,
    modelDurationMs: summary.modelDurationMs / verifiedSuccessCount,
    toolDurationMs: summary.toolDurationMs / verifiedSuccessCount,
    attemptCount: summary.attemptCount / verifiedSuccessCount,
    reportedCosts,
    reportedCostSampleCounts: Object.fromEntries(
      Object.keys(reportedCosts).map((currency) => [
        currency,
        verifiedSuccessCount,
      ]),
    ),
  };
}

function slAddAverages(
  application: SLResourceAverage | null,
  amortizedGeneration: SLResourceAverage | null,
): SLResourceMetricValues | null {
  if (!application) {
    return null;
  }
  const applicationValues: SLResourceMetricValues = {
    inputTokens: application.inputTokens,
    outputTokens: application.outputTokens,
    cacheReadTokens: application.cacheReadTokens,
    cacheWriteTokens: application.cacheWriteTokens,
    reasoningTokens: application.reasoningTokens,
    totalTokens: application.totalTokens,
    wallClockDurationMs: application.wallClockDurationMs,
    modelDurationMs: application.modelDurationMs,
    toolDurationMs: application.toolDurationMs,
    attemptCount: application.attemptCount,
    reportedCosts: application.reportedCosts,
  };
  if (!amortizedGeneration) {
    return applicationValues;
  }
  return slAddMetricValues(applicationValues, amortizedGeneration);
}

function slMedian(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function slMedianScaled(values: string[]): string {
  const sorted = values
    .map(slDecimalToScaled)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? slScaledToDecimal(sorted[middle]!)
    : slScaledToDecimal(
        slDivideScaled(sorted[middle - 1]! + sorted[middle]!, 2),
      );
}

function slMedianSavings(
  pairs: SLResourcePairSavings[],
): SLResourceMetricValues | null {
  if (pairs.length === 0) {
    return null;
  }
  const currencies = new Set(
    pairs.flatMap((pair) => Object.keys(pair.savings.reportedCosts)),
  );
  const reportedCosts: Record<string, string> = {};
  for (const currency of [...currencies].sort(slCompareOrdinal)) {
    const values = pairs
      .map((pair) => pair.savings.reportedCosts[currency])
      .filter((value): value is string => value !== undefined);
    if (values.length > 0) {
      reportedCosts[currency] = slMedianScaled(values);
    }
  }
  return {
    inputTokens: slMedian(pairs.map((pair) => pair.savings.inputTokens)),
    outputTokens: slMedian(pairs.map((pair) => pair.savings.outputTokens)),
    cacheReadTokens: slMedian(
      pairs.map((pair) => pair.savings.cacheReadTokens),
    ),
    cacheWriteTokens: slMedian(
      pairs.map((pair) => pair.savings.cacheWriteTokens),
    ),
    reasoningTokens: slMedian(
      pairs.map((pair) => pair.savings.reasoningTokens),
    ),
    totalTokens: slMedian(pairs.map((pair) => pair.savings.totalTokens)),
    wallClockDurationMs: slMedian(
      pairs.map((pair) => pair.savings.wallClockDurationMs),
    ),
    modelDurationMs: slMedian(
      pairs.map((pair) => pair.savings.modelDurationMs),
    ),
    toolDurationMs: slMedian(
      pairs.map((pair) => pair.savings.toolDurationMs),
    ),
    attemptCount: slMedian(pairs.map((pair) => pair.savings.attemptCount)),
    reportedCosts,
  };
}

function slBreakEvenValue(
  generation: number,
  medianSavings: number,
): number | null {
  return medianSavings > 0 ? Math.ceil(generation / medianSavings) : null;
}

function slBreakEven(
  generation: SLResourceSummary,
  medianSavings: SLResourceMetricValues | null,
): SLResourceBreakEven | null {
  if (!medianSavings || generation.receiptCount === 0) {
    return null;
  }
  const reportedCosts: Record<string, number | null> = {};
  for (const [currency, amount] of Object.entries(
    medianSavings.reportedCosts,
  )) {
    const savings = slDecimalToScaled(amount);
    const generationCost = generation.reportedCosts[currency];
    reportedCosts[currency] =
      savings > 0n && generationCost !== undefined
        ? Number(
            (slDecimalToScaled(generationCost) + savings - 1n) / savings,
          )
        : null;
  }
  const result: SLResourceBreakEven = {
    inputTokens: slBreakEvenValue(
      generation.inputTokens,
      medianSavings.inputTokens,
    ),
    outputTokens: slBreakEvenValue(
      generation.outputTokens,
      medianSavings.outputTokens,
    ),
    cacheReadTokens: slBreakEvenValue(
      generation.cacheReadTokens,
      medianSavings.cacheReadTokens,
    ),
    cacheWriteTokens: slBreakEvenValue(
      generation.cacheWriteTokens,
      medianSavings.cacheWriteTokens,
    ),
    reasoningTokens: slBreakEvenValue(
      generation.reasoningTokens,
      medianSavings.reasoningTokens,
    ),
    totalTokens: slBreakEvenValue(
      generation.totalTokens,
      medianSavings.totalTokens,
    ),
    wallClockDurationMs: slBreakEvenValue(
      generation.wallClockDurationMs,
      medianSavings.wallClockDurationMs,
    ),
    modelDurationMs: slBreakEvenValue(
      generation.modelDurationMs,
      medianSavings.modelDurationMs,
    ),
    toolDurationMs: slBreakEvenValue(
      generation.toolDurationMs,
      medianSavings.toolDurationMs,
    ),
    attemptCount: slBreakEvenValue(
      generation.attemptCount,
      medianSavings.attemptCount,
    ),
    reportedCosts,
  };
  return [
    result.inputTokens,
    result.outputTokens,
    result.cacheReadTokens,
    result.cacheWriteTokens,
    result.reasoningTokens,
    result.totalTokens,
    result.wallClockDurationMs,
    result.modelDurationMs,
    result.toolDurationMs,
    result.attemptCount,
    ...Object.values(result.reportedCosts),
  ].some((value) => value !== null)
    ? result
    : null;
}

function slSuccessApplicationKey(
  event: Extract<SLUsageEvent, { eventType: "usage" }>,
): string {
  return [
    slScopeKey(event.scope ?? SL_DEFAULT_SCOPE),
    event.artifactId,
    event.artifactVersion,
    event.applicationId,
  ].join("\0");
}

function slVerifiedSuccessApplications(
  events: SLUsageEvent[],
): Set<string> {
  return new Set(
    events
      .filter(
        (
          event,
        ): event is Extract<SLUsageEvent, { eventType: "usage" }> =>
          event.eventType === "usage" &&
          event.stage === "verified" &&
          event.outcome === "success",
      )
      .map(slSuccessApplicationKey),
  );
}

function slReceiptApplicationKey(
  receipt: SLApplicationResourceReceipt,
): string {
  return [
    slScopeKey(receipt.scope),
    receipt.artifactId,
    receipt.artifactVersion,
    receipt.applicationId,
  ].join("\0");
}

function slSegmentIdentity(key: SLEfficiencySegmentKey): string {
  return slCanonicalJson(key);
}

function slSegmentKey(
  receipt: Exclude<SLResourceReceipt, { phase: "baseline" }>,
): SLEfficiencySegmentKey {
  return {
    scope: slNormalizeScope(receipt.scope),
    artifactId: receipt.artifactId,
    artifactVersion: receipt.artifactVersion,
    provider: receipt.provider,
    modelId: receipt.modelId,
    quality: receipt.quality,
  };
}

function slMatchesSegment(
  receipt: Exclude<SLResourceReceipt, { phase: "baseline" }>,
  key: SLEfficiencySegmentKey,
): boolean {
  return slSegmentIdentity(slSegmentKey(receipt)) === slSegmentIdentity(key);
}

function slCompatiblePair(
  treatment: SLApplicationResourceReceipt,
  baselines: Extract<SLResourceReceipt, { phase: "baseline" }>[],
  treatmentCount: number,
): {
  pair?: SLResourcePairSavings;
  incompatibility?: SLResourcePairIncompatibility;
} {
  const comparisonId = treatment.comparison!.comparisonId;
  const common = {
    comparisonId,
    treatmentReceiptId: treatment.receiptId,
  };
  if (treatmentCount !== 1) {
    return {
      incompatibility: {
        ...common,
        reason: "ambiguous-treatment",
      },
    };
  }
  if (baselines.length === 0) {
    return {
      incompatibility: {
        ...common,
        reason: "missing-baseline",
      },
    };
  }
  if (baselines.length !== 1) {
    return {
      incompatibility: {
        ...common,
        reason: "ambiguous-baseline",
      },
    };
  }
  const baseline = baselines[0]!;
  if (baseline.comparison.scenarioKey !== treatment.comparison!.scenarioKey) {
    return {
      incompatibility: {
        ...common,
        reason: "scenario-mismatch",
      },
    };
  }
  if (slScopeKey(baseline.scope) !== slScopeKey(treatment.scope)) {
    return {
      incompatibility: {
        ...common,
        reason: "scope-mismatch",
      },
    };
  }
  if (baseline.quality !== treatment.quality) {
    return {
      incompatibility: {
        ...common,
        reason: "quality-mismatch",
      },
    };
  }
  return {
    pair: {
      comparisonId,
      scenarioKey: treatment.comparison!.scenarioKey,
      baselineReceiptId: baseline.receiptId,
      treatmentReceiptId: treatment.receiptId,
      savings: slSubtractMetricValues(
        slReceiptMetricValues(baseline),
        slReceiptMetricValues(treatment),
      ),
    },
  };
}

function slResourceFilterMatches(
  receipt: Exclude<SLResourceReceipt, { phase: "baseline" }>,
  filters: SLEfficiencyFilters,
  includeArtifact: boolean,
): boolean {
  return (
    (!includeArtifact ||
      !filters.artifactId ||
      receipt.artifactId === filters.artifactId) &&
    (!filters.scopeId || receipt.scope.id === filters.scopeId) &&
    (!filters.provider || receipt.provider === filters.provider) &&
    (!filters.modelId || receipt.modelId === filters.modelId) &&
    (!filters.quality || receipt.quality === filters.quality)
  );
}

function slCreateSegment(
  key: SLEfficiencySegmentKey,
  receipts: SLResourceReceipt[],
  successes: Set<string>,
  baselinesByComparison: Map<
    string,
    Extract<SLResourceReceipt, { phase: "baseline" }>[]
  >,
  treatmentsByComparison: Map<string, number>,
  pairedBaselineIds: Set<string>,
): SLEfficiencySegment {
  const generationReceipts = receipts.filter(
    (
      receipt,
    ): receipt is Extract<SLResourceReceipt, { phase: "generation" }> =>
      receipt.phase === "generation" && slMatchesSegment(receipt, key),
  );
  const successfulApplicationReceipts = receipts.filter(
    (receipt): receipt is SLApplicationResourceReceipt =>
      receipt.phase === "application" &&
      slMatchesSegment(receipt, key) &&
      successes.has(slReceiptApplicationKey(receipt)),
  );
  const successPrefix = [
    slScopeKey(key.scope),
    key.artifactId,
    key.artifactVersion,
    "",
  ].join("\0");
  const eligibleCount = [...successes].filter((application) =>
    application.startsWith(successPrefix),
  ).length;
  const generationTotals = slSummarizeResourceReceipts(generationReceipts);
  const applicationTotals = slSummarizeResourceReceipts(
    successfulApplicationReceipts,
  );
  const applicationAverage = slAverageSummary(
    applicationTotals,
    successfulApplicationReceipts.length,
  );
  const amortizedGeneration = slAmortizeSummary(
    generationTotals,
    eligibleCount,
  );
  const pairSavings: SLResourcePairSavings[] = [];
  const incompatibilities: SLResourcePairIncompatibility[] = [];
  for (const treatment of successfulApplicationReceipts.filter(
    (receipt) => receipt.comparison !== undefined,
  )) {
    const result = slCompatiblePair(
      treatment,
      baselinesByComparison.get(treatment.comparison!.comparisonId) ?? [],
      treatmentsByComparison.get(treatment.comparison!.comparisonId) ?? 0,
    );
    if (result.pair) {
      pairSavings.push(result.pair);
      pairedBaselineIds.add(result.pair.baselineReceiptId);
    } else if (result.incompatibility) {
      incompatibilities.push(result.incompatibility);
    }
  }
  pairSavings.sort((left, right) =>
    slCompareOrdinal(left.comparisonId, right.comparisonId),
  );
  incompatibilities.sort((left, right) =>
    slCompareOrdinal(
      `${left.comparisonId}\0${left.treatmentReceiptId}`,
      `${right.comparisonId}\0${right.treatmentReceiptId}`,
    ),
  );
  const medianSavings = slMedianSavings(pairSavings);
  return {
    key,
    generation: {
      totals: generationTotals,
      amortizedPerVerifiedSuccess: amortizedGeneration,
    },
    verifiedSuccessApplications: {
      eligibleCount,
      receiptCount: successfulApplicationReceipts.length,
      coverage:
        eligibleCount === 0
          ? null
          : successfulApplicationReceipts.length / eligibleCount,
      average: applicationAverage,
      averageWithAmortizedGeneration: slAddAverages(
        applicationAverage,
        amortizedGeneration,
      ),
    },
    pairedBaseline: {
      compatiblePairCount: pairSavings.length,
      incompatiblePairCount: incompatibilities.length,
      pairSavings,
      incompatibilities,
      medianSavings,
      breakEvenApplications: slBreakEven(
        generationTotals,
        medianSavings,
      ),
    },
  };
}

function slLineageCost(
  receipts: Exclude<SLResourceReceipt, { phase: "baseline" }>[],
): SLResourceLineageCost {
  const generation = slSummarizeResourceReceipts(
    receipts.filter((receipt) => receipt.phase === "generation"),
  );
  const application = slSummarizeResourceReceipts(
    receipts.filter((receipt) => receipt.phase === "application"),
  );
  const grouped = new Map<
    string,
    {
      key: SLEfficiencySegmentKey & {
        phase: "generation" | "application";
      };
      receipts: Exclude<SLResourceReceipt, { phase: "baseline" }>[];
    }
  >();
  for (const receipt of receipts) {
    const key = {
      ...slSegmentKey(receipt),
      phase: receipt.phase,
    };
    const identity = slCanonicalJson(key);
    const group = grouped.get(identity) ?? { key, receipts: [] };
    group.receipts.push(receipt);
    grouped.set(identity, group);
  }
  return {
    generation,
    application,
    combined: slSummarizeResourceReceipts(receipts),
    segments: [...grouped.values()]
      .map((group) => ({
        key: group.key,
        totals: slSummarizeResourceReceipts(group.receipts),
      }))
      .sort((left, right) =>
        slCompareOrdinal(
          slCanonicalJson(left.key),
          slCanonicalJson(right.key),
        ),
      ),
  };
}

function slPromotionLineageReports(
  receipts: SLResourceReceipt[],
  registry: Awaited<ReturnType<typeof slLoadRegistry>>,
  filters: SLEfficiencyFilters,
): SLPromotionLineageResourceReport[] {
  const filtered = receipts.filter(
    (
      receipt,
    ): receipt is Exclude<SLResourceReceipt, { phase: "baseline" }> =>
      receipt.phase !== "baseline" &&
      slResourceFilterMatches(receipt, filters, false),
  );
  return registry.artifacts
    .filter(
      (artifact) =>
        artifact.classification === "promoted" &&
        (!filters.artifactId || artifact.id === filters.artifactId),
    )
    .map((artifact) => {
      const sourceArtifactIds = [...(artifact.dependsOn ?? [])].sort(
        slCompareOrdinal,
      );
      const directReceipts = filtered.filter(
        (receipt) => receipt.artifactId === artifact.id,
      );
      const sourceReceipts = filtered.filter((receipt) =>
        sourceArtifactIds.includes(receipt.artifactId),
      );
      return {
        artifactId: artifact.id,
        directArtifactIds: [artifact.id],
        sourceArtifactIds,
        direct: slLineageCost(directReceipts),
        source: slLineageCost(sourceReceipts),
        combined: slLineageCost([
          ...directReceipts,
          ...sourceReceipts,
        ]),
      };
    })
    .sort((left, right) =>
      slCompareOrdinal(left.artifactId, right.artifactId),
    );
}

export async function slCalculateEfficiencyReport(
  root: string,
  filters: SLEfficiencyFilters = {},
): Promise<SLEfficiencyReport> {
  const [receipts, events, registry] = await Promise.all([
    slLoadResourceReceipts(root),
    slLoadUsageEvents(root),
    slLoadRegistry(root),
  ]);
  const successes = slVerifiedSuccessApplications(events);
  const baselines = receipts.filter(
    (
      receipt,
    ): receipt is Extract<SLResourceReceipt, { phase: "baseline" }> =>
      receipt.phase === "baseline",
  );
  const selectedTreatments = receipts.filter(
    (receipt): receipt is SLApplicationResourceReceipt =>
      receipt.phase === "application" &&
      receipt.comparison !== undefined &&
      slResourceFilterMatches(receipt, filters, true) &&
      successes.has(slReceiptApplicationKey(receipt)),
  );
  const allSuccessfulTreatments = receipts.filter(
    (receipt): receipt is SLApplicationResourceReceipt =>
      receipt.phase === "application" &&
      receipt.comparison !== undefined &&
      successes.has(slReceiptApplicationKey(receipt)),
  );
  const selectedComparisonIds = new Set(
    selectedTreatments.map(
      (receipt) => receipt.comparison!.comparisonId,
    ),
  );
  const relevantBaselines =
    Object.keys(filters).length === 0
      ? baselines
      : baselines.filter((baseline) =>
          selectedComparisonIds.has(baseline.comparison.comparisonId),
        );
  const baselinesByComparison = new Map<string, typeof baselines>();
  for (const baseline of relevantBaselines) {
    const comparisonId = baseline.comparison.comparisonId;
    const entries = baselinesByComparison.get(comparisonId) ?? [];
    entries.push(baseline);
    baselinesByComparison.set(comparisonId, entries);
  }
  const treatmentsByComparison = new Map<string, number>();
  for (const treatment of allSuccessfulTreatments) {
    const comparisonId = treatment.comparison!.comparisonId;
    treatmentsByComparison.set(
      comparisonId,
      (treatmentsByComparison.get(comparisonId) ?? 0) + 1,
    );
  }
  const segmentKeys = new Map<string, SLEfficiencySegmentKey>();
  for (const receipt of receipts) {
    if (
      receipt.phase === "baseline" ||
      !slResourceFilterMatches(receipt, filters, true)
    ) {
      continue;
    }
    const key = slSegmentKey(receipt);
    segmentKeys.set(slSegmentIdentity(key), key);
  }
  const pairedBaselineIds = new Set<string>();
  const segments = [...segmentKeys.values()]
    .map((key) =>
      slCreateSegment(
        key,
        receipts,
        successes,
        baselinesByComparison,
        treatmentsByComparison,
        pairedBaselineIds,
      ),
    )
    .sort((left, right) =>
      slCompareOrdinal(
        slSegmentIdentity(left.key),
        slSegmentIdentity(right.key),
      ),
    );
  return {
    schemaVersion: 1,
    advisory: true,
    filters,
    baselineReceiptCount: relevantBaselines.length,
    unpairedBaselineCount: relevantBaselines.filter(
      (baseline) => !pairedBaselineIds.has(baseline.receiptId),
    ).length,
    segments,
    promotionLineage: slPromotionLineageReports(
      receipts,
      registry,
      filters,
    ),
  };
}
