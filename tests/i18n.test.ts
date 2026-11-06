import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '../src/client/i18n/en';
import { ptBR } from '../src/client/i18n/pt-BR';
import {
  interpolate,
  matchLocale,
  resolveLocale,
  setLocalePreference,
  t,
  translationsFor,
} from '../src/client/i18n';

afterEach(() => {
  setLocalePreference('system');
  vi.unstubAllGlobals();
});

describe('dictionaries', () => {
  it('has every English key in Brazilian Portuguese, with no extras', () => {
    expect(Object.keys(ptBR).sort()).toEqual(Object.keys(en).sort());
  });

  it('has no empty translation', () => {
    for (const key of Object.keys(en))
      expect(ptBR[key as keyof typeof en]).not.toBe('');
  });

  it('keeps the same interpolation placeholders as English', () => {
    const placeholders = (value: string) =>
      (value.match(/\{(\w+)\}/g) ?? []).sort();
    for (const key of Object.keys(en) as (keyof typeof en)[])
      expect(placeholders(ptBR[key]), key).toEqual(placeholders(en[key]));
  });
});

describe('interpolation', () => {
  it('replaces named parameters', () => {
    expect(
      interpolate('Hello {name}, {count} items', { name: 'Ana', count: 3 }),
    ).toBe('Hello Ana, 3 items');
  });

  it('leaves an unknown placeholder intact', () => {
    expect(interpolate('Hi {name}')).toBe('Hi {name}');
  });

  it('translates and interpolates through t', () => {
    setLocalePreference('pt-BR');
    expect(t('chat.dotThinking', { name: 'Zoe' })).toBe('Zoe está pensando');
    setLocalePreference('en');
    expect(t('chat.dotThinking', { name: 'Zoe' })).toBe('Zoe is thinking');
  });

  it('exposes every shipped value of a key', () => {
    expect(translationsFor('api.unreadable')).toEqual([
      'Server returned an unreadable response.',
      'O servidor retornou uma resposta ilegível.',
    ]);
  });
});

describe('locale matching', () => {
  it('matches shipped languages and rejects the rest', () => {
    expect(matchLocale('pt-BR')).toBe('pt-BR');
    expect(matchLocale('pt')).toBe('pt-BR');
    expect(matchLocale('pt-PT')).toBe('pt-BR');
    expect(matchLocale('en-US')).toBe('en');
    expect(matchLocale('en')).toBe('en');
    expect(matchLocale('de-DE')).toBeUndefined();
    expect(matchLocale('')).toBeUndefined();
    expect(matchLocale(undefined)).toBeUndefined();
  });
});

describe('locale resolution order', () => {
  it('prefers the saved choice, then the browser, then English', () => {
    expect(resolveLocale('pt-BR', 'en-US')).toBe('pt-BR');
    expect(resolveLocale('en', 'pt-BR')).toBe('en');
    expect(resolveLocale('system', 'pt-BR')).toBe('pt-BR');
    expect(resolveLocale('system', 'en-GB')).toBe('en');
  });

  it('falls back to English for an unsupported browser locale', () => {
    expect(resolveLocale('system', 'de-DE')).toBe('en');
    expect(resolveLocale('system', 'zh-Hans-CN')).toBe('en');
    expect(resolveLocale('system', undefined)).toBe('en');
  });
});

function stubStorage(saved?: string) {
  const store = new Map<string, string>();
  if (saved) store.set('nexbot-locale', saved);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  return store;
}

describe('startup resolution', () => {
  it('uses the saved locale over the browser language', async () => {
    stubStorage('pt-BR');
    vi.stubGlobal('navigator', { language: 'en-US' });
    vi.resetModules();
    const i18n = await import('../src/client/i18n');
    expect(i18n.localePreference()).toBe('pt-BR');
    expect(i18n.activeLocale()).toBe('pt-BR');
  });

  it('follows the browser language when nothing is saved', async () => {
    stubStorage();
    vi.stubGlobal('navigator', { language: 'pt-BR' });
    vi.resetModules();
    const i18n = await import('../src/client/i18n');
    expect(i18n.localePreference()).toBe('system');
    expect(i18n.activeLocale()).toBe('pt-BR');
  });

  it('falls back to English when the browser locale is unsupported', async () => {
    stubStorage();
    vi.stubGlobal('navigator', { language: 'de-DE' });
    vi.resetModules();
    const i18n = await import('../src/client/i18n');
    expect(i18n.activeLocale()).toBe('en');
  });

  it('persists the chosen locale across a reload', async () => {
    const store = stubStorage();
    vi.stubGlobal('navigator', { language: 'en-US' });
    vi.resetModules();
    const first = await import('../src/client/i18n');
    first.setLocalePreference('pt-BR');
    expect(store.get('nexbot-locale')).toBe('pt-BR');
    vi.resetModules();
    const second = await import('../src/client/i18n');
    expect(second.activeLocale()).toBe('pt-BR');
    second.setLocalePreference('system');
    expect(store.has('nexbot-locale')).toBe(false);
  });

  it('applies the choice this visit when storage is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    });
    vi.stubGlobal('navigator', { language: 'pt-BR' });
    vi.resetModules();
    const i18n = await import('../src/client/i18n');
    expect(i18n.localePreference()).toBe('system');
    expect(i18n.activeLocale()).toBe('pt-BR');
    i18n.setLocalePreference('en');
    expect(i18n.activeLocale()).toBe('en');
    // A blocked storage cannot undo the choice for this page.
    expect(i18n.localePreference()).toBe('en');
  });
});
