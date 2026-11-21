// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import { AuthenticationError } from '../api/auth';
import { isNetworkError } from '../api/http-client';
import { TorstApi, TorstApiError } from '../api/torst';
import { InstanceManager } from '../instances/instance-manager';
import { translate } from '../lang/translations';
import { FileViewing, TorrentRecoverySource, TorstInstance } from '../types/torst';
import { PreloadModal } from '../ui/preload-modal';
import { ExternalProgress } from './external-progress';
import { resolvePosterUrl } from './media-context';

const CHECK_INTERVAL_MS = 5000;
const READY_TIMEOUT_MS = 120000;
const RETRY_INTERVAL_MS = 1000;
const RETURN_GRACE_MS = 2500;

interface PlaybackPosition {
  durationSeconds: number,
  positionSeconds: number
}

interface RecoveryTimeline {
  continued?: boolean,
  duration?: number,
  percent?: number,
  time?: number
}

interface RecoverySession {
  abortController: AbortController,
  activity: unknown,
  estimatedPositions: WeakMap<LampaPlayerItem, PlaybackPosition>,
  hasReturned: boolean,
  instance: TorstInstance,
  isExternal: boolean,
  isLoading: boolean,
  isPromptOpen: boolean,
  item?: LampaPlayerItem,
  movie?: LampaMovie,
  needsRecovery: boolean,
  onExternalResume: (item: LampaPlayerItem) => void,
  pendingSeek?: PlaybackPosition,
  playlist: LampaPlayerItem[],
  recovery?: Promise<string | undefined>,
  returnController: string,
  revision: number,
  source?: TorrentRecoverySource,
  torrentHash: string,
  viewing?: FileViewing
}

function resolvePosition(time: unknown, duration: unknown): PlaybackPosition | undefined {
  if (time === null || time === undefined || duration === null || duration === undefined) return undefined;
  const positionSeconds = Number(time);
  const durationSeconds = Number(duration);
  return Number.isFinite(positionSeconds) && positionSeconds >= 0 && Number.isFinite(durationSeconds)
    && durationSeconds > 0 && durationSeconds <= 1000000
    ? { durationSeconds, positionSeconds: Math.min(positionSeconds, durationSeconds) } : undefined;
}

export class PlaybackRecovery {
  private static session: RecoverySession | null = null;
  private static cleanupListeners: Array<() => void> = [];
  private static isInitialized = false;
  private static pollTimer: ReturnType<typeof setTimeout> | null = null;
  private static returnTimer: ReturnType<typeof setTimeout> | null = null;

  public static async capture(instance: TorstInstance, torrentHash: string): Promise<TorrentRecoverySource | undefined> {
    if (!Lampa.Player?.listener) return undefined;
    try {
      return await TorstApi.captureTorrentRecovery(instance, torrentHash);
    } catch {
      return undefined;
    }
  }

  public static arm(instance: TorstInstance, torrentHash: string, playlist: LampaPlayerItem[], source: TorrentRecoverySource | undefined,
    movie: LampaMovie, returnController: string, onExternalResume: (item: LampaPlayerItem) => void): void {
    this.cancel();
    if (!Lampa.Player?.listener) return;
    this.init();
    const session: RecoverySession = {
      abortController: new AbortController(),
      activity: Lampa.Activity?.active?.(),
      estimatedPositions: new WeakMap(),
      hasReturned: false,
      instance: { ...instance },
      isExternal: false,
      isLoading: false,
      isPromptOpen: false,
      movie,
      needsRecovery: false,
      onExternalResume,
      playlist,
      returnController,
      revision: 0,
      source,
      torrentHash: source?.torrent.hash || torrentHash,
    };
    this.session = session;
    for (const item of playlist) item.error = (failedItem, onRecovered) => {
      if (!this.isCurrent(session) || session.item !== failedItem || session.isExternal || session.recovery) return;
      const revision = session.revision;
      void this.recover(session).then(url => {
        if (!url || !this.isCurrent(session) || session.revision !== revision) return;
        onRecovered(url);
      });
    };
  }

