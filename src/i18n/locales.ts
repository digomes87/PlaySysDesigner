export const LOCALES = ['pt-BR', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Text written in every game language. */
export type Localized = Readonly<Record<Locale, string>>;

export function localize(text: Localized, locale: Locale): string {
  return text[locale];
}

/** Initial language from the browser preference: Portuguese for `pt*`, English otherwise. */
export function detectLocale(preferred: readonly string[]): Locale {
  const first = preferred[0]?.toLowerCase() ?? '';
  return first.startsWith('pt') ? 'pt-BR' : DEFAULT_LOCALE;
}
