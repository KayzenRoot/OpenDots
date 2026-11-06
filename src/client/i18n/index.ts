import { useCallback, useSyncExternalStore } from 'react';
import { en } from './en';
import { ptBR } from './pt-BR';

export type Locale = 'en' | 'pt-BR';
/** What the user picked. `system` defers to the browser language. */
export type LocalePreference = 'system' | Locale;
export type MessageKey = keyof typeof en;
export type MessageParams = Record<string, string | number>;

const dictionaries: Record<Locale, Record<MessageKey, string>> = {
  en,
  'pt-BR': ptBR,
};
// Storage keys are never translated.
const storageKey = 'nexbot-locale';
const locales: Locale[] = ['en', 'pt-BR'];

/** The choice for this page, even if storage refuses to keep it. */
let chosen: LocalePreference | undefined;
const listeners = new Set<() => void>();

function browserLocale(): string | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.language;
}

/** Maps a BCP 47 language tag to one of the shipped locales. */
export function matchLocale(value: string | undefined): Locale | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === 'pt' || normalized.startsWith('pt-')) return 'pt-BR';
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  return undefined;
}

// Storage can be unavailable (private windows, blocked site data); the locale
// then follows the browser for this visit.
export function localePreference(): LocalePreference {
  if (chosen) return chosen;
  try {
    const value = localStorage.getItem(storageKey);
    if (value === 'en' || value === 'pt-BR') return value;
  } catch {
    // Fall through to the browser language.
  }
  return 'system';
}

/**
 * Resolution order: the saved choice, then the browser language, then English.
 * A browser locale that is not shipped falls back to English.
 */
export function resolveLocale(
  preference: LocalePreference,
  browser: string | undefined,
): Locale {
  if (preference !== 'system') return preference;
  return matchLocale(browser) ?? 'en';
}

let active: Locale = resolveLocale(localePreference(), browserLocale());

function apply() {
  if (typeof document !== 'undefined' && document.documentElement)
    document.documentElement.lang = active;
}

export function activeLocale(): Locale {
  return active;
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setLocalePreference(preference: LocalePreference) {
  chosen = preference;
  try {
    if (preference === 'system') localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, preference);
  } catch {
    // Applies for this visit only.
  }
  const next = resolveLocale(preference, browserLocale());
  active = next;
  apply();
  for (const listener of listeners) listener();
}

/** Applies the initial language to the document; call once at startup. */
export function initializeLocale() {
  apply();
}

const placeholder = /\{(\w+)\}/g;

export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(placeholder, (token, name: string) =>
    name in params ? String(params[name]) : token,
  );
}

export function translate(
  locale: Locale,
  key: MessageKey,
  params?: MessageParams,
): string {
  const message = dictionaries[locale][key];
  // The record type makes a missing key a compile error; this guards the
  // runtime against a hand-edited dictionary instead of silently showing
  // English.
  if (message === undefined)
    throw new Error(`Missing ${locale} translation for "${key}".`);
  return interpolate(message, params);
}

/** The current language, for code that runs outside React render. */
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(active, key, params);
}

/** Every shipped translation of a key, for locale-independent comparisons. */
export function translationsFor(key: MessageKey): string[] {
  return locales.map((locale) => dictionaries[locale][key]);
}

/** Subscribes the calling component to language changes. */
export function useTranslation() {
  const locale = useSyncExternalStore(subscribe, activeLocale, activeLocale);
  const translateKey = useCallback(
    (key: MessageKey, params?: MessageParams) => translate(locale, key, params),
    [locale],
  );
  return { locale, t: translateKey };
}
