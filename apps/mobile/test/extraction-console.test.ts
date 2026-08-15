import { describe, expect, test } from "bun:test";

const screen = await Bun.file(
  new URL("../components/extraction-console-screen.tsx", import.meta.url),
).text();
const dashboard = await Bun.file(
  new URL("../components/dashboard-screen.tsx", import.meta.url),
).text();
const weightModeCard = await Bun.file(
  new URL("../components/weight-mode-card.tsx", import.meta.url),
).text();

describe("extraction console screen", () => {
  test("takes over the screen and closes on hardware back", () => {
    expect(screen).toContain("<Modal");
    expect(screen).toContain('presentationStyle="fullScreen"');
    expect(screen).toContain("onRequestClose={onClose}");
    expect(screen).toContain("visible={visible}");
  });

  test("plots only the live shot and shows a simple ready state while idle", () => {
    expect(screen).toContain("<WeightedTraceChart");
    expect(screen).toContain('variant="console"');
    expect(screen).toContain('key={displayedTrace?.extractionId ?? "awaiting-stream"}');
    expect(screen).not.toContain("<TemperatureHistoryChart");
    expect(screen).toContain('translate("extractionConsole.idle")');
    expect(screen).toContain('translate("extractionConsole.openDetail")');
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

  test("shows gross weight before tare and switches to net weight when available", () => {
    expect(weightModeCard).toContain("currentScaleWeightDecigrams(scale)");
    expect(weightModeCard).not.toContain(
      "formatWeightReadout(scale?.netWeightDecigrams)",
    );
  });

  test("reads as an instrument panel with tabular numerals", () => {
    expect(screen).toContain('fontVariant: ["tabular-nums"]');
    expect(screen).toContain("StyleSheet.hairlineWidth");
    expect(screen).toContain("landscapeChart");
    expect(screen).toContain("portraitBody");
  });
});

describe("dashboard console wiring", () => {
  test("owns console visibility and consumes scale from unified state", () => {
    expect(dashboard).toContain("<ExtractionConsoleScreen");
    expect(dashboard).toContain("const [consoleOpen, setConsoleOpen] = useState(false)");
    expect(dashboard).toContain("stateScale: scaleSnapshot");
    expect(dashboard).not.toContain("scalePageVisible:");
    expect(dashboard).toContain("state={extractionUiState}");
    expect(dashboard).toContain("onStateChange={applyExtractionUiState}");
  });

  test("keeps every history action in Shots and confirmed status clearing in Machine", () => {
    const scalePage = dashboard.slice(
      dashboard.indexOf("function ScalePage"),
      dashboard.indexOf("function ShotsPage"),
    );
    const shotsPage = dashboard.slice(
      dashboard.indexOf("function ShotsPage"),
      dashboard.indexOf("function shotLabel"),
    );
    expect(scalePage).not.toContain("scale.history.map");
    expect(shotsPage).toContain("scale.history.map");
    expect(shotsPage).toContain("scale.exportHistory()");
    expect(shotsPage).toContain("scale.clearHistory()");
    expect(dashboard).toContain('translate("dashboard.historyClearConfirm")');
    expect(dashboard).toContain("clearTemperatureHistory()");
  });
});
