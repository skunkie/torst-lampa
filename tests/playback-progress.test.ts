// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { TorstApi } from '../src/api/torst';
import { PlaybackProgress } from '../src/engine/playback-progress';
import { InstanceManager } from '../src/instances/instance-manager';
import { FileProgress, ProgressUpdate, TorstInstance } from '../src/types/torst';

const saved: FileProgress = { completion_ratio: 0.25, duration_seconds: 400, file_id: 'fil_one', position_seconds: 100, updated_at: '2026-10-25T10:00:00Z', viewed: false, viewed_at: null };
const playlist = [{ file_index: 0, path: 'Sintel.mkv', torstFileId: 'fil_one' }];

describe('server playback progress', () => {
  const originalLampa = (globalThis as any).Lampa;
  let instance: TorstInstance;
  let timelines: Map<number | string, any>;
  let listeners: Map<string, (data: any) => void>;
  let notices: string[];
  const report = (road: object, hash: number | string = PlaybackProgress.timelineHash(instance, 'fil_one', 42)) => listeners.get('state:changed')?.({ data: { hash, road }, reason: 'update', target: 'timeline' });

  beforeEach(() => {
    instance = { authType: 'none', id: 'one', name: 'One', profileId: 'prf_one', url: 'http://torst.test' };
    timelines = new Map([[42, { duration: 300, hash: 42, percent: 50, time: 150 }]]);
    listeners = new Map();
    notices = [];
    (globalThis as any).Lampa = {
      Listener: {
        follow: (event: string, listener: (data: any) => void) => listeners.set(event, listener),
        remove: (event: string) => listeners.delete(event),
      },
      Noty: { show: (text: string) => notices.push(text) },
      Timeline: {
        update: (value: any) => {
          timelines.set(value.hash, { ...value });
          report(value, value.hash);
        },
        view: (hash: number | string) => {
          if (!timelines.has(hash)) timelines.set(hash, { duration: 0, hash, percent: 0, time: 0 });
          return timelines.get(hash);
        },
      },
      Torserver: { parse: () => ({ hash: 42 }) },
      Utils: { hash: (text: string) => `scoped:${text}` },
    };
    mock.method(InstanceManager, 'getInstances', () => [instance]);
    mock.method(TorstApi, 'getTorrentProgress', async () => [saved]);
    mock.method(TorstApi, 'saveFileProgress', async (_instance: TorstInstance, _profile: string, _hash: string, _file: string, value: ProgressUpdate) => ({ ...saved, ...value }));
  });
  afterEach(() => {
    PlaybackProgress.resetForTesting();
    mock.restoreAll();
    (globalThis as any).Lampa = originalLampa;
  });

  it('loads server seconds into a separate cache and preserves the existing local resume point', async () => {
    await PlaybackProgress.prepare(instance, 'torrent', playlist, {});
    const key = PlaybackProgress.timelineHash(instance, 'fil_one', 42);
    assert.equal(timelines.get(key).time, 100);
    assert.equal(timelines.get(key).percent, 25);
    assert.equal(timelines.get(key).updated, Date.parse(saved.updated_at));
    assert.equal(timelines.get(42).time, 150);
    assert.equal((TorstApi.saveFileProgress as any).mock.callCount(), 0, 'hydrating progress must not upload it again');
    delete instance.profileId;
    assert.equal(PlaybackProgress.timelineHash(instance, 'fil_one', 42), 42);
  });

  it('saves only reported positions and marks completion at ninety percent', async () => {
    await PlaybackProgress.prepare(instance, 'torrent', playlist, {});
    assert.equal((TorstApi.saveFileProgress as any).mock.callCount(), 0);
    report({ duration: 400, time: 360 });
    await PlaybackProgress.flush();
    const call = (TorstApi.saveFileProgress as any).mock.calls[0];
    assert.deepEqual(call.arguments.slice(1), ['prf_one', 'torrent', 'fil_one', { duration_seconds: 400, position_seconds: 360, viewed: true }]);
    report({ duration: 400, time: 20 });
    await PlaybackProgress.flush();
    assert.equal((TorstApi.saveFileProgress as any).mock.calls[1].arguments[4].viewed, true);
  });

  it('isolates profiles and clears a missing server resume point only in that profile cache', async () => {
    await PlaybackProgress.prepare(instance, 'torrent', playlist, {});
    const firstKey = PlaybackProgress.timelineHash(instance, 'fil_one', 42);
    instance.profileId = 'prf_two';
    mock.method(TorstApi, 'getTorrentProgress', async () => []);
    await PlaybackProgress.prepare(instance, 'torrent', playlist, {});
    const secondKey = PlaybackProgress.timelineHash(instance, 'fil_one', 42);
    assert.notEqual(firstKey, secondKey);
    assert.equal(timelines.get(firstKey).time, 100);
    assert.equal(timelines.get(secondKey).time, 0);
    assert.equal(timelines.get(42).time, 150);
    report({ duration: 400, time: 50 }, firstKey);
    await PlaybackProgress.flush();
    assert.equal((TorstApi.saveFileProgress as any).mock.callCount(), 0);
  });

  it('ignores invalid reports, unrelated timelines, and an instance that changed profile', async () => {
    await PlaybackProgress.prepare(instance, 'torrent', playlist, {});
    for (const road of [{ duration: 0, time: 1 }, { duration: NaN, time: 1 }, { duration: 1000001, time: 1 }, { duration: 100, time: -1 }, { duration: 100, time: Infinity }]) report(road);
    report({ duration: 100, time: 10 }, 'unrelated');
    instance.profileId = 'prf_other';
    report({ duration: 100, time: 10 });
    await PlaybackProgress.flush();
    assert.equal((TorstApi.saveFileProgress as any).mock.callCount(), 0);
  });

  it('serializes writes and coalesces reports received while a write is in flight', async () => {
    await PlaybackProgress.prepare(instance, 'torrent', playlist, {});
    let finish: (value: FileProgress) => void = () => {};
    let count = 0;
    const write = mock.method(TorstApi, 'saveFileProgress', async (_instance: TorstInstance, _profile: string, _hash: string, _file: string, value: ProgressUpdate) => {
      if (++count === 1) return new Promise<FileProgress>(resolve => { finish = resolve; });
      return { ...saved, ...value };
    });
    report({ duration: 400, time: 110 });
    report({ duration: 400, time: 120 });
    report({ duration: 400, time: 130 });
    assert.equal(count, 1);
    finish(saved);
    await PlaybackProgress.flush();
    assert.equal(count, 2);
    assert.equal(write.mock.calls[1].arguments[4].position_seconds, 130);
  });

  it('does not apply an old response after the selected profile changes', async () => {
    let finish: (value: FileProgress[]) => void = () => {};
    mock.method(TorstApi, 'getTorrentProgress', () => new Promise<FileProgress[]>(resolve => { finish = resolve; }));
    const preparing = PlaybackProgress.prepare(instance, 'torrent', playlist, {});
    await new Promise(resolve => setImmediate(resolve));
    const oldKey = PlaybackProgress.timelineHash(instance, 'fil_one', 42);
    instance.profileId = 'prf_two';
    finish([saved]);
    await preparing;
    assert.equal(timelines.get(oldKey).time, 0);
    assert.equal(timelines.get(42).time, 150);
  });

  it('hydrates card progress without replacing the playback write bindings', async () => {
    await PlaybackProgress.prepare(instance, 'torrent', playlist, {});
    await PlaybackProgress.hydrate(instance, { files: [{ fileId: 'fil_one', length: 1, name: 'Sintel.mkv', path: 'Sintel.mkv' }], hash: 'torrent' });
    report({ duration: 400, time: 110 });
    await PlaybackProgress.flush();
    assert.equal((TorstApi.saveFileProgress as any).mock.callCount(), 1);
  });

  it('keeps playback usable on progress errors and reports a write failure once', async () => {
    await PlaybackProgress.prepare(instance, 'torrent', playlist, {});
    mock.method(TorstApi, 'saveFileProgress', async () => { throw new Error('offline'); });
    report({ duration: 400, time: 110 });
    await PlaybackProgress.flush();
    report({ duration: 400, time: 120 });
    await PlaybackProgress.flush();
    assert.equal(notices.length, 1);
    mock.method(TorstApi, 'getTorrentProgress', async () => { throw new Error('offline'); });
    await PlaybackProgress.prepare(instance, 'torrent', playlist, {});
    report({ duration: 400, time: 130 });
    await PlaybackProgress.flush();
    assert.equal(notices.length, 2);
    assert.equal(timelines.get(42).time, 150);
  });
});
