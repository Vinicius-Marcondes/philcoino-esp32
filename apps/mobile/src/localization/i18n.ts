import { I18n, type TranslateOptions } from "i18n-js";

import { translations } from "./translations";

export type SupportedLocale = "en" | "pt-BR";

const i18n = new I18n(translations);
i18n.defaultLocale = "en";
i18n.enableFallback = true;
i18n.locale = "en";

export function localeForLanguage(languageCode: string | null): SupportedLocale {
  return languageCode?.toLowerCase().split("-")[0] === "pt" ? "pt-BR" : "en";
}

export function setAppLocale(languageCode: string | null): SupportedLocale {
  const locale = localeForLanguage(languageCode);
  i18n.locale = locale;
  return locale;
}

export function currentLocale(): SupportedLocale {
  return localeForLanguage(i18n.locale.split("-")[0] ?? null);
}

export function translate(key: string, options?: TranslateOptions): string {
  return i18n.t(key, options);
}
