// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { initTranslations, SupportedLocale, translate, TRANSLATIONS } from '../src/lang/translations';

describe('Localization & Translations', () => {
  beforeEach(() => {
    // Reset global Lampa mock
    delete (globalThis as any).Lampa;
  });

  it('contains valid and non-empty en and ru entries for every translation key', () => {
    const keys = Object.keys(TRANSLATIONS);
    assert.ok(keys.length > 0, 'TRANSLATIONS must have defined keys');

    for (const key of keys) {
      const entry = TRANSLATIONS[key];
      assert.ok(entry, `Key "${key}" must have an entry`);
      assert.ok(typeof entry.en === 'string' && entry.en.length > 0, `Key "${key}" must have non-empty en translation`);
      assert.ok(typeof entry.ru === 'string' && entry.ru.length > 0, `Key "${key}" must have non-empty ru translation`);
    }
  });

  it('uses the same placeholders in every locale for every translation key', () => {
    const getPlaceholders = (template: string) => [...new Set(template.match(/\{\w+\}/g) || [])].sort();

    for (const [key, entry] of Object.entries(TRANSLATIONS)) {
      for (const [locale, template] of Object.entries(entry)) {
        assert.deepEqual(getPlaceholders(template), getPlaceholders(entry.en), `Key "${key}" must use the same placeholders in ${locale} as in en`);
      }
    }
  });

  it('strictly maintains alphabetical ordering of all TRANSLATIONS keys', () => {
    const keys = Object.keys(TRANSLATIONS);
    for (let i = 1; i < keys.length; i++) {
      assert.ok(
        keys[i] >= keys[i - 1],
        `Key "${keys[i]}" must be sorted alphabetically after "${keys[i - 1]}"`
      );
    }
  });

  it('registers dictionary with Lampa.Lang.add via initTranslations', () => {
    let addedDictionary: Record<string, Record<SupportedLocale, string>> | null = null;
    (globalThis as any).Lampa = {
      Lang: {
        add: (data: Record<string, Record<SupportedLocale, string>>) => {
          addedDictionary = data;
        },
      },
    };

    initTranslations();
    assert.deepEqual(addedDictionary, TRANSLATIONS, 'initTranslations must pass TRANSLATIONS to Lampa.Lang.add');
  });

  it('safely handles missing Lampa or Lampa.Lang during initTranslations', () => {
    assert.doesNotThrow(() => {
      initTranslations();
    });

    (globalThis as any).Lampa = {};
    assert.doesNotThrow(() => {
      initTranslations();
    });
  });

  it('returns fallback string or key when Lampa.Lang is unavailable', () => {
    const resultWithFallback = translate('torst_enabled_name', 'Enable Torst');
    assert.equal(resultWithFallback, 'Enable Torst');

    const resultWithoutFallback = translate('torst_unknown_key');
    assert.equal(resultWithoutFallback, 'torst_unknown_key');
  });

  it('uses Lampa.Lang.translate when available', () => {
    (globalThis as any).Lampa = {
      Lang: {
        translate: (key: string) => {
          if (key === 'torst_enabled_name') return 'Включить Torst';
          return key;
        },
      },
    };

    const translated = translate('torst_enabled_name', 'Enable Torst');
    assert.equal(translated, 'Включить Torst');

    // Unknown key where translate returns key returns the fallback
    const fallbackUsed = translate('torst_nonexistent', 'Fallback Text');
    assert.equal(fallbackUsed, 'Fallback Text');
  });

  it('interpolates parameters correctly in translate', () => {
    (globalThis as any).Lampa = {
      Lang: {
        translate: (key: string) => {
          if (key === 'torst_noty_failover') {
            return 'Torst: {failed} недоступен → переключено на {next} ({latency} мс)';
          }
          return key;
        },
      },
    };

    const resultRu = translate(
      'torst_noty_failover',
      'Torst: {failed} offline → Switched to {next} ({latency} ms)',
      { failed: 'Node A', latency: 42, next: 'Node B' }
    );
    assert.equal(resultRu, 'Torst: Node A недоступен → переключено на Node B (42 мс)');

    // Test with fallback when Lampa returns unchanged key
    delete (globalThis as any).Lampa;
    const resultEn = translate(
      'torst_noty_failover',
      'Torst: {failed} offline → Switched to {next} ({latency} ms)',
      { failed: 'Node A', latency: 42, next: 'Node B' }
    );
    assert.equal(resultEn, 'Torst: Node A offline → Switched to Node B (42 ms)');
  });
});
