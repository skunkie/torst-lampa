// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import { TorstApi, TorstApiError } from '../api/torst';
import { InstanceManager } from '../instances/instance-manager';
import { FileViewing, TorstInstance } from '../types/torst';
import { PlaybackProgress } from './playback-progress';

const RETURN_GRACE_MS = 2000;
const SUSPENSION_GAP_MS = 5000;
const TICK_MS = 1000;

interface ExternalSession {
  activity: unknown,
  exactReports: Set<LampaPlayerItem>,
  externalItems: Set<LampaPlayerItem>,
  hasLeftPage: boolean,
  instance: TorstInstance,
  item?: LampaPlayerItem,
  launchRevision: number,
  measurementRevision?: number,
  playlist: LampaPlayerItem[]
}

interface PlaybackTimeline {
  handler?: (percent: number, time: number, duration: number) => void,
  hash: number | string
}

export class ExternalProgress {
  private static session: ExternalSession | null = null;
  private static viewings = new WeakMap<LampaPlayerItem, FileViewing>();
  private static cleanupListeners: Array<() => void> = [];
  private static isInitialized = false;
  private static returnTimer: ReturnType<typeof setTimeout> | null = null;
  private static tickTimer: ReturnType<typeof setInterval> | null = null;
  private static lastTickAtMs = 0;

  public static async getStream(instance: TorstInstance, hash: string, identifier: { fileId?: string, index?: number, path?: string }): Promise<{ url: string, viewing?: FileViewing }> {
    const original = { ...instance };
    const isUnchanged = () => instance.url === original.url && instance.authType === original.authType && instance.password === original.password;
    const url = await TorstApi.getStreamUrl(instance, hash, { index: identifier.index, path: identifier.path });
    if (!isUnchanged()) throw new Error('Instance settings changed during playback');
    if (!identifier.fileId || !Lampa.Player?.listener) return { url };
    let viewing: FileViewing;
    try {
      viewing = await TorstApi.createFileViewing(instance, hash, { index: identifier.index, path: identifier.path });
    } catch {
      if (!isUnchanged()) throw new Error('Instance settings changed during playback');
      return { url };
    }
    if (!isUnchanged()) {
      this.release(original, viewing);
      throw new Error('Instance settings changed during playback');
    }
    if (!viewing || typeof viewing.id !== 'string' || !viewing.id
      || typeof viewing.links?.self !== 'string' || !viewing.links.self.startsWith('/api/v1/')) return { url };
    const contentUrl = new URL(url);
    contentUrl.searchParams.set('viewing_id', viewing.id);
    return { url: contentUrl.toString(), viewing };
  }

  public static release(instance: TorstInstance, viewing?: FileViewing): void {
    if (viewing) void TorstApi.deleteFileViewing(instance, viewing).catch(() => {});
  }

  public static bind(item: LampaPlayerItem, viewing?: FileViewing): void {
    if (viewing) this.viewings.set(item, viewing);
  }

  public static isTracked(item: LampaPlayerItem): boolean {
    return Boolean(this.session && this.isCurrent(this.session) && this.session.playlist.includes(item));
  }

  public static cancel(): void {
    this.clear();
  }

  public static arm(instance: TorstInstance, playlist: LampaPlayerItem[]): void {
    this.init();
    this.clear();
    const session: ExternalSession = {
      activity: Lampa.Activity?.active?.(),
      exactReports: new Set(),
      externalItems: new Set(),
      hasLeftPage: false,
      instance: { ...instance },
      launchRevision: 0,
      playlist,
    };
    this.session = session;
    for (const item of playlist) {
      const timeline = item.timeline as PlaybackTimeline | undefined;
      const handler = timeline?.handler;
      if (timeline && handler) item.timeline = {
        ...timeline,
        handler: (percent: number, time: number, duration: number) => {
          const positionSeconds = Number(time);
          const durationSeconds = Number(duration);
          if (Number.isFinite(positionSeconds) && positionSeconds >= 0 && Number.isFinite(durationSeconds)
            && durationSeconds > 0 && durationSeconds <= 1000000) session.exactReports.add(item);
          handler(percent, time, duration);
        },
      };
    }
  }

  private static isCurrent(session: ExternalSession): boolean {
    return this.session === session
      && (session.activity === undefined || Lampa.Activity?.active?.() === session.activity)
      && InstanceManager.getInstances().some(instance => instance.id === session.instance.id
        && instance.url === session.instance.url && instance.profileId === session.instance.profileId
        && instance.authType === session.instance.authType && instance.password === session.instance.password);
  }

