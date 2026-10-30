// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { TorstApi, TorstApiError } from '../src/api/torst';
import { ExternalProgress } from '../src/engine/external-progress';
import { PlaybackFocus } from '../src/engine/playback-focus';
import { PlaybackProgress } from '../src/engine/playback-progress';
import { playTorrentFile } from '../src/engine/playback-session';
import { resetPlayerPlaylistForTesting } from '../src/engine/player-playlist';
import { InstanceManager } from '../src/instances/instance-manager';
import { FileProgress, FileViewing, ProgressUpdate, TorstInstance } from '../src/types/torst';
import { PreloadModal } from '../src/ui/preload-modal';

const viewing: FileViewing = { duration_seconds: 400, id: 'vwg_one', links: { self: '/api/v1/torrents/trr_one/files/fil_one/viewings/vwg_one' }, position_seconds: 140, streaming: false };
const saved: FileProgress = { completion_ratio: 0.25, duration_seconds: 400, file_id: 'fil_one', position_seconds: 100, updated_at: '2026-10-30T10:00:00Z', viewed: false, viewed_at: null };
const settle = () => new Promise(resolve => setImmediate(resolve));

describe('external player progress', () => {
  const originalLampa = (globalThis as any).Lampa;
  const originalWindow = (globalThis as any).window;
  const originalDocument = (globalThis as any).document;
  let browser: EventTarget;
  let page: EventTarget & { visibilityState: string };
  let instance: TorstInstance;
  let activity: object;
  let timelines: Map<number | string, any>;
  let listeners: Map<string, (event: any) => void>;
  let item: LampaPlayerItem;

  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000 });
    browser = new EventTarget();
    page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    instance = { authType: 'none', id: 'one', name: 'One', url: 'http://torst.test' };
    activity = {};
    timelines = new Map();
    listeners = new Map();
    (globalThis as any).window = browser;
    (globalThis as any).document = page;
    const view = (hash: number | string) => ({
      ...timelines.get(hash), handler: (percent: number, time: number, duration: number) => timelines.set(hash, { duration, hash, percent, time }), hash,
    });
    (globalThis as any).Lampa = {
      Activity: { active: () => activity },
      Noty: { show: () => {} },
      Player: {
        listener: {
          follow: (name: string, callback: (event: any) => void) => {
            const previous = listeners.get(name);
            listeners.set(name, event => { previous?.(event); callback(event); });
          },
          remove: (name: string) => listeners.delete(name),
        },
      },
      Timeline: { update: (value: any) => timelines.set(value.hash, { ...value }), view },
      Torserver: { parse: () => ({ hash: 'local' }) },
      Utils: { hash: (value: string) => value },
    };
    item = { path: 'Sintel.mkv', timeline: view('local'), torstFileId: 'fil_one' };
    mock.method(InstanceManager, 'getInstances', () => [instance]);
    mock.method(TorstApi, 'getStreamUrl', async () => 'http://torst.test/api/v1/torrents/trr_one/files/fil_one/content?token=playback');
    mock.method(TorstApi, 'createFileViewing', async () => viewing);
    mock.method(TorstApi, 'getFileViewing', async () => viewing);
    mock.method(TorstApi, 'deleteFileViewing', async () => {});
    mock.method(TorstApi, 'getTorrentProgress', async () => [saved]);
    mock.method(TorstApi, 'getTitleProgress', async () => []);
    mock.method(TorstApi, 'saveFileProgress', async (_instance: TorstInstance, _profile: string, _hash: string, _file: string, progress: ProgressUpdate) => ({ ...saved, ...progress }));
    mock.method(TorstApi, 'saveTitleProgress', async (_instance: TorstInstance, _profile: string, titleKey: string, _hash: string, fileId: string, progress: ProgressUpdate) => ({ ...saved, ...progress, file_id: fileId, title_key: titleKey, torrent_id: 'trr_one' }));
  });

  afterEach(() => {
    ExternalProgress.resetForTesting();
    PlaybackFocus.resetForTesting();
    resetPlayerPlaylistForTesting();
    PlaybackProgress.resetForTesting();
    mock.timers.reset();
    mock.restoreAll();
    (globalThis as any).Lampa = originalLampa;
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
  });

  const arm = () => {
    ExternalProgress.bind(item, viewing);
    ExternalProgress.arm(instance, [item]);
    listeners.get('external')!(item);
  };
  const returnToLampa = async () => {
    browser.dispatchEvent(new Event('blur'));
    browser.dispatchEvent(new Event('focus'));
    mock.timers.tick(2000);
    await settle();
  };
  const useProfile = async () => {
    instance.profileId = 'prf_one';
    await PlaybackProgress.prepare(instance, 'torrent', [item], { id: 123 });
    const hash = PlaybackProgress.timelineHash(instance, 'fil_one', 'local');
    item.timeline = PlaybackProgress.trackTimeline((globalThis as any).Lampa.Timeline.view(hash));
    return hash;
  };

  it('adds an isolated viewing ID while keeping the stream playback token', async () => {
    const stream = await ExternalProgress.getStream(instance, 'torrent', { fileId: 'fil_one', index: 0, path: item.path });
    const url = new URL(stream.url);
    assert.equal(url.searchParams.get('token'), 'playback');
    assert.equal(url.searchParams.get('viewing_id'), 'vwg_one');
    assert.equal(stream.viewing, viewing);
    assert.deepEqual((TorstApi.createFileViewing as any).mock.calls[0].arguments.slice(1), ['torrent', { index: 0, path: item.path }]);
  });

  it('keeps playback available without repeating a failed viewing creation', async () => {
    mock.method(TorstApi, 'createFileViewing', async () => { throw new Error('reply lost'); });
    const stream = await ExternalProgress.getStream(instance, 'torrent', { fileId: 'fil_one', index: 0 });
    assert.equal(new URL(stream.url).searchParams.has('viewing_id'), false);
    assert.equal((TorstApi.createFileViewing as any).mock.callCount(), 1);
  });

  for (const malformed of [null, {}, { id: '' }, { id: 'vwg_one', links: { self: 'https://other.test/viewing' } }]) {
    it(`keeps the plain stream when the viewing response is malformed (${JSON.stringify(malformed)})`, async () => {
      mock.method(TorstApi, 'createFileViewing', async () => malformed as FileViewing);
      const stream = await ExternalProgress.getStream(instance, 'torrent', { fileId: 'fil_one', index: 0 });
      assert.equal(new URL(stream.url).searchParams.has('viewing_id'), false);
      assert.equal(stream.viewing, undefined);
      assert.equal((TorstApi.createFileViewing as any).mock.callCount(), 1);
    });
  }

  it('releases a viewing created after its instance URL changes', async () => {
    mock.method(TorstApi, 'createFileViewing', async () => { instance.url = 'http://other.test'; return viewing; });
    await assert.rejects(ExternalProgress.getStream(instance, 'torrent', { fileId: 'fil_one', index: 0 }), /settings changed/);
    assert.equal((TorstApi.deleteFileViewing as any).mock.calls[0].arguments[0].url, 'http://torst.test');
  });

  it('saves a return estimate only to the native timeline in local mode', async () => {
    arm();
    await returnToLampa();
    assert.equal(timelines.get('local').time, 140);
    assert.equal(timelines.get('local').percent, 35);
    assert.equal((TorstApi.saveFileProgress as any).mock.callCount(), 0);
    assert.equal((TorstApi.saveTitleProgress as any).mock.callCount(), 0);
    assert.equal((TorstApi.deleteFileViewing as any).mock.callCount(), 1);
    await returnToLampa();
    assert.equal((TorstApi.getFileViewing as any).mock.callCount(), 1);
  });

  it('saves file and title progress in profile mode while preserving native local records', async () => {
    timelines.set('local', { time: 50 });
    const hash = await useProfile();
    arm();
    await returnToLampa();
    assert.equal(timelines.get(hash).time, 140);
    assert.equal(timelines.get('local').time, 50);
    assert.deepEqual((TorstApi.saveFileProgress as any).mock.calls[0].arguments.slice(1), ['prf_one', 'torrent', 'fil_one', { duration_seconds: 400, position_seconds: 140, viewed: false }]);
    assert.deepEqual((TorstApi.saveTitleProgress as any).mock.calls[0].arguments.slice(1), ['prf_one', 'tmdb-movie-123', 'torrent', 'fil_one', { duration_seconds: 400, position_seconds: 140, viewed: false }]);
  });

  it('waits for an exact report during the return grace period and preserves it', async () => {
    await useProfile();
    arm();
    browser.dispatchEvent(new Event('blur'));
    browser.dispatchEvent(new Event('focus'));
    (item.timeline as any).handler(50, 200, 400);
    mock.timers.tick(2000);
    await settle();
    assert.equal(timelines.get((item.timeline as any).hash).time, 200);
    assert.equal((TorstApi.saveFileProgress as any).mock.callCount(), 1);
    assert.equal((TorstApi.saveFileProgress as any).mock.calls[0].arguments[4].position_seconds, 200);
  });

  it('does not suppress the fallback for an invalid player report', async () => {
    arm();
    (item.timeline as any).handler(0, 100, 1000001);
    await returnToLampa();
    assert.equal(timelines.get('local').time, 140);
  });

  it('recognizes numeric position strings as an exact report', async () => {
    await useProfile();
    arm();
    (item.timeline as any).handler(50, '200', '400');
    await returnToLampa();
    assert.equal((TorstApi.saveFileProgress as any).mock.callCount(), 1);
    assert.equal((TorstApi.saveFileProgress as any).mock.calls[0].arguments[4].position_seconds, 200);
  });

  it('starts fallback tracking anew when an item launches externally again', async () => {
    arm();
    (item.timeline as any).handler(50, 200, 400);
    listeners.get('external')!(item);
    await returnToLampa();
    assert.equal(timelines.get('local').time, 140);
  });

  it('discards the previous return measurement while a new playback is preloading', async () => {
    arm();
    let finishRead!: (value: FileViewing) => void;
    mock.method(TorstApi, 'getFileViewing', () => new Promise<FileViewing>(resolve => { finishRead = resolve; }));
    await returnToLampa();
    let finishPreload!: (value: boolean) => void;
    mock.method(PreloadModal, 'waitUntilReady', () => new Promise<boolean>(resolve => { finishPreload = resolve; }));
    (globalThis as any).Lampa.Storage = { field: () => 'continue' };
    const starting = playTorrentFile(instance, 'torrent', 0, item, [item]);
    await settle();
    finishRead(viewing);
    await settle();
    assert.equal(timelines.size, 0);
    finishPreload(false);
    assert.equal(await starting, false);
  });

  it('preserves an exact report delivered while the viewing read is pending', async () => {
    arm();
    let finish!: (value: FileViewing) => void;
    mock.method(TorstApi, 'getFileViewing', () => new Promise<FileViewing>(resolve => { finish = resolve; }));
    await returnToLampa();
    (item.timeline as any).handler(50, 200, 400);
    finish(viewing);
    await settle();
    assert.equal(timelines.get('local').time, 200);
  });

  for (const values of [
    { duration_seconds: null, position_seconds: null },
    { duration_seconds: 400, position_seconds: 5 },
    { duration_seconds: 400, position_seconds: -1 },
    { duration_seconds: 0, position_seconds: 100 },
    { duration_seconds: 400, position_seconds: 500 },
    { duration_seconds: NaN, position_seconds: 100 },
  ]) {
    it(`leaves progress unchanged for an unusable viewing (${JSON.stringify(values)})`, async () => {
      mock.method(TorstApi, 'getFileViewing', async () => ({ ...viewing, ...values }));
      arm();
      await returnToLampa();
      assert.equal(timelines.has('local'), false);
      assert.equal((TorstApi.saveFileProgress as any).mock.callCount(), 0);
    });
  }

  it('marks completion at ninety percent in both modes', async () => {
    mock.method(TorstApi, 'getFileViewing', async () => ({ ...viewing, position_seconds: 360 }));
    arm();
    await returnToLampa();
    assert.equal(timelines.get('local').percent, 100);
    assert.equal(timelines.get('local').time, 0);
    await useProfile();
    arm();
    await returnToLampa();
    assert.equal((TorstApi.saveFileProgress as any).mock.calls[0].arguments[4].viewed, true);
  });

  it('lets a late exact report correct an estimated completion mark', async () => {
    await useProfile();
    mock.method(TorstApi, 'getFileViewing', async () => ({ ...viewing, position_seconds: 360 }));
    arm();
    await returnToLampa();
    assert.equal((TorstApi.saveFileProgress as any).mock.calls[0].arguments[4].viewed, true);
    (item.timeline as any).handler(50, 200, 400);
    await PlaybackProgress.flush();
    const corrected = (TorstApi.saveFileProgress as any).mock.calls[1].arguments[4];
    assert.equal(corrected.position_seconds, 200);
    assert.equal(corrected.viewed, false);
  });

  it('preserves an estimated completion mark across later fallback saves', async () => {
    await useProfile();
    let position = 360;
    mock.method(TorstApi, 'getFileViewing', async () => ({ ...viewing, position_seconds: position, streaming: true }));
    arm();
    await returnToLampa();
    position = 200;
    await returnToLampa();
    for (const method of [TorstApi.saveFileProgress, TorstApi.saveTitleProgress]) {
      const calls = (method as any).mock.calls;
      assert.equal(calls.length, 2);
      assert.equal(calls[0].arguments[calls[0].arguments.length - 1].viewed, true);
      assert.equal(calls[1].arguments[calls[1].arguments.length - 1].viewed, true);
      assert.equal(calls[1].arguments[calls[1].arguments.length - 1].position_seconds, 200);
    }
    (item.timeline as any).handler(50, 200, 400);
    await PlaybackProgress.flush();
    assert.equal((TorstApi.saveFileProgress as any).mock.calls[2].arguments[4].viewed, false);
    assert.equal((TorstApi.saveTitleProgress as any).mock.calls[2].arguments[5].viewed, false);
  });

  it('keeps an existing server viewed mark when an exact report replaces an estimate', async () => {
    mock.method(TorstApi, 'getTorrentProgress', async () => [{ ...saved, viewed: true }]);
    await useProfile();
    arm();
    await returnToLampa();
    (item.timeline as any).handler(50, 200, 400);
    await PlaybackProgress.flush();
    assert.equal((TorstApi.saveFileProgress as any).mock.calls[1].arguments[4].viewed, true);
  });

  it('measures later returns while the same external stream is still open', async () => {
    const read = mock.method(TorstApi, 'getFileViewing', async () => ({ ...viewing, streaming: true }));
    arm();
    await returnToLampa();
    assert.equal((TorstApi.deleteFileViewing as any).mock.callCount(), 0);
    await returnToLampa();
    assert.equal(read.mock.callCount(), 2);
  });

  for (const change of ['profile', 'url', 'navigation', 'playback', 'removed']) {
    it(`discards a delayed estimate after ${change} changes`, async () => {
      let instances = [instance];
      mock.method(InstanceManager, 'getInstances', () => instances);
      arm();
      let finish!: (value: FileViewing) => void;
      mock.method(TorstApi, 'getFileViewing', () => new Promise<FileViewing>(resolve => { finish = resolve; }));
      await returnToLampa();
      if (change === 'profile') instance.profileId = 'prf_other';
      if (change === 'url') instance.url = 'http://other.test';
      if (change === 'navigation') activity = {};
      if (change === 'playback') listeners.get('create')!({ data: {} });
      if (change === 'removed') instances = [];
      finish(viewing);
      await settle();
      assert.equal(timelines.has('local'), false);
      assert.equal((TorstApi.saveFileProgress as any).mock.callCount(), 0);
    });
  }

  it('handles visibility returns, duplicate events, and the native exit callback once', async () => {
    arm();
    page.visibilityState = 'hidden';
    page.dispatchEvent(new Event('visibilitychange'));
    page.visibilityState = 'visible';
    page.dispatchEvent(new Event('visibilitychange'));
    browser.dispatchEvent(new Event('focus'));
    ExternalProgress.handleExit();
    mock.timers.tick(2000);
    await settle();
    assert.equal((TorstApi.getFileViewing as any).mock.callCount(), 1);
  });

  it('does not treat built-in playback as an external return and releases its viewing on exit', async () => {
    ExternalProgress.bind(item, viewing);
    ExternalProgress.arm(instance, [item]);
    await returnToLampa();
    assert.equal((TorstApi.getFileViewing as any).mock.callCount(), 0);
    ExternalProgress.handleExit();
    assert.equal((TorstApi.deleteFileViewing as any).mock.callCount(), 1);
  });

  it('detects a suspended runtime returning without visibility events', async () => {
    arm();
    mock.timers.setTime(11000);
    mock.timers.tick(1000);
    mock.timers.tick(2000);
    await settle();
    assert.equal(timelines.get('local').time, 140);
  });

  it('reads a valid viewing after the external player has been open for more than twelve hours', async () => {
    arm();
    mock.timers.setTime(13 * 60 * 60 * 1000);
    mock.timers.tick(1000);
    mock.timers.tick(2000);
    await settle();
    assert.equal(timelines.get('local').time, 140);
    assert.equal((TorstApi.getFileViewing as any).mock.callCount(), 1);
  });

  for (const hasProfile of [false, true]) {
    it(`connects the player hand-off, focus restoration, and return saving (${hasProfile ? 'Torst profile' : 'local'})`, async () => {
      if (hasProfile) instance.profileId = 'prf_one';
      const lampa = (globalThis as any).Lampa;
      lampa.Storage = { field: () => 'continue' };
      let restored = 0;
      lampa.Controller = { toggle: () => { restored++; } };
      let played!: LampaPlayerItem;
      let playlist: LampaPlayerItem[] = [];
      lampa.Player.playlist = (items: LampaPlayerItem[]) => { playlist = items; };
      lampa.Player.callback = () => {};
      lampa.Player.play = (current: LampaPlayerItem) => {
        played = current;
        listeners.get('create')!({ data: current });
        listeners.get('external')!(current);
      };
      mock.method(PreloadModal, 'waitUntilReady', async () => true);
      assert.equal(await playTorrentFile(instance, 'torrent', 0, item, [item], { id: 123 }), true);
      assert.equal(played, playlist[0]);
      assert.equal(new URL(played.url as string).searchParams.get('viewing_id'), 'vwg_one');
      await returnToLampa();
      assert.equal(restored, 1);
      assert.equal(timelines.get((played.timeline as any).hash).time, 140);
      assert.equal((TorstApi.saveFileProgress as any).mock.callCount(), hasProfile ? 1 : 0);
    });
  }

  for (const change of ['navigation', 'playback', 'profile', 'removed', 'none']) {
    for (const outcome of ['resolved', 'rejected']) {
      it(`handles a ${outcome} lazy episode request (${change})`, async () => {
        const lampa = (globalThis as any).Lampa;
        lampa.Storage = { field: () => 'continue' };
        lampa.Controller = { toggle: () => {} };
        let handed: LampaPlayerItem[] = [];
        lampa.Player.playlist = (items: LampaPlayerItem[]) => { handed = items; };
        lampa.Player.callback = () => {};
        let closed = 0;
        lampa.Player.close = () => { closed++; };
        lampa.Player.play = () => {};
        mock.method(PreloadModal, 'waitUntilReady', async () => true);
        const next = { file_index: 1, path: 'Spring.mkv', torstFileId: 'fil_two' };
        await playTorrentFile(instance, 'torrent', 0, item, [item, next]);
        let finish!: (value: FileViewing) => void;
        let fail!: (error: Error) => void;
        if (outcome === 'resolved') {
          mock.method(TorstApi, 'createFileViewing', () => new Promise<FileViewing>(resolve => { finish = resolve; }));
        } else {
          mock.method(TorstApi, 'getStreamUrl', () => new Promise<string>((_resolve, reject) => { fail = reject; }));
        }
        let launches = 0;
        (handed[1].url as (callback: () => void) => void)(() => { launches++; });
        await settle();
        if (change === 'navigation') activity = {};
        if (change === 'playback') listeners.get('create')!({ data: {} });
        if (change === 'profile') instance.profileId = 'prf_other';
        if (change === 'removed') mock.method(InstanceManager, 'getInstances', () => []);
        const secondViewing = { ...viewing, id: 'vwg_two' };
        if (outcome === 'resolved') finish(secondViewing);
        else fail(new Error('viewing unavailable'));
        await settle();
        assert.equal(launches, change === 'none' && outcome === 'resolved' ? 1 : 0);
        assert.equal(closed, change === 'none' && outcome === 'rejected' ? 1 : 0);
        if (change === 'none' && outcome === 'resolved') assert.equal(new URL(handed[1].url as string).searchParams.get('viewing_id'), 'vwg_two');
        else if (outcome === 'resolved') assert.ok((TorstApi.deleteFileViewing as any).mock.calls.some((call: any) => call.arguments[1] === secondViewing));
      });
    }
  }

  it('keeps episode viewing IDs and resume points separate', async () => {
    const second: LampaPlayerItem = { path: 'Spring.mkv', timeline: (globalThis as any).Lampa.Timeline.view('second'), torstFileId: 'fil_two' };
    const secondViewing = { ...viewing, id: 'vwg_two', links: { self: '/api/v1/torrents/trr_one/files/fil_two/viewings/vwg_two' } };
    ExternalProgress.bind(item, viewing);
    ExternalProgress.bind(second, secondViewing);
    ExternalProgress.arm(instance, [item, second]);
    listeners.get('external')!(second);
    await returnToLampa();
    assert.equal((TorstApi.getFileViewing as any).mock.calls[0].arguments[1].id, 'vwg_two');
    assert.equal(timelines.has('local'), false);
    assert.equal(timelines.get('second').time, 140);
  });

  it('ignores an earlier episode read after another episode launches', async () => {
    const second: LampaPlayerItem = { path: 'Spring.mkv', timeline: (globalThis as any).Lampa.Timeline.view('second'), torstFileId: 'fil_two' };
    ExternalProgress.bind(item, viewing);
    ExternalProgress.bind(second, { ...viewing, id: 'vwg_two' });
    ExternalProgress.arm(instance, [item, second]);
    listeners.get('external')!(item);
    let finish!: (value: FileViewing) => void;
    mock.method(TorstApi, 'getFileViewing', () => new Promise<FileViewing>(resolve => { finish = resolve; }));
    await returnToLampa();
    listeners.get('external')!(second);
    finish(viewing);
    await settle();
    assert.equal(timelines.size, 0);
  });

  it('does not delete a viewing that an abandoned external player may still stream', async () => {
    arm();
    mock.method(TorstApi, 'getFileViewing', async () => ({ ...viewing, streaming: true }));
    await returnToLampa();
    listeners.get('create')!({ data: {} });
    assert.equal((TorstApi.deleteFileViewing as any).mock.callCount(), 0);
  });

  it('discards a read completed after the page leaves for the player again', async () => {
    arm();
    let finish!: (value: FileViewing) => void;
    mock.method(TorstApi, 'getFileViewing', () => new Promise<FileViewing>(resolve => { finish = resolve; }));
    await returnToLampa();
    page.visibilityState = 'hidden';
    finish(viewing);
    await settle();
    assert.equal(timelines.size, 0);
  });

  it('does not release the next built-in stream when an earlier external read completes', async () => {
    const next: LampaPlayerItem = { path: 'Spring.mkv', timeline: (globalThis as any).Lampa.Timeline.view('second'), torstFileId: 'fil_two' };
    const nextViewing = { ...viewing, id: 'vwg_two' };
    ExternalProgress.bind(item, viewing);
    ExternalProgress.bind(next, nextViewing);
    ExternalProgress.arm(instance, [item, next]);
    listeners.get('external')!(item);
    let finish!: (value: FileViewing) => void;
    mock.method(TorstApi, 'getFileViewing', () => new Promise<FileViewing>(resolve => { finish = resolve; }));
    await returnToLampa();
    listeners.get('create')!({ data: next });
    finish(viewing);
    await settle();
    assert.equal(timelines.size, 0);
    assert.equal((TorstApi.deleteFileViewing as any).mock.callCount(), 0);
    ExternalProgress.handleExit();
    assert.deepEqual((TorstApi.deleteFileViewing as any).mock.calls.map((call: any) => call.arguments[1].id), ['vwg_two']);
  });

  it('can measure a new external launch while an old launch read is still pending', async () => {
    const next: LampaPlayerItem = { path: 'Spring.mkv', timeline: (globalThis as any).Lampa.Timeline.view('second'), torstFileId: 'fil_two' };
    ExternalProgress.bind(item, viewing);
    ExternalProgress.bind(next, { ...viewing, id: 'vwg_two' });
    ExternalProgress.arm(instance, [item, next]);
    listeners.get('external')!(item);
    let finish!: (value: FileViewing) => void;
    let reads = 0;
    mock.method(TorstApi, 'getFileViewing', async () => ++reads === 1 ? new Promise<FileViewing>(resolve => { finish = resolve; }) : viewing);
    await returnToLampa();
    listeners.get('create')!({ data: next });
    listeners.get('external')!(next);
    await returnToLampa();
    assert.equal(reads, 2);
    assert.equal(timelines.get('second').time, 140);
    finish(viewing);
    await settle();
    assert.equal(timelines.has('local'), false);
  });

  it('keeps a relaunched viewing while an earlier progress save finishes', async () => {
    await useProfile();
    arm();
    let finish!: (value: FileProgress) => void;
    mock.method(TorstApi, 'saveFileProgress', () => new Promise<FileProgress>(resolve => { finish = resolve; }));
    await returnToLampa();
    listeners.get('external')!(item);
    finish(saved);
    await settle();
    assert.equal((TorstApi.deleteFileViewing as any).mock.callCount(), 0);
    assert.equal(ExternalProgress.isTracked(item), true);
  });

  it('stops tracking a viewing that the instance no longer has', async () => {
    mock.method(TorstApi, 'getFileViewing', async () => { throw new TorstApiError('Viewing expired', 404); });
    arm();
    await returnToLampa();
    await returnToLampa();
    assert.equal((TorstApi.getFileViewing as any).mock.callCount(), 1);
    assert.equal(ExternalProgress.isTracked(item), false);
  });

  it('leaves progress unchanged when the server cannot read the viewing', async () => {
    mock.method(TorstApi, 'getFileViewing', async () => { throw new Error('viewing expired'); });
    arm();
    await returnToLampa();
    assert.equal(timelines.has('local'), false);
  });
});
