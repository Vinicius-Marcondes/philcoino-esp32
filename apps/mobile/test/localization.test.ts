import { afterEach, describe, expect, test } from "bun:test";

import {
  currentLocale,
  localeForLanguage,
  setAppLocale,
  translate,
} from "../src/localization/i18n";
import { formatTemperature } from "../src/dashboard/dashboard-view-model";
import { translations } from "../src/localization/translations";

afterEach(() => {
  setAppLocale("en");
});

describe("mobile localization", () => {
  test("keeps English and Brazilian Portuguese translation keys aligned", () => {
    expect(flattenKeys(translations["pt-BR"])).toEqual(
      flattenKeys(translations.en),
    );
  });

  test("selects Brazilian Portuguese for Portuguese device locales", () => {
    expect(localeForLanguage("pt")).toBe("pt-BR");
    expect(localeForLanguage("en")).toBe("en");
    expect(localeForLanguage("es")).toBe("en");
    expect(localeForLanguage(null)).toBe("en");
  });

  test("provides Portuguese copy and locale-aware decimal formatting", () => {
    setAppLocale("pt");

    expect(currentLocale()).toBe("pt-BR");
    expect(translate("navigation.pairMachine")).toBe("Parear máquina");
    expect(translate("viewModel.mode.brew")).toBe("Café");
    expect(formatTemperature(91.24)).toBe("91,2°");
  });

  test("keeps English as the unsupported-locale fallback", () => {
    setAppLocale("de");

    expect(currentLocale()).toBe("en");
    expect(translate("navigation.pairMachine")).toBe("Pair machine");
  });
});

function flattenKeys(value: object, prefix = ""): string[] {
  return Object.entries(value)
    .flatMap(([key, child]) => {
      const path = prefix.length === 0 ? key : `${prefix}.${key}`;
      return typeof child === "object" && child !== null
        ? flattenKeys(child, path)
        : [path];
    })
    .sort();
}
