import { describe, expect, test } from "bun:test";

const source = await Bun.file(
  new URL("../components/temperature-history-chart.tsx", import.meta.url),
).text();

describe("temperature history chart", () => {
  test("draws its chrome and geometry from the shared telemetry modules", () => {
    expect(source).toContain('from "@/components/telemetry-surface"');
    expect(source).toContain("<TelemetrySurface");
    expect(source).toContain("<TelemetryGrid");
    expect(source).toContain("temperatureHistoryPlot({");
    expect(source).toContain("bandCount: bands");
    expect(source).not.toContain("function historyGeometry(");
  });

  test("keeps paged follow, inspection and activity context", () => {
    expect(source).toContain("temperatureHistoryWindows(history)");
    expect(source).toContain("isLatestHistoryPageOffset(");
    expect(source).toContain("pagingEnabled");
    expect(source).toContain("scrollToEnd({ animated: false })");
    expect(source).toContain("onInspect(nearest.recordedAtMs)");
    expect(source).toContain("plot.heaterRects");
    expect(source).toContain("plot.pumpRects");
  });

  test("plots no weight or flow series of its own", () => {
    expect(source).not.toContain("weightPaths");
    expect(source).not.toContain("flowAreas");
    expect(source).not.toContain("derivedFlowGPerS");
    expect(source).not.toContain("cutoffY");
  });

  test("only mentions unavailable weight and flow while a lower band exists", () => {
    // The single-band Dashboard chart must not claim anything about weight or
    // flow; the two-band console fallback still labels them unavailable.
    for (const marker of [
      'translate("scale.telemetryTraceUnavailable")',
      'translate("scale.telemetryWeightTraceUnavailable")',
      'translate("scale.telemetryFlowUnavailable")',
    ]) {
      const index = source.indexOf(marker);
      expect(index).toBeGreaterThan(-1);
      expect(source.slice(0, index)).toContain("bands === 1");
    }
    expect(source).toContain("currentScaleWeightDecigrams(scale)");
  });
});