  private static isCurrent(session: RecoverySession): boolean {
    return this.session === session && !session.abortController.signal.aborted
      && (session.activity === undefined || Lampa.Activity?.active?.() === session.activity)
      && InstanceManager.getInstances().some(instance => instance.id === session.instance.id && instance.url === session.instance.url
        && instance.profileId === session.instance.profileId && instance.password === session.instance.password && instance.authType === session.instance.authType);
  }

  private static init(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;
    const listener = Lampa.Player.listener!;
    const handleCreate = (event: { data?: LampaPlayerItem }) => {
      const session = this.session;
      if (!session) return;
      if (!session.playlist.includes(event.data as LampaPlayerItem)) { this.cancel(); return; }
      session.abortController.abort();
      this.stopLoading(session);
      if (this.returnTimer !== null) clearTimeout(this.returnTimer);
      this.returnTimer = null;
      session.abortController = new AbortController();
      session.recovery = undefined;
      session.revision++;
      session.item = event.data;
      if (event.data) session.estimatedPositions.delete(event.data);
      session.viewing = event.data ? ExternalProgress.getViewing(event.data) : undefined;
      session.pendingSeek = undefined;
      session.isExternal = false;
      session.hasReturned = false;
      session.needsRecovery = false;
      this.scheduleCheck(session);
    };
    const handleExternal = (item: LampaPlayerItem) => {
      if (this.session?.item === item) this.session.isExternal = true;
    };
    listener.follow('create', handleCreate);
    listener.follow('external', handleExternal);
    this.cleanupListeners.push(() => { listener.remove?.('create', handleCreate); listener.remove?.('external', handleExternal); });
    const handleReturn = () => this.handleExternalReturn();
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('focus', handleReturn);
      this.cleanupListeners.push(() => window.removeEventListener('focus', handleReturn));
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', handleReturn);
      this.cleanupListeners.push(() => document.removeEventListener('visibilitychange', handleReturn));
    }
    const videoListener = Lampa.PlayerVideo?.listener;
    if (videoListener) {
      const handleLoaded = () => {
        const session = this.session;
        if (!session || !this.isCurrent(session) || !session.pendingSeek || !session.item) return;
        const position = session.pendingSeek;
        session.pendingSeek = undefined;
        const timeline = session.item.timeline as RecoveryTimeline | undefined;
        if (timeline) Object.assign(timeline, { continued: true, duration: position.durationSeconds, percent: position.positionSeconds / position.durationSeconds * 100, time: position.positionSeconds });
        Lampa.PlayerVideo?.to(position.positionSeconds);
        Lampa.Player.loading?.(false);
      };
      videoListener.follow('loadeddata', handleLoaded);
      this.cleanupListeners.push(() => videoListener.remove?.('loadeddata', handleLoaded));
    }
  }

  private static scheduleCheck(session: RecoverySession): void {
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    const revision = session.revision;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      if (!this.isCurrent(session)) { this.cancel(); return; }
      void this.check(session).then(() => {
        if (!this.isCurrent(session) || session.revision !== revision) return;
        this.offerResume(session);
        this.scheduleCheck(session);
      });
    }, CHECK_INTERVAL_MS);
  }

  private static async check(session: RecoverySession): Promise<void> {
    const item = session.item;
    if (!item || !this.isCurrent(session) || session.needsRecovery) return;
    const revision = session.revision;
    try {
      const viewing = session.viewing;
      if (viewing) {
        const observed = await TorstApi.getFileViewing(session.instance, viewing);
        if (!this.isCurrent(session) || session.revision !== revision) return;
        const position = resolvePosition(observed.position_seconds, observed.duration_seconds);
        if (position) session.estimatedPositions.set(item, position);
      } else await TorstApi.getTorrent(session.instance, session.torrentHash);
    } catch (error) {
      if (!this.isCurrent(session) || session.revision !== revision) return;
      if (isNetworkError(error) || error instanceof TorstApiError && (error.status === 404 || error.status >= 500)
        || error instanceof AuthenticationError && error.status !== undefined && error.status >= 500) session.needsRecovery = true;
    }
  }

  private static offerResume(session: RecoverySession): void {
    if (!this.isCurrent(session) || !session.item || !session.isExternal || !session.hasReturned || !session.needsRecovery
      || session.isPromptOpen || session.recovery || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
    const controller = Lampa.Controller?.enabled?.().name;
    if (controller && controller !== session.returnController) return;
    session.isPromptOpen = true;
    const revision = session.revision;
    Lampa.Select.show({
      items: [{ action: 'resume', title: translate('torst_recovery_resume', 'Resume Playback') }, { action: 'cancel', title: translate('torst_cancel', 'Cancel') }],
      onBack: () => {
        if (!this.isCurrent(session) || session.revision !== revision) return;
        Lampa.Controller?.toggle(session.returnController);
        this.cancel();
      },
      onSelect: (selected: LampaSelectItem) => {
        if (!this.isCurrent(session) || session.revision !== revision) return;
        session.isPromptOpen = false;
        Lampa.Controller?.toggle(session.returnController);
        if (selected.action !== 'resume') { this.cancel(); return; }
        void this.recover(session).then(url => {
          if (url && this.isCurrent(session) && session.revision === revision && session.item) session.onExternalResume(session.item);
        });
      },
      title: translate('torst_recovery_external', 'The stream was interrupted. Resume playback?'),
    });
  }

  private static getPosition(session: RecoverySession, item: LampaPlayerItem): PlaybackPosition | undefined {
    if (!session.isExternal) {
      const video = Lampa.PlayerVideo?.video?.();
      const current = resolvePosition(video?.currentTime, video?.duration);
      if (current) return current;
    }
    const timeline = item.timeline as RecoveryTimeline | undefined;
    return ExternalProgress.getReportedPosition(item) || session.estimatedPositions.get(item) || resolvePosition(timeline?.time, timeline?.duration);
  }

  private static recover(session: RecoverySession): Promise<string | undefined> {
    if (session.recovery) return session.recovery;
    const revision = session.revision;
    const recovery = this.performRecovery(session).catch(error => {
      if (this.isCurrent(session) && session.revision === revision) {
        session.hasReturned = false;
        Lampa.Player.loading?.(false);
        Lampa.Noty?.show(translate('torst_recovery_error', 'Could not recover playback: {msg}', { msg: error instanceof Error ? error.message : String(error) }));
      }
      return undefined;
    }).finally(() => {
      if (session.recovery === recovery) {
        session.recovery = undefined;
        this.stopLoading(session);
      }
    });
    session.recovery = recovery;
    return recovery;
  }

  private static async performRecovery(session: RecoverySession): Promise<string | undefined> {
    const item = session.item;
    if (!item?.torstFileId || !this.isCurrent(session)) return;
    const revision = session.revision;
    const signal = session.abortController.signal;
    const isCurrent = () => this.isCurrent(session) && session.revision === revision && !signal.aborted;
    const position = this.getPosition(session, item);
    await this.check(session);
    if (!isCurrent() || !session.needsRecovery) return;
    const media: LampaMovie = {
      card: session.movie,
      first_title: session.movie?.name || session.movie?.title,
      img: resolvePosterUrl(undefined, session.movie),
      movie: session.movie,
      title: item.title || session.movie?.title || session.movie?.name || 'Torst',
    };
    Lampa.Player.loading?.(true);
    if (Lampa.Loading) {
      session.isLoading = true;
      Lampa.Loading.start(() => { if (isCurrent()) { this.cancel(); Lampa.Player.close?.(); } }, '', { media });
    }
    const deadlineMs = Date.now() + READY_TIMEOUT_MS;
    while (isCurrent()) {
      const health = await TorstApi.checkHealth(session.instance, 2000);
      if (!isCurrent()) return;
      if (health.isOk) break;
      if (Date.now() >= deadlineMs) throw new Error(translate('torst_recovery_unavailable', 'Torst is still unavailable'));
      await this.delay(signal);
    }
    if (!isCurrent()) return;
    const torrent = await TorstApi.recoverTorrent(session.instance, session.torrentHash, session.source, () => !isCurrent());
    if (!isCurrent()) return;
    const index = torrent.files.findIndex(file => file.fileId === item.torstFileId);
    if (index < 0) throw new TorstApiError(translate('torst_recovery_missing_file', 'The played file is no longer available'), 404);
    const url = await TorstApi.getRecoveredStreamUrl(session.instance, torrent, item.torstFileId);
    if (!isCurrent()) return;
    this.stopLoading(session);
    const ready = await PreloadModal.waitUntilReady(session.instance, torrent.hash, { index, path: torrent.files[index].path }, media,
      position ? position.positionSeconds / position.durationSeconds : undefined, signal);
    if (!ready) {
      if (isCurrent()) {
        this.cancel();
        Lampa.Player.close?.();
      }
      return;
    }
    if (!isCurrent()) return;
    const stream = await ExternalProgress.getStream(session.instance, torrent.hash, { fileId: item.torstFileId, index, path: torrent.files[index].path }, url);
    if (!isCurrent()) { ExternalProgress.release(session.instance, stream.viewing); return; }
    session.torrentHash = torrent.hash;
    if (session.source) session.source.torrent = torrent;
    item.file_index = index;
    item.path = torrent.files[index].path;
    item.url = stream.url;
    session.viewing = stream.viewing;
    ExternalProgress.bind(item, stream.viewing);
    if (position) {
      const timeline = item.timeline as RecoveryTimeline | undefined;
      if (timeline) Object.assign(timeline, { duration: position.durationSeconds, percent: position.positionSeconds / position.durationSeconds * 100, time: position.positionSeconds });
      if (!session.isExternal) session.pendingSeek = position;
    }
    session.needsRecovery = false;
    return stream.url;
  }

  private static delay(signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      const handleAbort = () => { clearTimeout(timer); signal.removeEventListener('abort', handleAbort); resolve(); };
      const timer = setTimeout(handleAbort, RETRY_INTERVAL_MS);
      signal.addEventListener('abort', handleAbort, { once: true });
      if (signal.aborted) handleAbort();
    });
  }

  private static stopLoading(session: RecoverySession): void {
    if (!session.isLoading) return;
    session.isLoading = false;
    Lampa.Loading?.stop();
  }

  public static handleExternalReturn(): void {
    const session = this.session;
    if (!session?.isExternal || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
    if (this.returnTimer !== null) clearTimeout(this.returnTimer);
    const revision = session.revision;
    this.returnTimer = setTimeout(() => {
      this.returnTimer = null;
      if (!this.isCurrent(session) || session.revision !== revision) return;
      session.hasReturned = true;
      void this.check(session).then(() => {
        if (session.revision === revision) this.offerResume(session);
      });
    }, RETURN_GRACE_MS);
  }

  public static handleExit(): void {
    if (this.session?.isExternal) this.handleExternalReturn();
    else this.cancel();
  }

  public static cancel(): void {
    const session = this.session;
    this.session = null;
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    if (this.returnTimer !== null) clearTimeout(this.returnTimer);
    this.pollTimer = null;
    this.returnTimer = null;
    if (session) {
      session.source = undefined;
      session.abortController.abort();
      this.stopLoading(session);
    }
  }

  public static resetForTesting(): void {
    this.cancel();
    this.cleanupListeners.forEach(cleanup => cleanup());
    this.cleanupListeners = [];
    this.isInitialized = false;
  }
}
