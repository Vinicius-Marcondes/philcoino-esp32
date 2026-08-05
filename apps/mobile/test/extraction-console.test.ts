import { describe, expect, test } from "bun:test";

const screen = await Bun.file(
  new URL("../components/extraction-console-screen.tsx", import.meta.url),
).text();
const dashboard = await Bun.file(
  new URL("../components/dashboard-screen.tsx", import.meta.url),
).text();

describe("extraction console screen", () => {
  test("takes over the screen and closes on hardware back", () => {
    expect(screen).toContain("<Modal");
    expect(screen).toContain('presentationStyle="fullScreen"');
    expect(screen).toContain("onRequestClose={onClose}");
    expect(screen).toContain("visible={visible}");
  });

  test("plots the shot with the console chart and falls back to temperature", () => {
    expect(screen).toContain("<WeightedTraceChart");
    expect(screen).toContain('variant="console"');
    expect(screen).toContain("key={displayedTrace.extractionId}");
    expect(screen).toContain("<TemperatureHistoryChart");
    expect(screen).toContain("bands={2}");
  });

  test("derives every readout through the tested console model", () => {
    expect(screen).toContain("extractionConsoleTrace(trace, extraction)");
    expect(screen).toContain("extractionConsoleReadouts({");
    expect(screen).not.toContain("toFixed(");
  });

  test("drives extraction through the existing reducers, not its own mutations", () => {
    expect(screen).toContain("startExtractionPreview(current)");
    expect(screen).toContain("stopExtractionPreview(current)");
    expect(screen).toContain("selectPreview(current, selected)");
    expect(screen).toContain("canStartPreview(state)");
    expect(screen).not.toContain("DeviceApiClient");
    expect(screen).not.toContain("fetch(");
  });

  test("hosts profile selection and weight control instead of duplicating them", () => {
    expect(screen).toContain("<ProfileStrip");
    expect(screen).toContain("<WeightModeCard");
    expect(screen).toContain('from "@/components/weight-mode-card"');
  });

  test("reads as an instrument panel with tabular numerals", () => {
    expect(screen).toContain('fontVariant: ["tabular-nums"]');
    expect(screen).toContain("StyleSheet.hairlineWidth");
    expect(screen).toContain("landscapeChart");
    expect(screen).toContain("portraitBody");
  });
});

describe("dashboard console wiring", () => {
  test("owns the console visibility and polls the scale while it is open", () => {
    expect(dashboard).toContain("<ExtractionConsoleScreen");
    expect(dashboard).toContain("const [consoleOpen, setConsoleOpen] = useState(false)");
    expect(dashboard).toContain(
      'scalePageVisible: dashboardPage === "scale" || consoleOpen,',
    );
    expect(dashboard).toContain("state={extractionUiState}");
    expect(dashboard).toContain("onStateChange={applyExtractionUiState}");
  });
});
