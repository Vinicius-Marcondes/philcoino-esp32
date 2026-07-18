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

  test("keeps interpolation placeholders aligned in both languages", () => {
    const english = flattenEntries(translations.en);
    const portuguese = flattenEntries(translations["pt-BR"]);

    for (const [key, englishValue] of Object.entries(english)) {
      expect(placeholders(portuguese[key])).toEqual(placeholders(englishValue));
    }
  });

  test("resolves every literal translation key used by mobile source", async () => {
    const catalogKeys = new Set(flattenKeys(translations.en));
    const missingKeys: string[] = [];
    const mobileRoot = new URL("../", import.meta.url).pathname;

    for (const pattern of [
      "app/**/*.tsx",
      "components/**/*.tsx",
      "hooks/**/*.ts",
      "src/**/*.ts",
    ]) {
      const files = new Bun.Glob(pattern);
      for await (const file of files.scan({ cwd: mobileRoot, onlyFiles: true })) {
        const source = await Bun.file(`${mobileRoot}${file}`).text();
        for (const match of source.matchAll(/translate\(\s*["']([^"']+)["']/g)) {
          if (!catalogKeys.has(match[1])) {
            missingKeys.push(`${file}: ${match[1]}`);
          }
        }
      }
    }

    expect(missingKeys).toEqual([]);
  });

  test("selects Brazilian Portuguese for Portuguese device locales", () => {
    expect(localeForLanguage("pt")).toBe("pt-BR");
    expect(localeForLanguage("pt-BR")).toBe("pt-BR");
    expect(localeForLanguage("pt-PT")).toBe("pt-BR");
    expect(localeForLanguage("en")).toBe("en");
    expect(localeForLanguage("es")).toBe("en");
    expect(localeForLanguage(null)).toBe("en");
  });

  test("provides Portuguese copy and locale-aware decimal formatting", () => {
    setAppLocale("pt");

    expect(currentLocale()).toBe("pt-BR");
    expect(translate("navigation.pairMachine")).toBe("Parear máquina");
    expect(translate("viewModel.mode.brew")).toBe("Café");
    expect(translate("extractionPreview.newProfileName")).toBe("NovoPerfil");
    expect(translate("mutation.rejections.cooldownActive")).toBe(
      "Já existe um fluxo de cooldown ativo.",
    );
    expect(formatTemperature(91.24)).toBe("91,2°");
  });

  test("localizes compact compensation status without exposing an offset", () => {
    expect(translations.en.dashboard.compensationActive).toBe("Comp active");
    expect(translations.en.dashboard.compensationInactive).toBe(
      "Comp inactive",
    );
    expect(translations["pt-BR"].dashboard.compensationActive).toBe(
      "Comp. ativa",
    );
    expect(translations["pt-BR"].dashboard.compensationInactive).toBe(
      "Comp. inativa",
    );
    expect(translations.en.dashboard.compensationActiveAccessibility).toBe(
      "Extraction compensation active",
    );
    expect(
      translations["pt-BR"].dashboard.compensationInactiveAccessibility,
    ).toBe("Compensação da extração inativa");
    expect(translations.en.dashboard.compensationActive).not.toContain("°");
    expect(translations["pt-BR"].dashboard.compensationActive).not.toContain(
      "°",
    );
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

function flattenEntries(value: object, prefix = ""): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      const path = prefix.length === 0 ? key : `${prefix}.${key}`;
      return typeof child === "object" && child !== null
        ? Object.entries(flattenEntries(child, path))
        : [[path, String(child)]];
    }),
  );
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/%\{([^}]+)\}/g)]
    .map((match) => match[1])
    .sort();
}
