// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { TorstApi } from '../src/api/torst';
import { PlaybackFocus } from '../src/engine/playback-focus';
import { PlaybackProgress } from '../src/engine/playback-progress';
import { playTorrentFile } from '../src/engine/playback-session';
import { InstanceManager } from '../src/instances/instance-manager';
import { FileProgress, ProgressUpdate, TorstInstance } from '../src/types/torst';
import { PreloadModal } from '../src/ui/preload-modal';

describe('profile playback hand-off', () => {
  const originalLampa = (globalThis as any).Lampa;
  const saved: FileProgress = { completion_ratio: 0.25, duration_seconds: 400, file_id: 'fil_one', position_seconds: 100, updated_at: '2026-10-25T10:00:00Z', viewed: false, viewed_at: null };
  const playlist = [
    { file_index: 0, path: 'Sintel.mkv', title: 'Sintel', torstFileId: 'fil_one' },
    { file_index: 1, path: 'Spring.mkv', title: 'Spring', torstFileId: 'fil_two' },
  ];
  let activity: object;
  let instance: TorstInstance;
  let listeners: Map<string, (event: any) => void>;
  let timelines: Map<number | string, any>;
  let played: any;
  let handedPlaylist: any[];
  let notices: string[];

  beforeEach(() => {
    activity = {};
    instance = { authType: 'none', id: 'one', name: 'One', profileId: 'prf_one', url: 'http://torst.test' };
    listeners = new Map();
    timelines = new Map([['local:Sintel.mkv', { duration: 300, percent: 50, time: 150 }]]);
    played = undefined;
    handedPlaylist = [];
    notices = [];
    const update = (value: any) => {
      timelines.set(value.hash, value);
      listeners.get('state:changed')?.({ data: { hash: value.hash, road: value }, reason: 'update', target: 'timeline' });
    };
    (globalThis as any).Lampa = {
      Activity: { active: () => activity },
      Listener: {
        follow: (event: string, callback: (value: any) => void) => listeners.set(event, callback),
        remove: (event: string) => listeners.delete(event),
      },
      Noty: { show: (message: string) => notices.push(message) },
      Player: {
        callback: () => {},
        play: (item: any) => { played = item; },
        playlist: (items: any[]) => { handedPlaylist = items; },
      },
      Storage: { field: () => 'continue' },
      Timeline: {
        update,
        view: (hash: number | string) => ({
          ...timelines.get(hash), handler: (percent: number, time: number, duration: number) => update({ duration, hash, percent, time }),
          hash,
        }),
      },
      Torserver: { parse: (params: { path: string }) => ({ hash: `local:${params.path}` }) },
      Utils: { hash: (value: string) => value },
    };
    mock.method(InstanceManager, 'getInstances', () => [instance]);
    mock.method(TorstApi, 'getTorrentProgress', async () => [saved]);
    mock.method(TorstApi, 'saveFileProgress', async (_instance: TorstInstance, _profile: string, _hash: string, _file: string, value: ProgressUpdate) => ({ ...saved, ...value }));
    mock.method(TorstApi, 'getStreamUrl', async () => 'http://torst.test/content');
    mock.method(PreloadModal, 'waitUntilReady', async () => true);
  });
  afterEach(() => {
    PlaybackProgress.resetForTesting();
    PlaybackFocus.resetForTesting();
    mock.restoreAll();
    (globalThis as any).Lampa = originalLampa;
  });

  const start = () => playTorrentFile(instance, 'torrent', 0, playlist[0], playlist);
  const flush = () => new Promise(resolve => setImmediate(resolve));

  it('hands over server resume points and saves reported seconds without changing local records', async () => {
    assert.equal(await start(), true);
    assert.equal(played, handedPlaylist[0]);
    assert.equal(played.timeline.time, 100);
    assert.equal(handedPlaylist[1].timeline.time, 0);
    assert.ok(handedPlaylist.every(item => String(item.timeline.hash).includes('prf_one')));
    assert.equal(timelines.get('local:Sintel.mkv').time, 150);
    assert.equal((TorstApi.saveFileProgress as any).mock.callCount(), 0);
    played.timeline.handler(50, 200, 400);
    await PlaybackProgress.flush();
    assert.deepEqual((TorstApi.saveFileProgress as any).mock.calls[0].arguments.slice(1), ['prf_one', 'torrent', 'fil_one', { duration_seconds: 400, position_seconds: 200, viewed: false }]);
  });

  it('does not launch after a profile switch while server progress loads', async () => {
    let finish!: (value: FileProgress[]) => void;
    mock.method(TorstApi, 'getTorrentProgress', () => new Promise<FileProgress[]>(resolve => { finish = resolve; }));
    const starting = start();
    await flush();
    instance.profileId = 'prf_two';
    finish([saved]);
    assert.equal(await starting, false);
    assert.equal(played, undefined);
    assert.equal((PreloadModal.waitUntilReady as any).mock.callCount(), 0);
  });

  it('does not launch after profile, URL, or activity changes while preloading', async () => {
    for (const change of [() => { instance.profileId = 'prf_two'; }, () => { instance.url = 'http://other.test'; }, () => { activity = {}; }]) {
      let finish!: (value: boolean) => void;
      mock.method(PreloadModal, 'waitUntilReady', () => new Promise<boolean>(resolve => { finish = resolve; }));
      const starting = start();
      await flush();
      change();
      finish(true);
      assert.equal(await starting, false);
      assert.equal(played, undefined);
    }
    assert.equal((TorstApi.getStreamUrl as any).mock.callCount(), 0);
  });

  it('does not launch after the profile changes while resolving the stream URL', async () => {
    let finish!: (value: string) => void;
    mock.method(TorstApi, 'getStreamUrl', () => new Promise<string>(resolve => { finish = resolve; }));
    const starting = start();
    await flush();
    instance.profileId = 'prf_two';
    finish('http://torst.test/content');
    assert.equal(await starting, false);
    assert.equal(played, undefined);
  });

  it('cancels a superseded launch even on the same profile', async () => {
    let finish!: (value: FileProgress[]) => void;
    let reads = 0;
    mock.method(TorstApi, 'getTorrentProgress', async () => ++reads === 1 ? new Promise<FileProgress[]>(resolve => { finish = resolve; }) : [saved]);
    const first = start();
    await flush();
    assert.equal(await start(), true);
    const currentItem = played;
    finish([saved]);
    assert.equal(await first, false);
    assert.equal(played, currentItem);
  });

  it('does not report a stale progress failure after switching profiles', async () => {
    let fail!: (error: Error) => void;
    mock.method(TorstApi, 'getTorrentProgress', () => new Promise<FileProgress[]>((_resolve, reject) => { fail = reject; }));
    const starting = start();
    await flush();
    instance.profileId = 'prf_two';
    fail(new Error('offline'));
    assert.equal(await starting, false);
    assert.deepEqual(notices, []);
  });
});
