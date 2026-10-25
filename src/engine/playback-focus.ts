// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

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

  public static setCallback(restoreFocus: () => void): void {
    const session = this.session;
    if (session) session.restoreFocus = restoreFocus;
    Lampa.Player.callback(() => {
      if (session && this.session !== session) return;
      this.clear();
      restoreFocus();
    });
  }

  private static init(): void {
    const listener = Lampa.Player?.listener;
    if (this.isInitialized || !listener) return;
    this.isInitialized = true;
    const create = (event: { data?: LampaPlayerItem }) => {
      if (this.session && !this.session.playlist.includes(event.data as LampaPlayerItem)) this.clear();
    };
    const external = (item: LampaPlayerItem) => {
      if (this.session?.playlist.includes(item)) this.session.isExternal = true;
    };
    listener.follow('create', create);
    listener.follow('external', external);
    this.cleanupListeners.push(() => {
      listener.remove?.('create', create);
      listener.remove?.('external', external);
    });
    const away = () => {
      if (this.session) this.session.hasLeftPage = true;
    };
    const returned = () => this.handleReturn();
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('blur', away);
      window.addEventListener('focus', returned);
      this.cleanupListeners.push(() => {
        window.removeEventListener('blur', away);
        window.removeEventListener('focus', returned);
      });
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      const visibility = () => document.visibilityState === 'hidden' ? away() : returned();
      document.addEventListener('visibilitychange', visibility);
      this.cleanupListeners.push(() => document.removeEventListener('visibilitychange', visibility));
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
