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
  externalItems: Set<LampaPlayerItem>,
  hasLeftPage: boolean,
  instance: TorstInstance,
  item?: LampaPlayerItem,
  launchRevision: number,
  measurementRevision?: number,
  onCompleted?: () => void,
  onReturn?: () => void,
  playlist: LampaPlayerItem[],
  reportedPositions: Map<LampaPlayerItem, ReportedPosition>
}

interface PlaybackTimeline {
  handler?: (percent: number, time: number, duration: number) => void,
  hash: number | string
}

interface ReportedPosition {
  durationSeconds: number,
  positionSeconds: number
}

interface TimelineUpdateEvent {
  data?: {
    hash?: number | string,
    road?: {
      duration?: unknown,
      percent?: unknown,
      time?: unknown
    }
  }
}

export class ExternalProgress {
  private static session: ExternalSession | null = null;
  private static reportingSession: ExternalSession | null = null;
  private static viewings = new WeakMap<LampaPlayerItem, FileViewing>();
  private static timelineHandlers = new WeakMap<LampaPlayerItem, NonNullable<PlaybackTimeline['handler']>>();
  private static cleanupListeners: Array<() => void> = [];
  private static isInitialized = false;
  private static isUpdatingTimeline = false;
  private static returnTimer: ReturnType<typeof setTimeout> | null = null;
  private static tickTimer: ReturnType<typeof setInterval> | null = null;
  private static lastTickAtMs = 0;

