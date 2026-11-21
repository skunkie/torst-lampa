// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

/**
 * Lampa skips its preroll ad for an item that is continuing a playlist, which it recognizes
 * only while that item is in the player's current playlist. Switching episodes inside the
 * player tears the player down first, which empties that playlist, and restores it only after
 * the next episode has passed the ad check. Lampa announces each playback before that check,
 * so the playlist Torst handed over is put back at that point.
 */
let torstPlaylist: LampaPlayerItem[] = [];
let isInitialized = false;

export function rememberPlayerPlaylist(playlist: LampaPlayerItem[]): void {
  torstPlaylist = playlist;
}

export function initPlayerPlaylist(): void {
  if (isInitialized || typeof Lampa === 'undefined' || !Lampa.Player?.listener) return;
  isInitialized = true;

  Lampa.Player.listener.follow('create', (event: { data?: unknown }) => {
    const item = event?.data as LampaPlayerItem | undefined;
    if (!item || !torstPlaylist.includes(item)) return;

    const playerPlaylist = Lampa.PlayerPlaylist;
    if (!playerPlaylist || playerPlaylist.get().length > 0) return;
    playerPlaylist.set(torstPlaylist);
  });
}

export function resetPlayerPlaylistForTesting(): void {
  torstPlaylist = [];
  isInitialized = false;
}
