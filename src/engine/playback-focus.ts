// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import { ExternalProgress } from './external-progress';

interface PlaybackFocusSession {
  activity: unknown,
  hasLeftPage: boolean,
  isExternal: boolean,
  playlist: LampaPlayerItem[],
  restoreFocus: () => void
}

export class PlaybackFocus {
  private static session: PlaybackFocusSession | null = null;
  private static cleanupListeners: Array<() => void> = [];
  private static isInitialized = false;
  private static returnTimer: ReturnType<typeof setTimeout> | null = null;

  public static arm(playlist: LampaPlayerItem[], restoreFocus: () => void): void {
    this.init();
    this.clear();
    this.session = {
      activity: Lampa.Activity?.active?.(),
      hasLeftPage: false,
      isExternal: false,
      playlist,
      restoreFocus,
    };
    this.setCallback(restoreFocus);
  }

  public static cancel(): void {
    this.clear();
  }

  public static setCallback(restoreFocus: () => void): void {
    const session = this.session;
    if (session) session.restoreFocus = restoreFocus;
    Lampa.Player.callback(() => {
      if (session && this.session !== session) return;
      ExternalProgress.handleExit();
      this.clear();
      if (!session || session.activity === undefined || Lampa.Activity?.active?.() === session.activity) restoreFocus();
    });
  }

  private static init(): void {
    const listener = Lampa.Player?.listener;
    if (this.isInitialized || !listener) return;
    this.isInitialized = true;
    const handlePlayerCreate = (event: { data?: LampaPlayerItem }) => {
      if (this.session && !this.session.playlist.includes(event.data as LampaPlayerItem)) this.clear();
    };
    const handleExternalLaunch = (item: LampaPlayerItem) => {
      if (this.session?.playlist.includes(item)) this.session.isExternal = true;
    };
    listener.follow('create', handlePlayerCreate);
    listener.follow('external', handleExternalLaunch);
    this.cleanupListeners.push(() => {
      listener.remove?.('create', handlePlayerCreate);
      listener.remove?.('external', handleExternalLaunch);
    });
    const handlePageLeave = () => {
      if (this.session) this.session.hasLeftPage = true;
    };
    const handlePageReturn = () => this.handleReturn();
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

  private static handleReturn(): void {
    const session = this.session;
    if (!session?.isExternal || !session.hasLeftPage || this.returnTimer !== null) return;
    this.returnTimer = setTimeout(() => {
      this.returnTimer = null;
      if (this.session !== session || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
      const isSameActivity = session.activity === undefined || Lampa.Activity?.active?.() === session.activity;
      this.clear();
      if (isSameActivity) session.restoreFocus();
    }, 0);
  }

  private static clear(): void {
    if (this.returnTimer !== null) clearTimeout(this.returnTimer);
    this.returnTimer = null;
    this.session = null;
  }

  public static resetForTesting(): void {
    this.clear();
    this.cleanupListeners.forEach(cleanup => cleanup());
    this.cleanupListeners = [];
    this.isInitialized = false;
  }
}
