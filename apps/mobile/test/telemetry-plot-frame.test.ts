import { describe, expect, test } from "bun:test";

import {
  telemetryBandValueY,
  telemetryChartHeight,
  telemetryGridLines,
  telemetryPlotFrame,
} from "../src/telemetry/telemetry-plot-frame";

describe("telemetry plot frame", () => {
  test("reproduces the two-band layout at both established chart heights", () => {
    for (const height of [250, 330]) {
      const frame = telemetryPlotFrame({
        bandCount: 2,
        height,
        maxElapsed: 30_000,
        width: 400,
      });
      expect(frame.bands).toHaveLength(2);
      expect(frame.bands[0].top).toBe(8);
      expect(frame.bands[0].bottom).toBe(Math.round(height * 0.48));
      expect(frame.bands[1].top).toBe(Math.round(height * 0.48) + 18);
      expect(frame.bands[1].bottom).toBe(height - 22);
      expect(frame.bottom).toBe(height - 22);
      expect(frame.left).toBe(34);
      expect(frame.right).toBe(400 - 34);
      expect(frame.plotWidth).toBe(400 - 68);
    }
  });

  test("gives the single band the whole canvas without a band gutter", () => {
    const frame = telemetryPlotFrame({
      bandCount: 1,
      height: 190,
      maxElapsed: 30_000,
      width: 400,
    });
    expect(frame.bands).toEqual([{ bottom: 190 - 22, top: 8 }]);
    expect(frame.top).toBe(8);
    expect(frame.bottom).toBe(190 - 22);
  });

  test("keeps bands ordered, non-overlapping and positive across heights", () => {
    for (let height = 120; height <= 600; height += 10) {
      for (const bandCount of [1, 2] as const) {
        const frame = telemetryPlotFrame({
          bandCount,
          height,
          maxElapsed: 1_000,
          width: 320,
        });
        expect(frame.bands).toHaveLength(bandCount);
        let previousBottom = frame.top - 1;
        for (const band of frame.bands) {
          expect(band.top).toBeGreaterThan(previousBottom);
          expect(band.bottom).toBeGreaterThan(band.top);
          previousBottom = band.bottom;
        }
        expect(frame.bands.at(-1)!.bottom).toBe(frame.bottom);
      }
    }
  });

  test("never reports a zero plot width before layout", () => {
    const frame = telemetryPlotFrame({
      bandCount: 2,
      height: 250,
      maxElapsed: 1_000,
      width: 0,
    });
    expect(frame.plotWidth).toBe(1);
  });

  test("emits one grid line per band edge", () => {
    const twoBands = telemetryPlotFrame({
      bandCount: 2,
      height: 330,
      maxElapsed: 1_000,
      width: 320,
    });
    const oneBand = telemetryPlotFrame({
      bandCount: 1,
      height: 190,
      maxElapsed: 1_000,
      width: 320,
    });
    expect(telemetryGridLines(twoBands)).toEqual([
      twoBands.bands[0].top,
      twoBands.bands[0].bottom,
      twoBands.bands[1].top,
      twoBands.bands[1].bottom,
    ]);
    expect(telemetryGridLines(oneBand)).toEqual([8, 190 - 22]);
  });

  test("maps band values from bottom to top and survives a flat domain", () => {
    const band = { bottom: 200, top: 100 };
    expect(telemetryBandValueY(band, 0, 0, 10)).toBe(200);
    expect(telemetryBandValueY(band, 10, 0, 10)).toBe(100);
    expect(telemetryBandValueY(band, 5, 0, 10)).toBe(150);
    expect(telemetryBandValueY(band, 5, 5, 5)).toBe(200);
  });

  test("keeps the home chart shorter than the console chart", () => {
    expect(telemetryChartHeight("home", false)).toBeLessThan(
      telemetryChartHeight("console", false),
    );
    expect(telemetryChartHeight("home", true)).toBeLessThan(
      telemetryChartHeight("home", false),
    );
    expect(telemetryChartHeight("trace-detail", true)).toBe(250);
    expect(telemetryChartHeight("trace-detail", false)).toBe(330);
  });
});
