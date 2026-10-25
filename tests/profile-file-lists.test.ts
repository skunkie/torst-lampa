// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { PlaybackProgress } from '../src/engine/playback-progress';
import { displayFileList } from '../src/engine/playback-session';
import { Torrent, TorstInstance } from '../src/types/torst';
import { showSavedTorrentFiles } from '../src/ui/saved-torrent-files';
import { createTestLanguage, getTestTranslation } from './support/translations';

describe('profile progress in file pickers', () => {
  const originalLampa = (globalThis as any).Lampa;
  const originalJquery = (globalThis as any).$;
  const instance: TorstInstance = { authType: 'none', id: 'one', name: 'One', profileId: 'prf_one', url: 'http://torst.test' };
  const torrent: Torrent = {
    files: [
      { fileId: 'fil_one', length: 100, name: 'Sintel.mkv', path: 'Sintel.mkv' },
      { fileId: 'fil_two', length: 100, name: 'Spring.mkv', path: 'Spring.mkv' },
    ],
    hash: 'torrent', name: 'Open Movies', retention: 'persisted', storage: 'memory', total_size: 200,
  };
  let menu: any;
  let hydrated: boolean;
  let notices: string[];
  let hashes: Array<number | string>;

  beforeEach(() => {
    menu = undefined;
    hydrated = false;
    notices = [];
    hashes = [];
    const element: any = { append: () => element, on: () => element };
    (globalThis as any).$ = () => element;
    (globalThis as any).Lampa = {
      Controller: { collectionFocus: () => {} },
      Lang: createTestLanguage(),
      Modal: { open: (options: unknown) => { menu = options; } },
      Noty: { show: (message: string) => notices.push(message) },
      Template: { get: () => element },
      Timeline: {
        render: () => element,
        view: (hash: number | string) => { assert.ok(hydrated); hashes.push(hash); return { hash }; },
      },
      Utils: { bytesToSize: () => '', clearHtmlTags: (text: string) => text, hash: (text: string) => text },
    };
    mock.method(PlaybackProgress, 'hydrate', async () => { hydrated = true; });
  });
  afterEach(() => {
    mock.restoreAll();
    (globalThis as any).Lampa = originalLampa;
    (globalThis as any).$ = originalJquery;
  });

  const openers = [
    { name: 'direct torrent', open: () => displayFileList(instance, torrent) },
    { name: 'saved torrent', open: () => showSavedTorrentFiles({ instance, onBack: () => {}, onSelect: () => {}, torrent, videoFiles: torrent.files }) },
  ];
  for (const picker of openers) {
    it(`loads server progress before drawing the ${picker.name} file picker`, async () => {
      await picker.open();
      assert.ok(menu);
      assert.equal(hashes.length, 2);
      assert.ok(hashes.every(hash => String(hash).includes('prf_one')));
    });

    it(`keeps the ${picker.name} file picker usable if progress cannot be loaded`, async () => {
      mock.method(PlaybackProgress, 'hydrate', async () => { hydrated = true; throw new Error('offline'); });
      await picker.open();
      assert.ok(menu);
      assert.deepEqual(notices, [getTestTranslation('torst_progress_load_error')]);
    });

    it(`discards the ${picker.name} file picker if navigation changes while progress loads`, async () => {
      let activity = {};
      (globalThis as any).Lampa.Activity = { active: () => activity };
      let finish!: () => void;
      mock.method(PlaybackProgress, 'hydrate', () => new Promise<void>(resolve => { finish = resolve; }));
      const opening = picker.open();
      await new Promise(resolve => setImmediate(resolve));
      activity = {};
      finish();
      await opening;
      assert.equal(menu, undefined);
    });
  }
});
