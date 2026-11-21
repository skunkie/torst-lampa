// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { AuthenticationError } from '../src/api/auth';
import { TorstApi, TorstApiError } from '../src/api/torst';
import { ExternalProgress } from '../src/engine/external-progress';
import { PlaybackFocus } from '../src/engine/playback-focus';
import { PlaybackRecovery } from '../src/engine/playback-recovery';
import { playTorrentFile } from '../src/engine/playback-session';
import { resetPlayerPlaylistForTesting } from '../src/engine/player-playlist';
import { InstanceManager } from '../src/instances/instance-manager';
import { FileViewing, Torrent, TorrentRecoverySource, TorstInstance } from '../src/types/torst';
import { PreloadModal } from '../src/ui/preload-modal';
import { createTestLanguage, getTestTranslation } from './support/translations';

const hash = 'a'.repeat(40);
const oldViewing: FileViewing = { duration_seconds: 400, id: 'vwg_old', links: { self: '/api/v1/torrents/trr_old/files/fil_one/viewings/vwg_old' }, position_seconds: 200, streaming: true };
const freshViewing = { ...oldViewing, id: 'vwg_new', links: { self: '/api/v1/torrents/trr_new/files/fil_one/viewings/vwg_new' } };
const torrent: Torrent = { files: [{ fileId: 'fil_other', length: 100, name: 'Spring.mkv', path: 'Spring.mkv' }, { fileId: 'fil_one', length: 100, name: 'Sintel.mkv', path: 'Sintel.mkv' }], hash, id: 'trr_new', name: 'Sintel', retention: 'temporary', storage: 'memory', total_size: 200 };
const source: TorrentRecoverySource = { metainfo: new Blob(['private metainfo']), torrent: { ...torrent, id: 'trr_old' } };
const settle = () => new Promise(resolve => setImmediate(resolve));

function createListenerHub() {
  const callbacks = new Map<string, Set<(event: any) => void>>();
  return {
    emit: (name: string, event: any = {}) => { callbacks.get(name)?.forEach(callback => callback(event)); },
    follow: (name: string, callback: (event: any) => void) => { if (!callbacks.has(name)) callbacks.set(name, new Set()); callbacks.get(name)!.add(callback); },
    remove: (name: string, callback: (event: any) => void) => callbacks.get(name)?.delete(callback),
  };
}