  public static async getStream(instance: TorstInstance, hash: string, identifier: { fileId?: string, index?: number, path?: string }, recoveredUrl?: string): Promise<{ url: string, viewing?: FileViewing }> {
    const original = { ...instance };
    const isUnchanged = () => instance.url === original.url && instance.authType === original.authType && instance.password === original.password;
    const url = recoveredUrl || await TorstApi.getStreamUrl(instance, hash, identifier);
    if (!isUnchanged()) throw new Error('Instance settings changed during playback');
    if (!identifier.fileId || !Lampa.Player?.listener) return { url };
    let viewing: FileViewing;
    try {
      viewing = await TorstApi.createFileViewing(instance, hash, identifier);
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
    else this.viewings.delete(item);
  }

  public static getViewing(item: LampaPlayerItem): FileViewing | undefined {
    return this.viewings.get(item);
  }

  public static getReportedPosition(item: LampaPlayerItem): ReportedPosition | undefined {
    const session = this.session || this.reportingSession;
    return session && this.hasCurrentContext(session) ? session.reportedPositions.get(item) : undefined;
  }

  public static isTracked(item: LampaPlayerItem): boolean {
    return Boolean(this.session && this.isCurrent(this.session) && this.session.playlist.includes(item));
  }

  public static cancel(): void {
    this.clear();
  }

  public static arm(instance: TorstInstance, playlist: LampaPlayerItem[], onCompleted?: () => void, onReturn?: () => void): void {
    this.init();
    this.clear();
    const session: ExternalSession = {
      activity: Lampa.Activity?.active?.(),
      externalItems: new Set(),
      hasLeftPage: false,
      instance: { ...instance },
      launchRevision: 0,
      onCompleted,
      onReturn,
      playlist,
      reportedPositions: new Map(),
    };
    this.session = session;
    for (const item of playlist) {
      const timeline = item.timeline as PlaybackTimeline | undefined;
      const handler = this.timelineHandlers.get(item) || timeline?.handler;
      if (handler) this.timelineHandlers.set(item, handler);
      if (timeline && handler) item.timeline = {
        ...timeline,
        handler: (percent: number, time: number, duration: number) => {
          if ((this.session !== session && this.reportingSession !== session) || !this.hasCurrentContext(session)) return;
          const positionSeconds = Number(time);
          const durationSeconds = Number(duration);
          if (Number.isFinite(positionSeconds) && positionSeconds >= 0 && Number.isFinite(durationSeconds)
            && durationSeconds > 0 && durationSeconds <= 1000000) {
            session.reportedPositions.set(item, { durationSeconds, positionSeconds: Math.min(positionSeconds, durationSeconds) });
          }
          this.isUpdatingTimeline = true;
          try {
            handler(percent, time, duration);
          } finally {
            this.isUpdatingTimeline = false;
          }
          if (this.session === session && session.externalItems.has(item)) this.scheduleMeasurement();
        },
      };
    }
  }

  private static isCurrent(session: ExternalSession): boolean {
    return this.session === session && this.hasCurrentContext(session);
  }

  private static hasCurrentContext(session: ExternalSession): boolean {
    return (session.activity === undefined || Lampa.Activity?.active?.() === session.activity)
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
      this.reportingSession = session;
      session.item = item;
      session.externalItems.add(item);
      session.reportedPositions.delete(item);
      session.launchRevision++;
      this.lastTickAtMs = Date.now();
      if (this.tickTimer === null) this.tickTimer = setInterval(() => this.handleTick(), TICK_MS);
    };
    const handlePlayerCreate = (event: { data?: LampaPlayerItem }) => {
      this.reportingSession = null;
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
    const timelineListener = Lampa.Timeline?.listener;
    if (timelineListener) {
      // Android can report directly to Timeline.update instead of the item's handler.
      const handleTimelineUpdate = (event: TimelineUpdateEvent) => this.handleTimelineUpdate(event);
      timelineListener.follow('update', handleTimelineUpdate);
      this.cleanupListeners.push(() => timelineListener.remove?.('update', handleTimelineUpdate));
    }
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

  private static handleTimelineUpdate(event: TimelineUpdateEvent): void {
    const session = this.reportingSession;
    if (this.isUpdatingTimeline || PlaybackProgress.isApplyingServerProgress()
      || !session || !this.hasCurrentContext(session) || !event.data) return;
    const { hash: timelineHash, road: reportedProgress } = event.data;
    if (timelineHash === undefined || !reportedProgress) return;
    const item = session.playlist.find(candidate => String((candidate.timeline as PlaybackTimeline | undefined)?.hash) === String(timelineHash));
    if (!item) return;
    const durationSeconds = Number(reportedProgress.duration);
    const reportedTimeSeconds = Number(reportedProgress.time);
    const positionSeconds = Number(reportedProgress.percent) >= 90 && reportedTimeSeconds === 0 ? durationSeconds : reportedTimeSeconds;
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 1000000
      || !Number.isFinite(positionSeconds) || positionSeconds < 0) return;
    session.reportedPositions.set(item, { durationSeconds, positionSeconds: Math.min(positionSeconds, durationSeconds) });
    PlaybackProgress.savePlayerProgress(timelineHash, positionSeconds, durationSeconds);
    this.scheduleMeasurement();
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
    session.onReturn?.();
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
      this.finishMeasurement(session);
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
        this.finishMeasurement(session);
      }
      return;
    }
    if (!this.isCurrent(session) || session.item !== item || session.launchRevision !== launchRevision
      || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
    const timeline = item.timeline as PlaybackTimeline | undefined;
    const position = observed.position_seconds;
    const duration = observed.duration_seconds;
    if (!session.reportedPositions.has(item) && timeline && position !== null && duration !== null
      && Number.isFinite(position) && Number.isFinite(duration) && position > 10 && duration > 0 && duration <= 1000000 && position <= duration) {
      const resumeSeconds = position / duration >= 0.9 ? 0 : position;
      const percent = position / duration >= 0.9 ? 100 : resumeSeconds / duration * 100;
      this.isUpdatingTimeline = true;
      try {
        Lampa.Timeline?.update({ ...timeline, duration, percent, time: resumeSeconds });
      } finally {
        this.isUpdatingTimeline = false;
      }
      if (session.instance.profileId) {
        PlaybackProgress.saveExternalProgress(timeline.hash, position / duration >= 0.9 ? position : resumeSeconds, duration);
        await PlaybackProgress.flush();
      }
    }
    if (this.isCurrent(session) && session.item === item && session.launchRevision === launchRevision && !observed.streaming) {
      this.finishMeasurement(session, true);
      session.onCompleted?.();
    }
  }

  private static finishMeasurement(session: ExternalSession, shouldReleaseViewings = false): void {
    this.clear(shouldReleaseViewings);
    // Native Android reports may arrive after the viewing has already stopped streaming.
    this.reportingSession = session;
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
    this.reportingSession = null;
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
    this.timelineHandlers = new WeakMap();
  }
}
