import { create } from 'zustand';
import { progressRepository } from '../progress';
import { detectLocale, localize, type Locale, type Localized } from './locales';
import { en } from './messages.en';
import { ptBR, type Messages } from './messages.pt-BR';

const MESSAGES: Readonly<Record<Locale, Messages>> = { 'pt-BR': ptBR, en };

function browserLocale(): Locale {
  return detectLocale(typeof navigator === 'undefined' ? [] : navigator.languages);
}

interface LocaleState {
  readonly locale: Locale;
  /** Carrega a escolha salva no aparelho, se houver. */
  restore(): Promise<void>;
  setLocale(locale: Locale): void;
}

function applyToDocument(locale: Locale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: browserLocale(),
  async restore() {
    try {
      const { locale } = await progressRepository.getSettings();
      if (locale) set({ locale });
    } catch {
      // Sem armazenamento disponível vale o idioma do navegador.
    }
    applyToDocument(useLocaleStore.getState().locale);
  },
  setLocale(locale) {
    set({ locale });
    applyToDocument(locale);
    void progressRepository.saveSettings({ locale }).catch(() => undefined);
  },
}));

export interface I18n {
  readonly locale: Locale;
  readonly m: Messages;
  /** Texto de conteúdo (fases, perguntas) no idioma atual. */
  text(value: Localized): string;
  number(value: number, maximumFractionDigits?: number): string;
  percent(value: number, maximumFractionDigits?: number): string;
  dateTime(iso: string): string;
}

export function useI18n(): I18n {
  const locale = useLocaleStore((state) => state.locale);
  return {
    locale,
    m: MESSAGES[locale],
    text: (value) => localize(value, locale),
    number: (value, maximumFractionDigits = 0) => value.toLocaleString(locale, { maximumFractionDigits }),
    percent: (value, maximumFractionDigits = 1) =>
      value.toLocaleString(locale, { style: 'percent', maximumFractionDigits }),
    dateTime: (iso) => new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }),
  };
}
