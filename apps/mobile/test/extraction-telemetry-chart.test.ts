import { describe, expect, test } from "bun:test";

const source = await Bun.file(
  new URL("../components/extraction-telemetry-chart.tsx", import.meta.url),
).text();

describe("weighted extraction trace chart", () => {
  test("draws its chrome from the shared telemetry surface", () => {
    expect(source).toContain('from "@/components/telemetry-surface"');
    expect(source).toContain("<TelemetrySurface");
    expect(source).toContain("<TelemetryGrid");
    expect(source).not.toContain("function TelemetrySurface(");
    expect(source).not.toContain("function SharedGrid(");
  });

  test("takes its geometry and height from the shared telemetry modules", () => {
    expect(source).toContain("extractionTelemetryPlot({");
    expect(source).toContain("telemetryChartHeight(variant, compact)");
    expect(source).not.toContain("function baseGeometry(");
    expect(source).not.toContain("function weightedTraceGeometry(");
  });

  test("plots temperature, weight and flow as distinct live series", () => {
    expect(source).toContain("plot.temperaturePaths");
    expect(source).toContain("plot.weightPaths");
    expect(source).toContain("plot.flowAreas");
    expect(source).toContain("plot.flowPaths");
    expect(source).toContain("<SeriesAxisLabels plot={plot} />");
    expect(source).toContain('label="°C"');
    expect(source).toContain('label="g"');
    expect(source).toContain('label="g/s"');
  });

  test("keeps extraction annotations and the inspection cursor", () => {
    expect(source).toContain("plot.cutoffY");
    expect(source).toContain("plot.phaseBoundaries");
    expect(source).toContain("plot.settlingX");
    expect(source).toContain("onResponderMove");
  });

  test("renders the graph shell before the first stream page arrives", () => {
    expect(source).toContain("trace: StoredExtractionTrace | null");
    expect(source).toContain("const plottedTrace = trace ?? EMPTY_TRACE");
    expect(source).toContain('translate("scale.telemetryStreamWaiting")');
  });

  test("labels missing weight and flow instead of synthesizing values", () => {
    expect(source).toContain('translate("scale.telemetryWeightUnavailable")');
    expect(source).toContain('translate("scale.telemetryFlowUnavailable")');
    // Formatting lives in src/telemetry/telemetry-readouts.ts, which is unit
    // tested for the "—" fallbacks; the chart must route through it.
    expect(source).toContain(
      "formatWeightReadout(latest?.netWeightDecigrams ?? null)",
    );
    expect(source).toContain(
      "formatFlowReadout(latest?.derivedFlowGPerS ?? null)",
    );
    expect(source).not.toContain("derivedFlowGPerS: 0");
    expect(source).not.toContain("netWeightDecigrams: 0");
  });
});