describe('playback restart recovery', () => {
  const originalLampa = (globalThis as any).Lampa;
  const originalWindow = (globalThis as any).window;
  const originalDocument = (globalThis as any).document;
  let instance: TorstInstance;
  let instances: TorstInstance[];
  let activity: object;
  let browser: EventTarget;
  let page: EventTarget & { visibilityState: string };
  let player: ReturnType<typeof createListenerHub>;
  let video: ReturnType<typeof createListenerHub>;
  let item: LampaPlayerItem;
  let next: LampaPlayerItem;
  let notices: string[];
  let menu: any;
  let relaunched: LampaPlayerItem[];
  let resumed: string[];
  let seeks: number[];
  let hasRestarted: boolean;
  let isLoading: boolean;
  let cancelLoading: () => void;
  let controller: string;
  let closes: number;

  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000 });
    instance = { authType: 'none', id: 'one', name: 'One', profileId: 'prf_one', url: 'http://torst.test' };
    instances = [instance];
    activity = {};
    browser = new EventTarget();
    page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    player = createListenerHub();
    video = createListenerHub();
    notices = [];
    relaunched = [];
    resumed = [];
    seeks = [];
    menu = undefined;
    hasRestarted = true;
    isLoading = false;
    cancelLoading = () => {};
    controller = 'content';
    closes = 0;
    item = { file_index: 0, path: 'Sintel.mkv', timeline: { duration: 400, handler: () => {}, hash: 'scoped', percent: 25, time: 100 }, torstFileId: 'fil_one', url: 'http://torst.test/content?viewing_id=vwg_old' };
    next = { file_index: 1, path: 'Spring.mkv', timeline: { duration: 400, hash: 'other', time: 0 }, torstFileId: 'fil_other' };
    (globalThis as any).window = browser;
    (globalThis as any).document = page;
    (globalThis as any).Lampa = {
      Activity: { active: () => activity },
      Controller: { enabled: () => ({ name: controller }), toggle: (name: string) => { controller = name; } },
      Lang: createTestLanguage(),
      Loading: {
        start: (onCancel: () => void) => { assert.equal(isLoading, false); isLoading = true; cancelLoading = onCancel; },
        stop: () => { isLoading = false; },
      },
      Noty: { show: (text: string) => notices.push(text) },
      Player: { close: () => { closes++; }, listener: player, loading: () => {} },
      PlayerVideo: { listener: video, to: (position: number) => seeks.push(position), video: () => ({ currentTime: 145, duration: 400 }) },
      Select: { show: (options: unknown) => { menu = options; } },
      Timeline: { update: () => {} },
    };
    mock.method(InstanceManager, 'getInstances', () => instances);
    mock.method(TorstApi, 'captureTorrentRecovery', async () => ({ ...source, torrent: { ...source.torrent } }));
    mock.method(TorstApi, 'getFileViewing', async () => { if (hasRestarted) throw new TorstApiError('Viewing expired', 404); return oldViewing; });
    mock.method(TorstApi, 'checkHealth', async () => ({ isOk: true, latencyMs: 1 }));
    mock.method(TorstApi, 'recoverTorrent', async () => ({ ...torrent, files: [...torrent.files] }));
    mock.method(TorstApi, 'getRecoveredStreamUrl', async () => 'http://torst.test/api/v1/torrents/trr_new/files/fil_one/content?token=fresh');
    mock.method(TorstApi, 'createFileViewing', async () => freshViewing);
    mock.method(TorstApi, 'deleteFileViewing', async () => {});
    mock.method(PreloadModal, 'waitUntilReady', async () => { assert.equal(isLoading, false); return true; });
  });
  afterEach(() => {
    PlaybackFocus.resetForTesting();
    resetPlayerPlaylistForTesting();
    PlaybackRecovery.resetForTesting();
    ExternalProgress.resetForTesting();
    mock.timers.reset();
    mock.restoreAll();
    (globalThis as any).Lampa = originalLampa;
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
  });

  const arm = (isExternal = false) => {
    ExternalProgress.bind(item, oldViewing);
    ExternalProgress.arm(instance, [item, next], () => PlaybackRecovery.cancel(), () => PlaybackRecovery.handleExternalReturn());
    PlaybackRecovery.arm(instance, hash, [item, next], { ...source, torrent: { ...source.torrent } }, {}, 'content', current => relaunched.push(current));
    player.emit('create', { data: item });
    if (isExternal) player.emit('external', item);
  };
  const getMenu = (): any => menu;
  const recover = () => item.error!(item, url => resumed.push(url));
  const returnFromPlayer = async () => { browser.dispatchEvent(new Event('focus')); mock.timers.tick(2500); await settle(); };

  it('captures recovery material only in memory and tolerates capture failures', async () => {
    assert.ok(await PlaybackRecovery.capture(instance, hash));
    mock.method(TorstApi, 'captureTorrentRecovery', async () => { throw new Error('Unavailable'); });
    assert.equal(await PlaybackRecovery.capture(instance, hash), undefined);
    delete (globalThis as any).Lampa.Player.listener;
    assert.equal(await PlaybackRecovery.capture(instance, hash), undefined);
  });

  it('drops private metainfo even when player callbacks retain the canceled session', () => {
    arm();
    const session = (PlaybackRecovery as any).session;
    assert.ok(session.source.metainfo);
    PlaybackRecovery.cancel();
    assert.equal(session.source, undefined);
  });

  it('reconnects the internal player with a fresh viewing and seeks to its actual reported position', async () => {
    arm();
    recover();
    await settle();
    assert.equal(resumed.length, 1);
    assert.equal(new URL(resumed[0]).searchParams.get('viewing_id'), 'vwg_new');
    assert.equal(item.file_index, 1);
    assert.equal(item.url, resumed[0]);
    assert.equal((PreloadModal.waitUntilReady as any).mock.calls[0].arguments[2].index, 1);
    assert.equal((PreloadModal.waitUntilReady as any).mock.calls[0].arguments[4], 145 / 400);
    assert.equal(seeks.length, 0);
    video.emit('loadeddata');
    assert.deepEqual(seeks, [145]);
    video.emit('loadeddata');
    assert.deepEqual(seeks, [145]);
    assert.equal(isLoading, false);
  });

  for (const isExternal of [false, true]) {
    it(`connects recovery to the real ${isExternal ? 'external' : 'internal'} player hand-off`, async () => {
      delete instance.profileId;
      const lampa = (globalThis as any).Lampa;
      let plays = 0;
      let played!: LampaPlayerItem;
      let handed: LampaPlayerItem[] = [];
      let timelineReports = 0;
      lampa.Storage = { field: () => 'continue' };
      lampa.Utils = { hash: (text: string) => text };
      lampa.Timeline.view = (timelineHash: number | string) => ({ duration: 400, handler: () => { timelineReports++; }, hash: timelineHash, percent: 25, time: 100 });
      lampa.Player.playlist = (items: LampaPlayerItem[]) => { handed = items; };
      lampa.Player.callback = () => {};
      lampa.Player.play = (current: LampaPlayerItem) => {
        plays++;
        played = current;
        player.emit('create', { data: current });
        if (isExternal) player.emit('external', current);
      };
      mock.method(TorstApi, 'getStreamUrl', async () => 'http://torst.test/api/v1/torrents/trr_old/files/fil_one/content');
      let created = 0;
      mock.method(TorstApi, 'createFileViewing', async () => ++created === 1 ? oldViewing : freshViewing);
      assert.equal(await playTorrentFile(instance, hash, 0, item, [item], { title: 'Sintel' }), true);
      assert.equal(played, handed[0]);
      assert.equal(new URL(played.url as string).searchParams.get('viewing_id'), 'vwg_old');
      if (isExternal) {
        await returnFromPlayer();
        assert.ok(menu);
        menu.onSelect(menu.items[0]);
      } else played.error!(played, url => resumed.push(url));
      await settle();
      assert.equal(new URL(played.url as string).searchParams.get('viewing_id'), 'vwg_new');
      assert.equal((TorstApi.captureTorrentRecovery as any).mock.callCount(), 1);
      assert.equal((TorstApi.recoverTorrent as any).mock.calls[0].arguments[2].metainfo, source.metainfo);
      assert.equal(plays, isExternal ? 2 : 1);
      assert.equal(played, handed[0]);
      (played.timeline as any).handler(50, 200, 400);
      assert.equal(timelineReports, 1);
    });
  }

  it('shares concurrent errors without reconnecting twice', async () => {
    arm(); recover(); recover();
    await settle();
    assert.equal((TorstApi.recoverTorrent as any).mock.callCount(), 1);
    assert.equal(resumed.length, 1);
  });

  it('clears the old viewing when recovery falls back to an untracked stream', async () => {
    mock.method(TorstApi, 'createFileViewing', async () => { throw new TorstApiError('Unavailable', 503); });
    arm(); recover();
    await settle();
    assert.equal(resumed.length, 1);
    assert.equal(new URL(resumed[0]).searchParams.has('viewing_id'), false);
    assert.equal(ExternalProgress.getViewing(item), undefined);
  });

  it('keeps the next episode polling schedule when an earlier check finishes late', async () => {
    let finishCheck!: (viewing: FileViewing) => void;
    const checks = mock.method(TorstApi, 'getFileViewing', () => new Promise<FileViewing>(resolve => { finishCheck = resolve; }));
    arm();
    mock.timers.tick(5000);
    mock.timers.tick(1000);
    ExternalProgress.bind(next, freshViewing);
    player.emit('create', { data: next });
    mock.timers.tick(1000);
    finishCheck(oldViewing);
    await settle();
    mock.timers.tick(4000);
    await settle();
    assert.equal(checks.mock.callCount(), 2);
    assert.equal(checks.mock.calls[1].arguments[1], freshViewing);
    finishCheck(freshViewing);
    await settle();
  });

  it('discards a previous external launch return timer when another episode starts', async () => {
    arm(true);
    browser.dispatchEvent(new Event('focus'));
    mock.timers.tick(1000);
    ExternalProgress.bind(next, freshViewing);
    player.emit('create', { data: next });
    player.emit('external', next);
    mock.timers.tick(5000);
    await settle();
    assert.equal(getMenu(), undefined);
    await returnFromPlayer();
    assert.ok(menu);
  });

  it('does not reload a healthy stream for a codec error', async () => {
    hasRestarted = false;
    arm(); recover();
    await settle();
    assert.equal((TorstApi.recoverTorrent as any).mock.callCount(), 0);
    assert.equal(resumed.length, 0);
  });

  it('recovers when a restarting server rejects token renewal as unavailable', async () => {
    mock.method(TorstApi, 'getFileViewing', async () => { throw new AuthenticationError('Unavailable', 503); });
    arm(); recover();
    await settle();
    assert.equal(resumed.length, 1);
    assert.equal((TorstApi.checkHealth as any).mock.callCount(), 1);
  });

  it('waits for readiness before restoring or preloading the torrent', async () => {
    let checks = 0;
    mock.method(TorstApi, 'checkHealth', async () => ({ isOk: ++checks > 1, latencyMs: 1 }));
    arm(); recover();
    await settle();
    assert.equal((TorstApi.recoverTorrent as any).mock.callCount(), 0);
    assert.equal(isLoading, true);
    mock.timers.tick(1000);
    await settle();
    assert.equal(resumed.length, 1);
  });

  it('allows Back to cancel readiness waiting immediately', async () => {
    mock.method(TorstApi, 'checkHealth', async () => ({ isOk: false, latencyMs: 1 }));
    arm(); recover();
    await settle();
    cancelLoading();
    mock.timers.tick(5000);
    await settle();
    assert.equal(closes, 1);
    assert.equal(isLoading, false);
    assert.equal(resumed.length, 0);
    assert.equal((TorstApi.recoverTorrent as any).mock.callCount(), 0);
  });

  it('reports a bounded readiness timeout without posting a torrent', async () => {
    mock.method(TorstApi, 'checkHealth', async () => ({ isOk: false, latencyMs: 1 }));
    arm(); recover();
    await settle();
    mock.timers.setTime(123000);
    mock.timers.tick(1000);
    await settle();
    assert.equal(resumed.length, 0);
    assert.equal(notices.length, 1);
    assert.ok(notices[0].includes(getTestTranslation('torst_recovery_unavailable')));
  });

  for (const change of ['profile', 'url', 'activity', 'removed', 'playback']) {
    it(`discards recovery after a ${change} change while a request is pending`, async () => {
      let finish!: (value: Torrent) => void;
      mock.method(TorstApi, 'recoverTorrent', () => new Promise<Torrent>(resolve => { finish = resolve; }));
      arm(); recover();
      await settle();
      if (change === 'profile') instance.profileId = 'prf_other';
      if (change === 'url') instance.url = 'http://other.test';
      if (change === 'activity') activity = {};
      if (change === 'removed') instances = [];
      if (change === 'playback') player.emit('create', { data: next });
      finish(torrent);
      await settle();
      assert.equal(resumed.length, 0);
      assert.equal((TorstApi.getRecoveredStreamUrl as any).mock.callCount(), 0);
      assert.deepEqual(notices, []);
    });
  }

  it('does not guess a replacement file from its path or list position', async () => {
    mock.method(TorstApi, 'recoverTorrent', async () => ({ ...torrent, files: [torrent.files[0]] }));
    arm(); recover();
    await settle();
    assert.equal(resumed.length, 0);
    assert.equal((TorstApi.getRecoveredStreamUrl as any).mock.callCount(), 0);
    assert.equal(notices.length, 1);
  });

  it('stops after a credential failure rather than replaying a create request', async () => {
    mock.method(TorstApi, 'recoverTorrent', async () => { throw new AuthenticationError('Invalid credentials', 401); });
    arm(); recover();
    await settle();
    assert.equal(resumed.length, 0);
    assert.equal((TorstApi.recoverTorrent as any).mock.callCount(), 1);
    assert.equal(notices.length, 1);
  });

  it('does not reconnect after a canceled recovery preload', async () => {
    mock.method(PreloadModal, 'waitUntilReady', async () => false);
    arm(); recover();
    await settle();
    assert.equal(resumed.length, 0);
    assert.equal((TorstApi.createFileViewing as any).mock.callCount(), 0);
    assert.equal(closes, 1);
  });

  it('aborts a superseded recovery preload without closing the replacement player', async () => {
    let signal!: AbortSignal;
    mock.method(PreloadModal, 'waitUntilReady', async (_instance: TorstInstance, _hash: string, _identifier: unknown, _media: unknown, _fraction: unknown, abortSignal?: AbortSignal) => {
      signal = abortSignal!;
      return new Promise<boolean>(resolve => signal.addEventListener('abort', () => resolve(false), { once: true }));
    });
    arm(); recover();
    await settle();
    PlaybackRecovery.cancel();
    await settle();
    assert.equal(signal.aborted, true);
    assert.equal(closes, 0);
    assert.equal(resumed.length, 0);
    assert.deepEqual(notices, []);
  });

  it('observes external progress but never relaunches an external app while hidden', async () => {
    arm(true);
    page.visibilityState = 'hidden';
    mock.timers.tick(5000);
    await settle();
    assert.equal(relaunched.length, 0);
    assert.equal(getMenu(), undefined);
    page.visibilityState = 'visible';
    await returnFromPlayer();
    assert.equal(menu.title, getTestTranslation('torst_recovery_external'));
    menu.onSelect(menu.items.find((entry: any) => entry.action === 'resume'));
    await settle();
    assert.deepEqual(relaunched, [item]);
    assert.equal(new URL(item.url as string).searchParams.get('viewing_id'), 'vwg_new');
    assert.equal(seeks.length, 0);
  });

  it('offers external recovery after a suspended TV runtime resumes without focus events', async () => {
    arm(true);
    mock.timers.setTime(31000);
    mock.timers.tick(1000);
    mock.timers.tick(2500);
    await settle();
    assert.ok(menu);
    assert.equal(menu.title, getTestTranslation('torst_recovery_external'));
    assert.equal(relaunched.length, 0);
  });

  it('keeps the viewing ID needed for recovery when external progress already discarded its missing resource', async () => {
    arm(true);
    await returnFromPlayer();
    assert.ok(menu);
    assert.equal((TorstApi.getFileViewing as any).mock.calls[0].arguments[1].id, 'vwg_old');
  });

  it('resumes an external app from its last server estimate without estimating elapsed time', async () => {
    hasRestarted = false;
    arm(true);
    mock.timers.tick(5000);
    await settle();
    hasRestarted = true;
    await returnFromPlayer();
    menu.onSelect(menu.items[0]);
    await settle();
    assert.equal((PreloadModal.waitUntilReady as any).mock.calls[0].arguments[4], 0.5);
    assert.equal((item.timeline as any).time, 200);
  });

  it('preserves the last observed position when the server later reports an unknown position', async () => {
    hasRestarted = false;
    arm(true);
    mock.timers.tick(5000);
    await settle();
    mock.method(TorstApi, 'getFileViewing', async () => {
      if (hasRestarted) throw new TorstApiError('Viewing expired', 404);
      return { ...oldViewing, position_seconds: null };
    });
    mock.timers.tick(5000);
    await settle();
    hasRestarted = true;
    await returnFromPlayer();
    menu.onSelect(menu.items[0]);
    await settle();
    assert.equal((PreloadModal.waitUntilReady as any).mock.calls[0].arguments[4], 0.5);
    assert.equal((item.timeline as any).time, 200);
  });

  it('keeps overlays focused and discards stale resume menu actions', async () => {
    arm(true);
    controller = 'settings_component';
    await returnFromPlayer();
    assert.equal(getMenu(), undefined);
    controller = 'content';
    mock.timers.tick(5000);
    await settle();
    assert.ok(menu);
    activity = {};
    menu.onSelect(menu.items[0]);
    await settle();
    assert.equal((TorstApi.recoverTorrent as any).mock.callCount(), 0);
  });

  it('lets the viewer dismiss external recovery and restores the original controller', async () => {
    arm(true);
    await returnFromPlayer();
    controller = 'select';
    menu.onBack();
    assert.equal(controller, 'content');
    mock.timers.tick(10000);
    await settle();
    assert.equal((TorstApi.recoverTorrent as any).mock.callCount(), 0);
  });

  it('cancels recovery when external playback ended normally', async () => {
    hasRestarted = false;
    mock.method(TorstApi, 'getFileViewing', async () => ({ ...oldViewing, streaming: false }));
    arm(true);
    await returnFromPlayer();
    mock.timers.tick(10000);
    await settle();
    assert.equal(getMenu(), undefined);
    assert.equal((TorstApi.recoverTorrent as any).mock.callCount(), 0);
  });
});
