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
import { PreloadModal } from '../src/ui/preload-modal';
import { UpNextUi } from '../src/ui/up-next';
import { createTestLanguage, getTestTranslation } from './support/translations';

class DialogElement {
  public readonly 0 = this;
  public readonly children: DialogElement[] = [];
  public readonly events: Record<string, () => void> = {};
  public readonly found = new Map<string, DialogElement>();
  public readonly attributes: Record<string, string> = {};
  public textValue = '';
  public constructor(public markup: string) {}
  public append(child: DialogElement) { this.children.push(child); return this; }
  public attr(name: string, value: string) { this.attributes[name] = value; return this; }
  public css(name: string, value: string) { return this.attr(name, value); }
  public find(selector: string): DialogElement {
    if (!this.found.has(selector)) this.found.set(selector, new DialogElement(selector));
    return this.found.get(selector)!;
  }
  public on(name: string, callback: () => void) { this.events[name] = callback; return this; }
  public text(value: string) { this.textValue = value; return this; }
}

const startTorrentPlayback = TorstEngine.startTorrentPlayback;

const flush = () => new Promise(resolve => setImmediate(resolve));

describe('Up Next view', () => {
  const originalLampa = (globalThis as any).Lampa;
  const originalJquery = (globalThis as any).$;
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
    (globalThis as any).$ = (markup: string) => new DialogElement(markup);
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
      Controller: { collectionFocus: () => {}, toggle: () => {} },
      Lang: createTestLanguage(),
      Modal: { close: () => {}, open: (options: any) => { menu = options; }, update: (html: DialogElement) => { menu.html = html; } },
      Noty: { show: (text: string) => notices.push(text) },
      Player: { callback: (callback: () => void) => { exit = callback; } },
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
    menu?.onBack();
    PlaybackFocus.resetForTesting();
    mock.restoreAll();
    (globalThis as any).Lampa = originalLampa;
    (globalThis as any).$ = originalJquery;
  });
  const open = () => UpNextUi.show(instance, () => { backs++; });
  const rows = (): DialogElement[] => menu.html.find('.torst-up-next__entries').children;
  const action = (name: string, index = 0) => rows()[index].find(`.torst-up-next__${name}`).events['hover:enter']();

  for (const change of ['profile', 'url', 'removal']) {
    it(`restores library controls on Back after an instance ${change}`, async () => {
      await open();
      if (change === 'profile') instance.profileId = 'prf_two';
      else if (change === 'url') instance.url = 'http://other.test';
      else mock.method(InstanceManager, 'getInstances', () => []);
      const close = mock.method(Lampa.Modal, 'close');
      menu.onBack();
      assert.equal(close.mock.callCount(), 1);
      assert.equal(backs, 1);
    });
  }

  it('does not restore library controls after navigating to another activity', async () => {
    let activity = {};
    (Lampa as any).Activity = { active: () => activity };
    await open();
    activity = {};
    menu.onBack();
    assert.equal(backs, 0);
  });

  for (const stage of ['progress', 'preload']) {
    for (const exit of ['back', 'replacement']) {
      it(`cancels playback during ${stage} when the dialog closes through ${exit}`, async () => {
        mock.method(TorstEngine, 'startTorrentPlayback', startTorrentPlayback);
        (Lampa.Utils as any).bytesToSize = () => '';
        (Lampa.Utils as any).hash = (value: string) => value;
        (Lampa as any).Storage = { field: () => 'ask' };
        let finish!: () => void;
        mock.method(PlaybackProgress, 'prepare', () => stage === 'progress'
          ? new Promise<void>(resolve => { finish = resolve; }) : Promise.resolve());
        const preload = mock.method(PreloadModal, 'waitUntilReady', () => new Promise<boolean>(resolve => { finish = () => resolve(true); }));
        const capture = mock.method(TorstApi, 'captureTorrentRecovery', async () => { throw new Error('Unexpected recovery capture'); });
        const play = mock.fn();
        (Lampa.Player as any).play = play;
        await open();
        action('play');
        await flush();
        const signal = (TorstEngine.startTorrentPlayback as any).mock.calls[0].arguments[5] as AbortSignal;
        assert.equal(signal.aborted, false);
        assert.ok(finish);
        if (exit === 'back') menu.onBack();
        else await open();
        assert.equal(signal.aborted, true);
        finish();
        await flush();
        assert.equal(preload.mock.callCount(), stage === 'progress' ? 0 : 1);
        if (stage === 'preload') assert.equal(preload.mock.calls[0].arguments[5], signal);
        assert.equal(capture.mock.callCount(), 0);
        assert.equal(play.mock.callCount(), 0);
      });
    }
  }

  it('allows Back during loading without reopening the dialog after the response', async () => {
    let finish!: (entries: UpNextEntry[]) => void;
    mock.method(TorstApi, 'getUpNext', () => new Promise<UpNextEntry[]>(resolve => { finish = resolve; }));
    const close = mock.method(Lampa.Modal, 'close');
    const update = mock.method(Lampa.Modal, 'update');
    const pending = open();
    await flush();
    assert.ok(rows()[0].markup.includes('modal-loading'));
    menu.onBack();
    menu.onBack();
    finish([entry]);
    await pending;
    assert.equal(backs, 1);
    assert.equal(close.mock.callCount(), 1);
    assert.equal(update.mock.callCount(), 0);
  });

  it('ignores duplicate activations while dismissing and keeps the dialog open', async () => {
    let finish!: () => void;
    mock.method(TorstApi, 'dismissUpNext', () => new Promise<void>(resolve => { finish = resolve; }));
    await open();
    const close = mock.method(Lampa.Modal, 'close');
    action('dismiss');
    action('dismiss');
    action('play');
    assert.equal((TorstApi.dismissUpNext as any).mock.callCount(), 1);
    assert.equal((TorstApi.getTorrent as any).mock.callCount(), 0);
    mock.method(TorstApi, 'getUpNext', async () => []);
    finish();
    await flush();
    assert.equal(close.mock.callCount(), 0);
    assert.equal(rows()[0].textValue, getTestTranslation('torst_up_next_empty'));
  });

  it('shows resume positions and next episodes in server order', async () => {
    const next = { ...entry, id: 'upn_next', progress: null, reason: 'next_episode' };
    mock.method(TorstApi, 'getUpNext', async () => [entry, next]);
    await open();
    assert.equal(rows()[0].find('.torst-up-next__title').textValue, 'Show');
    assert.equal(rows()[0].find('.torst-up-next__status').textValue, getTestTranslation('torst_up_next_resume', { percent: 25 }));
    assert.equal(rows()[1].find('.torst-up-next__status').textValue, getTestTranslation('torst_up_next_episode'));
    assert.equal((TorstApi.getUpNext as any).mock.calls[0].arguments[1], 'prf_one');
  });

  it('resolves the opaque file ID to its metadata index and restores the view after playback', async () => {
    await open();
    action('play');
    await flush();
    const call = (TorstEngine.startTorrentPlayback as any).mock.calls[0];
    assert.equal(call.arguments[1], 2);
    assert.equal(call.arguments[3], instance);
    assert.equal(call.arguments[4], 'modal');
    assert.ok(exit);
    exit();
    await flush();
    assert.equal(menu.title, getTestTranslation('torst_up_next_title'));
  });

  it('labels the icon-only remove control for assistive technology and pointer users', async () => {
    await open();
    const row = rows()[0];
    const dismiss = row.find('.torst-up-next__dismiss');
    assert.equal(dismiss.textValue, '');
    assert.equal(dismiss.attributes['aria-label'], `${getTestTranslation('torst_up_next_dismiss')}: ${torrent.name} · ${entry.file.name}`);
    assert.equal(dismiss.attributes.title, getTestTranslation('torst_up_next_dismiss'));
    assert.match(row.markup, /<svg[^>]*aria-hidden="true"[^>]*focusable="false"/);
    assert.ok(dismiss.events['hover:enter']);
  });

  it('distinguishes remove controls for episodes of the same title', async () => {
    const next = { ...entry, file: torrent.files[1], id: 'upn_next' };
    mock.method(TorstApi, 'getUpNext', async () => [entry, next]);
    await open();
    const labels = rows().map(row => row.find('.torst-up-next__dismiss').attributes['aria-label']);
    assert.notEqual(labels[0], labels[1]);
    assert.ok(labels[0].includes(entry.file.name));
    assert.ok(labels[1].includes(next.file.name));
  });

  it('dismisses an entry without deleting its progress or torrent', async () => {
    await open();
    action('dismiss');
    await flush();
    assert.deepEqual((TorstApi.dismissUpNext as any).mock.calls[0].arguments, [instance, 'prf_one', 'upn_one']);
    assert.equal(menu.title, getTestTranslation('torst_up_next_title'));
  });

  it('handles an empty view and requires a selected profile', async () => {
    mock.method(TorstApi, 'getUpNext', async () => []);
    await open();
    assert.equal(rows()[0].textValue, getTestTranslation('torst_up_next_empty'));
    menu.onBack();
    delete instance.profileId;
    await open();
    assert.equal(backs, 2);
    assert.equal(notices[0], getTestTranslation('torst_profile_required'));
  });

  it('returns to the view when playback is canceled or its file is no longer present', async () => {
    mock.method(TorstEngine, 'startTorrentPlayback', async () => false);
    await open();
    action('play');
    await flush();
    assert.equal(menu.title, getTestTranslation('torst_up_next_title'));
    torrent.files = [];
    action('play');
    await flush();
    assert.equal(notices.length, 1);
  });

  it('does not play a stale entry after the instance changes profiles', async () => {
    await open();
    instance.profileId = 'prf_two';
    action('play');
    await flush();
    assert.equal((TorstEngine.startTorrentPlayback as any).mock.callCount(), 0);
  });

  it('reports list and dismissal failures without losing the return path', async () => {
    mock.method(TorstApi, 'dismissUpNext', async () => { throw new Error('offline'); });
    await open();
    action('dismiss');
    await flush();
    assert.ok(notices[0].includes('offline'));
    mock.method(TorstApi, 'getUpNext', async () => { throw new Error('unavailable'); });
    await open();
    assert.ok(rows()[0].textValue.includes('unavailable'));
    menu.onBack();
    assert.equal(backs, 1);
  });

  it('inserts untrusted torrent and file names as text', async () => {
    torrent.title = 'Show <img src=x';
    entry.file.name = '{size} $&';
    await open();
    assert.equal(rows()[0].find('.torst-up-next__title').textValue, torrent.title);
    assert.equal(rows()[0].find('.torst-up-next__file').textValue, entry.file.name);
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
    assert.ok(menu.html.find('.torst-up-next__entries').children[0].markup.includes('modal-loading'));
    const second = open();
    await flush();
    instance.url = 'http://other.test';
    resolve([entry]);
    await second;
    assert.ok(menu.html.find('.torst-up-next__entries').children[0].markup.includes('modal-loading'));
    assert.equal(backs, 0);
  });

  it('does not play metadata loaded for a URL or activity that has changed', async () => {
    let activity = {};
    (globalThis as any).Lampa.Activity = { active: () => activity };
    let finish!: (value: Torrent) => void;
    mock.method(TorstApi, 'getTorrent', () => new Promise<Torrent>(resolve => { finish = resolve; }));
    for (const change of [() => { instance.url = 'http://other.test'; }, () => { activity = {}; }]) {
      await open();
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
    action('play');
    mock.method(InstanceManager, 'getInstances', () => []);
    finish(torrent);
    await flush();
    assert.equal((TorstEngine.startTorrentPlayback as any).mock.callCount(), 0);
  });
});
