// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { TorstApi } from '../src/api/torst';
import { PlaybackFocus } from '../src/engine/playback-focus';
import { PlaybackProgress } from '../src/engine/playback-progress';
import { TorstEngine } from '../src/engine/torst-engine';
import { InstanceManager } from '../src/instances/instance-manager';
import { Torrent, TorstInstance, UpNextEntry } from '../src/types/torst';
import { UpNextUi } from '../src/ui/up-next';
import { createTestLanguage, getTestTranslation } from './support/translations';

const flush = () => new Promise(resolve => setImmediate(resolve));

describe('Up Next view', () => {
  const originalLampa = (globalThis as any).Lampa;
  let instance: TorstInstance;
  let entry: UpNextEntry;
  let torrent: Torrent;
  let menu: any;
  let exit: () => void;
  let backs: number;
  let notices: string[];

  beforeEach(() => {
    menu = undefined;
    backs = 0;
    notices = [];
    instance = { authType: 'none', id: 'one', name: 'One', profileId: 'prf_one', url: 'http://torst.test' };
    torrent = {
      files: [
        { fileId: 'fil_notes', length: 1, name: 'notes.txt', path: 'notes.txt' },
        { fileId: 'fil_other', length: 100, name: 'Show.S01E02.mkv', path: 'Show.S01E02.mkv' },
        { fileId: 'fil_one', length: 100, name: 'Show.S01E01.mkv', path: 'Show.S01E01.mkv' },
      ],
      hash: 'a'.repeat(40), id: 'trr_one', name: 'Show', retention: 'persisted', storage: 'memory', total_size: 201,
    };
    entry = {
      file: torrent.files[2], id: 'upn_one',
      progress: { completion_ratio: 0.25, duration_seconds: 400, file_id: 'fil_one', position_seconds: 100, updated_at: '2026-10-25', viewed: false, viewed_at: null },
      reason: 'resume', torrent,
    };
    (globalThis as any).Lampa = {
      Controller: { toggle: () => {} },
      Lang: createTestLanguage(),
      Noty: { show: (text: string) => notices.push(text) },
      Player: { callback: (callback: () => void) => { exit = callback; } },
      Select: { show: (options: any) => { menu = options; } },
      Utils: { clearHtmlTags: (text: string) => text.replace(/<[^>]*>/g, '') },
    };
    mock.method(InstanceManager, 'getInstances', () => [instance]);
    mock.method(PlaybackProgress, 'flush', async () => {});
    mock.method(TorstApi, 'getUpNext', async () => [entry]);
    mock.method(TorstApi, 'getTorrent', async () => torrent);
    mock.method(TorstApi, 'dismissUpNext', async () => {});
    mock.method(TorstEngine, 'startTorrentPlayback', async () => true);
  });
  afterEach(() => {
    PlaybackFocus.resetForTesting();
    mock.restoreAll();
    (globalThis as any).Lampa = originalLampa;
  });
  const open = () => UpNextUi.show(instance, () => { backs++; });
  const action = (name: string) => menu.onSelect(menu.items.find((item: any) => item.action === name));

  it('shows resume positions and next episodes in server order', async () => {
    const next = { ...entry, id: 'upn_next', progress: null, reason: 'next_episode' };
    mock.method(TorstApi, 'getUpNext', async () => [entry, next]);
    await open();
    assert.equal(menu.items[0].data.id, 'upn_one');
    assert.equal(menu.items[0].subtitle, getTestTranslation('torst_up_next_resume', { percent: 25 }));
    assert.equal(menu.items[1].subtitle, getTestTranslation('torst_up_next_episode'));
    assert.equal((TorstApi.getUpNext as any).mock.calls[0].arguments[1], 'prf_one');
  });

  it('resolves the opaque file ID to its metadata index and restores the view after playback', async () => {
    await open();
    menu.onSelect(menu.items[0]);
    action('play');
    await flush();
    const call = (TorstEngine.startTorrentPlayback as any).mock.calls[0];
    assert.equal(call.arguments[1], 2);
    assert.equal(call.arguments[3], instance);
    assert.ok(exit);
    exit();
    await flush();
    assert.equal(menu.title, getTestTranslation('torst_up_next_title'));
  });

  it('dismisses an entry without deleting its progress or torrent', async () => {
    await open();
    menu.onSelect(menu.items[0]);
    action('dismiss');
    await flush();
    assert.deepEqual((TorstApi.dismissUpNext as any).mock.calls[0].arguments, [instance, 'prf_one', 'upn_one']);
    assert.equal(menu.title, getTestTranslation('torst_up_next_title'));
  });

  it('handles an empty view and requires a selected profile', async () => {
    mock.method(TorstApi, 'getUpNext', async () => []);
    await open();
    assert.equal(menu.items[0].noenter, true);
    menu.onBack();
    delete instance.profileId;
    await open();
    assert.equal(backs, 2);
    assert.equal(notices[0], getTestTranslation('torst_profile_required'));
  });

  it('returns to the view when playback is canceled or its file is no longer present', async () => {
    mock.method(TorstEngine, 'startTorrentPlayback', async () => false);
    await open();
    menu.onSelect(menu.items[0]);
    action('play');
    await flush();
    assert.equal(menu.title, getTestTranslation('torst_up_next_title'));
    torrent.files = [];
    menu.onSelect(menu.items[0]);
    action('play');
    await flush();
    assert.equal(notices.length, 1);
  });

  it('does not play a stale entry after the instance changes profiles', async () => {
    await open();
    menu.onSelect(menu.items[0]);
    instance.profileId = 'prf_two';
    action('play');
    await flush();
    assert.equal((TorstEngine.startTorrentPlayback as any).mock.callCount(), 0);
  });

  it('reports list and dismissal failures without losing the return path', async () => {
    mock.method(TorstApi, 'dismissUpNext', async () => { throw new Error('offline'); });
    await open();
    menu.onSelect(menu.items[0]);
    action('dismiss');
    await flush();
    assert.ok(notices[0].includes('offline'));
    mock.method(TorstApi, 'getUpNext', async () => { throw new Error('unavailable'); });
    await open();
    assert.ok(notices[1].includes('unavailable'));
    assert.equal(backs, 1);
  });

  it('escapes untrusted torrent and file names before filling row templates', async () => {
    torrent.title = 'Show <img src=x';
    entry.file.name = '{size} $&';
    await open();
    assert.equal(menu.items[0].title, 'Show &lt;img src=x · &#123;size} $$&amp;');
  });

  it('does not open a delayed list after leaving its activity or changing its instance', async () => {
    let activity = {};
    (globalThis as any).Lampa.Activity = { active: () => activity };
    let resolve!: (entries: UpNextEntry[]) => void;
    mock.method(TorstApi, 'getUpNext', () => new Promise<UpNextEntry[]>(done => { resolve = done; }));
    const first = open();
    await flush();
    activity = {};
    resolve([entry]);
    await first;
    assert.equal(menu, undefined);
    const second = open();
    await flush();
    instance.url = 'http://other.test';
    resolve([entry]);
    await second;
    assert.equal(menu, undefined);
    assert.equal(backs, 0);
  });

  it('does not play metadata loaded for a URL or activity that has changed', async () => {
    let activity = {};
    (globalThis as any).Lampa.Activity = { active: () => activity };
    let finish!: (value: Torrent) => void;
    mock.method(TorstApi, 'getTorrent', () => new Promise<Torrent>(resolve => { finish = resolve; }));
    for (const change of [() => { instance.url = 'http://other.test'; }, () => { activity = {}; }]) {
      await open();
      menu.onSelect(menu.items[0]);
      action('play');
      const actions = menu;
      change();
      finish(torrent);
      await flush();
      assert.equal(menu, actions);
    }
    assert.equal((TorstEngine.startTorrentPlayback as any).mock.callCount(), 0);
  });

  it('keeps a newer view open when a previous dismissal finishes', async () => {
    let finish!: () => void;
    mock.method(TorstApi, 'dismissUpNext', () => new Promise<void>(resolve => { finish = resolve; }));
    await open();
    menu.onSelect(menu.items[0]);
    action('dismiss');
    await open();
    const current = menu;
    finish();
    await flush();
    assert.equal(menu, current);
  });

  it('does not launch a file after its instance is removed during metadata loading', async () => {
    let finish!: (value: Torrent) => void;
    mock.method(TorstApi, 'getTorrent', () => new Promise<Torrent>(resolve => { finish = resolve; }));
    await open();
    menu.onSelect(menu.items[0]);
    action('play');
    mock.method(InstanceManager, 'getInstances', () => []);
    finish(torrent);
    await flush();
    assert.equal((TorstEngine.startTorrentPlayback as any).mock.callCount(), 0);
  });
});
