// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import { TorstApi } from '../api/torst';
import { InstanceManager } from '../instances/instance-manager';
import { translate } from '../lang/translations';
import { FileProgress, ProgressUpdate, TitleProgress, Torrent, TorstInstance } from '../types/torst';
import { resolveFileInfo, selectVideoFiles } from './file-parser';
import { resolveTitleProgressKey, resolveTitleProgressLookup } from './title-progress';

interface ProgressBinding {
  fileId: string,
  hasEstimatedCompletion: boolean,
  instance: TorstInstance,
  instanceUrl: string,
  isViewed: boolean,
  pending?: { isEstimate: boolean, progress: ProgressUpdate },
  profileId: string,
  revision: number,
  saving?: Promise<void>,
  titleKey?: string,
  torrentHash: string
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

  private static applyTimeline(hash: number | string, saved?: FileProgress | TitleProgress): void {
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

  private static async loadTitleProgress(instance: TorstInstance, profileId: string, movie: LampaMovie, isCurrent: () => boolean): Promise<TitleProgress[]> {
    const keyOrPrefix = resolveTitleProgressLookup(movie);
    if (!keyOrPrefix) return [];
    try {
      return await TorstApi.getTitleProgress(instance, profileId, keyOrPrefix);
    } catch {
      if (isCurrent()) Lampa.Noty?.show(translate('torst_progress_load_error', 'Could not load progress from Torst'));
      return [];
    }
  }

  private static resolveProgress(progress: FileProgress[], titles: TitleProgress[], fileId: string, titleKey?: string): FileProgress | TitleProgress | undefined {
    const fileProgress = progress.find(saved => saved.file_id === fileId);
    const titleProgress = titles.find(saved => saved.title_key === titleKey);
    return titleProgress && (!fileProgress || Date.parse(titleProgress.updated_at) >= Date.parse(fileProgress.updated_at)) ? titleProgress : fileProgress;
  }

  public static async hydrate(instance: TorstInstance, torrent: Pick<Torrent, 'files' | 'hash'>, movie: LampaMovie = torrent as unknown as LampaMovie): Promise<void> {
    const profileId = instance.profileId;
    if (!profileId) return;
    const instanceUrl = instance.url;
    const generation = this.generation;
    const isCurrent = () => generation === this.generation && instance.profileId === profileId && instance.url === instanceUrl;
    const revisions = new Map([...this.bindings].map(([hash, binding]) => [hash, binding.revision]));
    await this.flush();
    if (!isCurrent()) return;
    const progress = await TorstApi.getTorrentProgress(instance, profileId, torrent.hash);
    if (!isCurrent()) return;
    const titles = await this.loadTitleProgress(instance, profileId, movie, isCurrent);
    if (!isCurrent()) return;
    const files = selectVideoFiles(torrent.files);
    for (const file of files) {
      if (!file.fileId) continue;
      const fileInfo = resolveFileInfo(file, movie, torrent.hash, files);
      const hash = this.timelineHash(instance, file.fileId, fileInfo.hash);
      if (this.bindings.get(String(hash))?.revision !== revisions.get(String(hash))) continue;
      this.applyTimeline(hash, this.resolveProgress(progress, titles, file.fileId, resolveTitleProgressKey(movie, fileInfo)));
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

  private static recordProgress(binding: ProgressBinding, timeSeconds: number, durationSeconds: number, isEstimate = false): void {
    if (!this.isCurrent(binding)) return;
    const duration = Number(durationSeconds);
    const position = Number(timeSeconds);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 1000000 || !Number.isFinite(position) || position < 0) return;
    binding.revision++;
    if (isEstimate) binding.hasEstimatedCompletion ||= position / duration >= 0.9;
    else {
      binding.hasEstimatedCompletion = false;
      binding.isViewed ||= position / duration >= 0.9;
    }
    binding.pending = {
      isEstimate,
      progress: {
        duration_seconds: duration,
        position_seconds: Math.min(position, duration),
        viewed: binding.isViewed || binding.hasEstimatedCompletion,
      },
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
      const { isEstimate, progress } = binding.pending;
      binding.pending = undefined;
      try {
        const saved = await TorstApi.saveFileProgress(binding.instance, binding.profileId, binding.torrentHash, binding.fileId, progress);
        if (!isEstimate) binding.isViewed ||= saved.viewed;
        if (binding.titleKey && this.isCurrent(binding)) {
          const title = await TorstApi.saveTitleProgress(binding.instance, binding.profileId, binding.titleKey, binding.torrentHash, binding.fileId, progress);
          if (!isEstimate) binding.isViewed ||= title.viewed;
        }
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
    const isCurrent = () => generation === this.generation && instance.profileId === profileId && instance.url === instanceUrl;
    for (const item of playlist) {
      if (item.torstFileId) this.applyTimeline(this.timelineHash(instance, item.torstFileId, resolveFileInfo(item, movie, torrentHash, playlist).hash));
    }
    try {
      const progress = await TorstApi.getTorrentProgress(instance, profileId, torrentHash);
      if (!isCurrent()) return;
      const titles = await this.loadTitleProgress(instance, profileId, movie, isCurrent);
      if (!isCurrent()) return;
      for (const item of playlist) {
        if (!item.torstFileId) continue;
        const fileInfo = resolveFileInfo(item, movie, torrentHash, playlist);
        const timelineHash = this.timelineHash(instance, item.torstFileId, fileInfo.hash);
        const titleKey = resolveTitleProgressKey(movie, fileInfo);
        const saved = this.resolveProgress(progress, titles, item.torstFileId, titleKey);
        this.applyTimeline(timelineHash, saved);
        this.bindings.set(String(timelineHash), {
          fileId: item.torstFileId,
          hasEstimatedCompletion: false,
          instance,
          instanceUrl,
          isViewed: saved?.viewed || false,
          profileId,
          revision: 0,
          titleKey,
          torrentHash,
        });
      }
    } catch {
      if (isCurrent()) {
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

  public static saveExternalProgress(hash: number | string, positionSeconds: number, durationSeconds: number): void {
    const binding = this.bindings.get(String(hash));
    if (binding) this.recordProgress(binding, positionSeconds, durationSeconds, true);
  }

  public static resetForTesting(): void {
    this.generation++;
    this.bindings.clear();
    this.hasReportedFailure = false;
  }
}
