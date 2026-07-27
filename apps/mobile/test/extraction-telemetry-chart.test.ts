import { describe, expect, test } from "bun:test";

describe("extraction telemetry chart presentation", () => {
  test("uses one stable surface for temperature history and weighted traces", async () => {
    const source = await Bun.file(
      new URL(
        "../components/extraction-telemetry-chart.tsx",
        import.meta.url,
      ),
    ).text();

    expect(source).toContain('mode: "temperature-history"');
    expect(source).toContain('mode: "weighted-trace"');
    expect(source).toContain("<TelemetrySurface");
    expect(source).toContain("function TemperatureHistoryChart");
    expect(source).toContain("function WeightedTraceChart");
    expect(source).toContain("const height = compact ? 250 : 330");
    expect(source).toContain("<SharedGrid");
  });

  test("keeps unavailable history telemetry explicit instead of synthesizing it", async () => {
    const source = await Bun.file(
      new URL(
        "../components/extraction-telemetry-chart.tsx",
        import.meta.url,
      ),
    ).text();

    expect(source).toContain(
      "scale?.netWeightDecigrams ?? scale?.grossWeightDecigrams ?? null",
    );
    expect(source).toContain('translate("scale.telemetryTraceUnavailable")');
    expect(source).toContain(
      'translate("scale.telemetryWeightTraceUnavailable")',
    );
    expect(source).toContain("value: \"—\"");
    expect(source).not.toContain("derivedFlowGPerS: 0");
  });

  test("retains paged history follow, inspection, gaps, and activity context", async () => {
    const source = await Bun.file(
      new URL(
        "../components/extraction-telemetry-chart.tsx",
        import.meta.url,
      ),
    ).text();

    expect(source).toContain("temperatureHistoryWindows(history)");
    expect(source).toContain("isLatestHistoryPageOffset(");
    expect(source).toContain("isTemperatureHistoryGap(");
    expect(source).toContain("pagingEnabled");
    expect(source).toContain("scrollToEnd({ animated: false })");
    expect(source).toContain("onInspect(nearest.recordedAtMs)");
    expect(source).toContain("heaterRects");
    expect(source).toContain("pumpRects");
  });
});
