// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import { TorstApi } from '../api/torst';
import { InstanceManager } from '../instances/instance-manager';
import { translate } from '../lang/translations';
import { FileProgress, ProgressUpdate, Torrent, TorstInstance } from '../types/torst';
import { resolveFileInfo, selectVideoFiles } from './file-parser';

interface ProgressBinding {
  fileId: string,
  instance: TorstInstance,
  instanceUrl: string,
  pending?: ProgressUpdate,
  profileId: string,
  revision: number,
  saving?: Promise<void>,
  torrentHash: string,
  viewed: boolean
}

interface PlaybackTimeline {
  handler?: (percent: number, time: number, duration: number) => void,
  hash: number | string
}

export class PlaybackProgress {
  private static bindings = new Map<string, ProgressBinding>();
  private static hasReportedFailure = false;
  private static generation = 0;

  public static timelineHash(instance: TorstInstance | undefined, fileId: string | undefined, localHash: number | string): number | string {
    if (!instance?.profileId) return localHash;
    return Lampa.Utils.hash(JSON.stringify(['torst', instance.id, instance.url, instance.profileId, fileId || String(localHash)]));
  }

  private static applyTimeline(hash: number | string, saved?: FileProgress): void {
    const timeline = Lampa.Timeline?.view(hash);
    if (!timeline) return;
    Object.assign(timeline, {
      duration: saved?.duration_seconds || 0,
      hash,
      percent: saved?.viewed ? 100 : (saved?.completion_ratio || 0) * 100,
      time: saved?.position_seconds || 0,
      updated: saved ? Date.parse(saved.updated_at) || 0 : 0,
    });
    Lampa.Timeline.update?.({ ...timeline, received: true });
  }

  public static async hydrate(instance: TorstInstance, torrent: Pick<Torrent, 'files' | 'hash'>, movie: LampaMovie = torrent as unknown as LampaMovie): Promise<void> {
    const profileId = instance.profileId;
    if (!profileId) return;
    const instanceUrl = instance.url;
    const generation = this.generation;
    const revisions = new Map([...this.bindings].map(([hash, binding]) => [hash, binding.revision]));
    await this.flush();
    if (generation !== this.generation || instance.profileId !== profileId || instance.url !== instanceUrl) return;
    const progress = await TorstApi.getTorrentProgress(instance, profileId, torrent.hash);
    if (generation !== this.generation || instance.profileId !== profileId || instance.url !== instanceUrl) return;
    const files = selectVideoFiles(torrent.files);
    for (const file of files) {
      if (!file.fileId) continue;
      const hash = this.timelineHash(instance, file.fileId, resolveFileInfo(file, movie, torrent.hash, files).hash);
      if (this.bindings.get(String(hash))?.revision !== revisions.get(String(hash))) continue;
      this.applyTimeline(hash, progress.find(saved => saved.file_id === file.fileId));
    }
  }

  public static trackTimeline<T extends PlaybackTimeline>(timeline: T): T {
    const hash = String(timeline.hash);
    const binding = this.bindings.get(hash);
    const handler = timeline.handler;
    if (!binding || !handler) return timeline;
    return {
      ...timeline,
      handler: (percent: number, time: number, duration: number) => {
        handler(percent, time, duration);
        if (this.bindings.get(hash) === binding) this.recordProgress(binding, time, duration);
      },
    };
  }

  private static recordProgress(binding: ProgressBinding, timeSeconds: number, durationSeconds: number): void {
    if (!this.isCurrent(binding)) return;
    const duration = Number(durationSeconds);
    const position = Number(timeSeconds);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 1000000 || !Number.isFinite(position) || position < 0) return;
    binding.revision++;
    binding.viewed ||= position / duration >= 0.9;
    binding.pending = {
      duration_seconds: duration,
      position_seconds: Math.min(position, duration),
      viewed: binding.viewed,
    };
    if (!binding.saving) this.startSaving(binding);
  }

  private static startSaving(binding: ProgressBinding): void {
    binding.saving = this.save(binding).finally(() => {
      binding.saving = undefined;
      if (binding.pending && this.isCurrent(binding)) this.startSaving(binding);
    });
  }

  private static isCurrent(binding: ProgressBinding): boolean {
    return InstanceManager.getInstances().some(instance => instance.id === binding.instance.id
      && instance.url === binding.instanceUrl && instance.profileId === binding.profileId);
  }

  private static async save(binding: ProgressBinding): Promise<void> {
    while (binding.pending && this.isCurrent(binding)) {
      const progress = binding.pending;
      binding.pending = undefined;
      try {
        const saved = await TorstApi.saveFileProgress(binding.instance, binding.profileId, binding.torrentHash, binding.fileId, progress);
        binding.viewed ||= saved.viewed;
      } catch {
        if (!this.hasReportedFailure) {
          this.hasReportedFailure = true;
          Lampa.Noty?.show(translate('torst_progress_save_error', 'Could not save progress to Torst'));
        }
      }
    }
  }

  public static async prepare(instance: TorstInstance, torrentHash: string, playlist: LampaPlaylistItem[], movie: LampaMovie): Promise<void> {
    const generation = ++this.generation;
    await this.flush();
    if (generation !== this.generation) return;
    this.bindings.clear();
    this.hasReportedFailure = false;
    const profileId = instance.profileId;
    if (!profileId) return;
    const instanceUrl = instance.url;
    for (const item of playlist) {
      if (item.torstFileId) this.applyTimeline(this.timelineHash(instance, item.torstFileId, resolveFileInfo(item, movie, torrentHash, playlist).hash));
    }
    try {
      const progress = await TorstApi.getTorrentProgress(instance, profileId, torrentHash);
      if (generation !== this.generation || instance.profileId !== profileId || instance.url !== instanceUrl) return;
      for (const item of playlist) {
        if (!item.torstFileId) continue;
        const fileInfo = resolveFileInfo(item, movie, torrentHash, playlist);
        const timelineHash = this.timelineHash(instance, item.torstFileId, fileInfo.hash);
        const saved = progress.find(entry => entry.file_id === item.torstFileId);
        this.applyTimeline(timelineHash, saved);
        this.bindings.set(String(timelineHash), {
          fileId: item.torstFileId,
          instance,
          instanceUrl,
          profileId,
          revision: 0,
          torrentHash,
          viewed: saved?.viewed || false,
        });
      }
    } catch {
      if (generation === this.generation && instance.profileId === profileId && instance.url === instanceUrl) {
        Lampa.Noty?.show(translate('torst_progress_load_error', 'Could not load progress from Torst'));
      }
    }
  }

  public static async flush(): Promise<void> {
    let pending = [...this.bindings.values()].map(binding => binding.saving).filter((saving): saving is Promise<void> => saving !== undefined);
    while (pending.length) {
      await Promise.all(pending);
      pending = [...this.bindings.values()].map(binding => binding.saving).filter((saving): saving is Promise<void> => saving !== undefined);
    }
  }

  public static resetForTesting(): void {
    this.generation++;
    this.bindings.clear();
    this.hasReportedFailure = false;
  }
}
