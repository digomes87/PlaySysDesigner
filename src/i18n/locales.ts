export const LOCALES = ['pt-BR', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Texto escrito em todos os idiomas do jogo. */
export type Localized = Readonly<Record<Locale, string>>;

export function localize(text: Localized, locale: Locale): string {
  return text[locale];
}

/** Idioma inicial a partir da preferência do navegador: português para `pt*`, inglês para o resto. */
export function detectLocale(preferred: readonly string[]): Locale {
  const first = preferred[0]?.toLowerCase() ?? '';
  return first.startsWith('pt') ? 'pt-BR' : DEFAULT_LOCALE;
}