  private static init(): void {
    const listener = Lampa.Player?.listener;
    if (this.isInitialized || !listener) return;
    this.isInitialized = true;
    const handleExternalLaunch = (item: LampaPlayerItem) => {
      const session = this.session;
      if (!session?.playlist.includes(item)) return;
      if (this.returnTimer !== null) clearTimeout(this.returnTimer);
      this.returnTimer = null;
      session.item = item;
      session.externalItems.add(item);
      session.exactReports.delete(item);
      session.launchRevision++;
      this.lastTickAtMs = Date.now();
      if (this.tickTimer === null) this.tickTimer = setInterval(() => this.handleTick(), TICK_MS);
    };
    const handlePlayerCreate = (event: { data?: LampaPlayerItem }) => {
      const session = this.session;
      if (!session) return;
      if (!session.playlist.includes(event.data as LampaPlayerItem)) {
        this.clear();
        return;
      }
      this.stopTimers();
      session.launchRevision++;
      session.item = undefined;
      session.hasLeftPage = false;
    };
    listener.follow('external', handleExternalLaunch);
    listener.follow('create', handlePlayerCreate);
    this.cleanupListeners.push(() => {
      listener.remove?.('external', handleExternalLaunch);
      listener.remove?.('create', handlePlayerCreate);
    });
    const handlePageLeave = () => { if (this.session) this.session.hasLeftPage = true; };
    const handlePageReturn = () => {
      if (this.session?.hasLeftPage) this.scheduleMeasurement();
    };
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('blur', handlePageLeave);
      window.addEventListener('focus', handlePageReturn);
      this.cleanupListeners.push(() => {
        window.removeEventListener('blur', handlePageLeave);
        window.removeEventListener('focus', handlePageReturn);
      });
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      const handleVisibilityChange = () => document.visibilityState === 'hidden' ? handlePageLeave() : handlePageReturn();
      document.addEventListener('visibilitychange', handleVisibilityChange);
      this.cleanupListeners.push(() => document.removeEventListener('visibilitychange', handleVisibilityChange));
    }
  }

  private static handleTick(): void {
    const session = this.session;
    const nowMs = Date.now();
    if (!session || !this.isCurrent(session)) {
      this.clear();
      return;
    }
    if (nowMs - this.lastTickAtMs > SUSPENSION_GAP_MS) {
      session.hasLeftPage = true;
      this.scheduleMeasurement();
    }
    this.lastTickAtMs = nowMs;
  }

  public static handleExit(): void {
    if (this.session?.item) this.scheduleMeasurement();
    else this.clear();
  }

  private static scheduleMeasurement(): void {
    const session = this.session;
    if (!session?.item || this.returnTimer !== null || session.measurementRevision === session.launchRevision
      || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
    session.hasLeftPage = false;
    // Give platforms that report an exact position on return time to deliver it.
    this.returnTimer = setTimeout(() => {
      this.returnTimer = null;
      const revision = session.launchRevision;
      session.measurementRevision = revision;
      void this.measure(session).catch(() => {}).finally(() => {
        if (session.measurementRevision === revision) session.measurementRevision = undefined;
      });
    }, RETURN_GRACE_MS);
  }

  private static async measure(session: ExternalSession): Promise<void> {
    const item = session.item;
    if (!item || !this.isCurrent(session) || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
    const viewing = this.viewings.get(item);
    if (!viewing) {
      this.clear();
      return;
    }
    const launchRevision = session.launchRevision;
    let observed: FileViewing;
    try {
      observed = await TorstApi.getFileViewing(session.instance, viewing);
    } catch (error) {
      if (error instanceof TorstApiError && error.status === 404 && this.isCurrent(session)
        && session.launchRevision === launchRevision) {
        this.viewings.delete(item);
        this.clear();
      }
      return;
    }
    if (!this.isCurrent(session) || session.item !== item || session.launchRevision !== launchRevision
      || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
    const timeline = item.timeline as PlaybackTimeline | undefined;
    const position = observed.position_seconds;
    const duration = observed.duration_seconds;
    if (!session.exactReports.has(item) && timeline && position !== null && duration !== null
      && Number.isFinite(position) && Number.isFinite(duration) && position > 10 && duration > 0 && duration <= 1000000 && position <= duration) {
      const resumeSeconds = position / duration >= 0.9 ? 0 : position;
      const percent = position / duration >= 0.9 ? 100 : resumeSeconds / duration * 100;
      Lampa.Timeline?.update({ ...timeline, duration, percent, time: resumeSeconds });
      if (session.instance.profileId) {
        PlaybackProgress.saveExternalProgress(timeline.hash, position / duration >= 0.9 ? position : resumeSeconds, duration);
        await PlaybackProgress.flush();
      }
    }
    if (this.isCurrent(session) && session.item === item && session.launchRevision === launchRevision && !observed.streaming) this.clear(true);
  }

  private static stopTimers(): void {
    if (this.returnTimer !== null) clearTimeout(this.returnTimer);
    if (this.tickTimer !== null) clearInterval(this.tickTimer);
    this.returnTimer = null;
    this.tickTimer = null;
  }

  private static clear(shouldReleaseViewings = false): void {
    this.stopTimers();
    const session = this.session;
    this.session = null;
    if (!session) return;
    for (const item of session.playlist) {
      if (session.externalItems.has(item) && (!shouldReleaseViewings || session.item !== item)) continue;
      const viewing = this.viewings.get(item);
      if (viewing) {
        this.viewings.delete(item);
        this.release(session.instance, viewing);
      }
    }
  }

  public static resetForTesting(): void {
    this.clear(true);
    this.cleanupListeners.forEach(cleanup => cleanup());
    this.cleanupListeners = [];
    this.isInitialized = false;
    this.viewings = new WeakMap();
  }
}
