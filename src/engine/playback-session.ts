// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import { TorstApi } from '../api/torst';
import { translate } from '../lang/translations';
import { Torrent, TorrentFile, TorstInstance } from '../types/torst';
import { buildFileListItemElement } from '../ui/file-list-item';
import { PreloadModal } from '../ui/preload-modal';
import { closeModalSafely, markTorrentViewed, recordWatchedHistory } from './engine-utils';
import { collectSeasonNumbers, fetchSeasonEpisodes, resolveEpisodePreview } from './episode-preview';
import { resolveFileIndex, resolveFileInfo, selectVideoFiles } from './file-parser';
import { resolveMovieContext, resolvePosterUrl } from './media-context';
import { PlaybackFocus } from './playback-focus';
import { PlaybackProgress } from './playback-progress';
import { rememberPlayerPlaylist } from './player-playlist';

let playbackGeneration = 0;

export async function playSingleVideoFile(
  instance: TorstInstance,
  torrent: Torrent,
  singleFile: TorrentFile,
  movie?: LampaMovie,
  sourceTorrentItem?: LampaTorrentItem,
  returnController = 'content'
): Promise<void> {
  const resolvedMovie = resolveMovieContext(movie);
  const poster = resolvePosterUrl(torrent, resolvedMovie);
  const mediaMetadata: LampaMovie = resolvedMovie || {
    card: torrent,
    first_title: torrent.title || torrent.name,
    img: poster || torrent.poster,
    movie: torrent,
    title: torrent.title || torrent.name,
  };

  const cleanTitle = Lampa.Utils?.clearHtmlTags
    ? Lampa.Utils.clearHtmlTags(singleFile.name || singleFile.path.split('/').pop() || 'Video')
    : (singleFile.name || singleFile.path.split('/').pop() || 'Video');
  const sizeString = Lampa.Utils?.bytesToSize
    ? Lampa.Utils.bytesToSize(singleFile.length)
    : String(singleFile.length);

  const originalFileIndex = resolveFileIndex(torrent.files || [], singleFile);
  const targetFileIndex = originalFileIndex >= 0 ? originalFileIndex : 0;

  const fileInfo = resolveFileInfo(singleFile, mediaMetadata, torrent.hash);
  const singlePlaylistItem = {
    episode: fileInfo.episode,
    file_index: targetFileIndex,
    fname: singleFile.name || singleFile.path,
    id: 0,
    path: singleFile.path,
    season: fileInfo.season,
    size: sizeString,
    title: cleanTitle,
    torrent_hash: torrent.hash,
    torstFileId: singleFile.fileId,
  };

  await playTorrentFile(
    instance,
    torrent.hash,
    targetFileIndex,
    singlePlaylistItem,
    [singlePlaylistItem],
    mediaMetadata,
    returnController,
    sourceTorrentItem
  );
}

export async function displayFileList(
  instance: TorstInstance,
  torrent: Torrent,
  movie?: LampaMovie,
  sourceTorrentItem?: LampaTorrentItem,
  sourceController?: string
): Promise<void> {
  const activity = Lampa.Activity?.active?.();
  const instanceUrl = instance.url;
  const profileId = instance.profileId;
  const torrentFiles: TorrentFile[] = torrent.files || [];
  const sortedVideoFiles = selectVideoFiles(torrentFiles);

  if (sortedVideoFiles.length === 0) {
    if (Lampa.Noty) {
      Lampa.Noty.show(translate('torst_noty_no_video', 'No video files found in torrent'));
    }
    return;
  }

  const resolvedMovie = resolveMovieContext(movie);
  const poster = resolvePosterUrl(torrent, resolvedMovie);
  const mediaMetadata: LampaMovie = resolvedMovie || {
    card: torrent,
    first_title: torrent.title || torrent.name,
    img: poster || torrent.poster,
    movie: torrent,
    title: torrent.title || torrent.name,
  };

  // If single video file, start directly
  if (sortedVideoFiles.length === 1) {
    await playSingleVideoFile(
      instance,
      torrent,
      sortedVideoFiles[0],
      movie,
      sourceTorrentItem,
      sourceController
    );
    return;
  }

  const fileInfos = sortedVideoFiles.map(file => resolveFileInfo(file, mediaMetadata, torrent.hash, sortedVideoFiles));

  // Build playlist objects for Lampa
  const playlist = sortedVideoFiles.map((file, playlistIndex) => {
    const cleanTitle = Lampa.Utils.clearHtmlTags(
      file.name || file.path.split('/').pop() || `File ${playlistIndex + 1}`
    );
    const originalFileIndex = resolveFileIndex(torrentFiles, file);
    const fileInfo = fileInfos[playlistIndex];
    return {
      episode: fileInfo.episode,
      file_index: originalFileIndex >= 0 ? originalFileIndex : playlistIndex,
      fname: cleanTitle,
      id: playlistIndex,
      path: file.path,
      season: fileInfo.season,
      size: Lampa.Utils.bytesToSize(file.length),
      title: cleanTitle,
      torrent_hash: torrent.hash,
      torstFileId: file.fileId,
    };
  });

  // Matches Lampa's native torrent file list: fetch TMDB episode metadata up
  // front so multi-episode entries can render with a still image, episode
  // name, and air date instead of the plain title-only row.
  const seasonsData = await fetchSeasonEpisodes(mediaMetadata, collectSeasonNumbers(fileInfos));
  if (instance.profileId) await PlaybackProgress.hydrate(instance, torrent, mediaMetadata).catch(() => {
    Lampa.Noty?.show(translate('torst_progress_load_error', 'Could not load progress from Torst'));
  });
  if (instance.url !== instanceUrl || instance.profileId !== profileId
    || (activity !== undefined && Lampa.Activity?.active?.() !== activity)) return;

  const fileListElement = $('<div class="torrent-files"></div>');
  // Callers that opened this list from a menu pass the controller that was active before it
  // opened, since by now the menu's own controller is the enabled one.
  const returnController = sourceController || Lampa.Controller?.enabled?.().name || 'content';

  const openFileListModal = (): void => {
    Lampa.Modal.open({
      html: fileListElement,
      mask: true,
      onBack: () => {
        Lampa.Modal.close();
        Lampa.Controller.toggle(returnController);
      },
      size: 'large',
      title: Lampa.Lang?.translate('title_files') || 'Files',
    });
    // Modal.open updates lazy row visibility after its initial focus attempt.
    Lampa.Controller?.collectionFocus?.(false, fileListElement);
  };

  playlist.forEach((playlistItem, playlistIndex) => {
    const extensionPosition = playlistItem.title.lastIndexOf('.');
    const extension = extensionPosition > 0 ? playlistItem.title.slice(extensionPosition + 1) : '';
    const title = extensionPosition > 0
      ? playlistItem.title.slice(0, extensionPosition)
      : playlistItem.title;
    const fileInfo = fileInfos[playlistIndex];
    const preview = resolveEpisodePreview(fileInfo, seasonsData, poster);
    const timeline = Lampa.Timeline
      ? Lampa.Timeline.view(PlaybackProgress.timelineHash(instance, playlistItem.torstFileId, fileInfo.hash))
      : undefined;

    const fileItemElement = buildFileListItemElement({
      exe: extension,
      fileInfo,
      preview,
      size: playlistItem.size,
      timeline,
      title,
    });

    fileItemElement.on('hover:enter', () => {
      const targetFileIndex = playlistItem.file_index !== undefined
        ? playlistItem.file_index
        : playlistIndex;
      // Keep the file list modal open so the player exit callback can refocus it.
      void playTorrentFile(
        instance,
        torrent.hash,
        targetFileIndex,
        playlistItem,
        playlist,
        mediaMetadata,
        'modal',
        sourceTorrentItem
      ).catch((err: unknown) => {
        console.error('[Torst] Playback failed:', err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (Lampa.Loading) Lampa.Loading.stop();
        Lampa.Controller.toggle('modal');
        if (Lampa.Noty) {
          Lampa.Noty.show(
            translate('torst_noty_error', `Torst: ${errorMessage}`, { msg: errorMessage })
          );
        }
      });
    });

    fileListElement.append(fileItemElement);
  });

  openFileListModal();
}

export async function playTorrentFile(
  instance: TorstInstance,
  torrentHash: string,
  fileIndex: number,
  playlistItem: LampaPlaylistItem,
  playlist: LampaPlaylistItem[],
  movie?: LampaMovie,
  returnController = 'content',
  sourceTorrentItem?: LampaTorrentItem
): Promise<boolean> {
  const generation = ++playbackGeneration;
  const activity = Lampa.Activity?.active?.();
  const instanceUrl = instance.url;
  const profileId = instance.profileId;
  const isCurrent = () => generation === playbackGeneration && instance.url === instanceUrl && instance.profileId === profileId
    && (activity === undefined || Lampa.Activity?.active?.() === activity);
  const resolvedMovie = resolveMovieContext(movie);
  const poster = resolvePosterUrl(undefined, resolvedMovie) || playlistItem.img || '';
  const title =
    resolvedMovie?.title ||
    resolvedMovie?.name ||
    playlistItem.title ||
    playlistItem.fname ||
    'Torrent';
  const historyCard: LampaMovie = resolvedMovie?.id !== undefined
    ? { ...resolvedMovie }
    : { ...resolvedMovie, img: poster, title };

  const fileInfo = resolveFileInfo(playlistItem, historyCard, torrentHash, playlist);
  if (instance.profileId) await PlaybackProgress.prepare(instance, torrentHash, playlist, historyCard);
  if (!isCurrent()) return false;
  const timelineHash = PlaybackProgress.timelineHash(instance, playlistItem.torstFileId, fileInfo.hash);
  const preloadTimeline = Lampa.Timeline ? Lampa.Timeline.view(timelineHash) : undefined;
  const playbackPositionSeconds = resolvePlaybackPositionSeconds(preloadTimeline);
  const percent = Number(preloadTimeline?.percent);
  const durationSeconds = Number(preloadTimeline?.duration);
  const playbackFraction = playbackPositionSeconds === undefined
    ? undefined
    : Number.isFinite(percent) && percent > 0
      ? percent / 100
      : durationSeconds > 0 ? playbackPositionSeconds / durationSeconds : undefined;

  const loadingMedia = {
    card: historyCard,
    first_title: historyCard.name || historyCard.title,
    img: poster,
    movie: historyCard,
    title: playlistItem.title || playlistItem.fname,
  };
  const isPreloadReady = await PreloadModal.waitUntilReady(
    instance,
    torrentHash,
    { index: fileIndex, path: playlistItem.path },
    loadingMedia,
    playbackFraction
  );
  if (!isPreloadReady || !isCurrent()) return false;

  // Resolve final stream URL with playback token attached
  const streamUrl = await TorstApi.getStreamUrl(instance, torrentHash, {
    index: fileIndex,
    path: playlistItem.path,
  });
  if (!isCurrent()) return false;

  const playerTimeline = Lampa.Timeline
    ? PlaybackProgress.trackTimeline(Lampa.Timeline.view(timelineHash))
    : undefined;

  // A 'modal' returnController means the caller deliberately left its file
  // list modal open behind us (matching Lampa's native torrent.js behavior)
  // so it can be refocused via Controller.toggle('modal') on player exit;
  // closing it here would destroy the very screen we're meant to return to.
  if (returnController !== 'modal') {
    closeModalSafely();
  }

  const mappedPlaylist = playlist.map((candidateItem, candidateIndex) => {
    const targetIndex = candidateItem.file_index !== undefined
      ? candidateItem.file_index
      : candidateIndex;
    const candidateInfo = resolveFileInfo(candidateItem, historyCard, torrentHash, playlist);
    const candidateTimeline = Lampa.Timeline
      ? PlaybackProgress.trackTimeline(Lampa.Timeline.view(PlaybackProgress.timelineHash(instance, candidateItem.torstFileId, candidateInfo.hash)))
      : undefined;
    const isCurrentFile = targetIndex === fileIndex;

    const mappedItem: LampaPlayerItem = {
      ...candidateItem,
      card: historyCard,
      episode: candidateInfo.episode,
      file_index: targetIndex,
      first_title: historyCard.name || historyCard.title,
      movie: historyCard,
      season: candidateInfo.season,
      timeline: candidateTimeline,
      torrent_hash: torrentHash,
      url: isCurrentFile
        ? streamUrl
        : (callback?: () => void) => {
          TorstApi.getStreamUrl(instance, torrentHash, {
            index: targetIndex,
            path: candidateItem.path,
          }).then(resolvedUrl => {
            mappedItem.url = resolvedUrl;
            if (typeof callback === 'function') callback();
          }).catch(() => {
            if (typeof callback === 'function') callback();
          });
        },
    };
    return mappedItem;
  });

  const currentPlaylistIndex = mappedPlaylist.findIndex(item => item.file_index === fileIndex);

  let playerItem: LampaPlayerItem;
  if (currentPlaylistIndex >= 0) {
    playerItem = mappedPlaylist[currentPlaylistIndex];
    if (playerTimeline) playerItem.timeline = playerTimeline;
  } else {
    playerItem = {
      ...playlistItem,
      card: historyCard,
      episode: fileInfo.episode,
      file_index: fileIndex,
      first_title: historyCard.name || historyCard.title,
      movie: historyCard,
      season: fileInfo.season,
      timeline: playerTimeline,
      torrent_hash: torrentHash,
      url: streamUrl,
    };
    mappedPlaylist.push(playerItem);
  }

  playerItem.continue_play = true;
  playerItem.torrent = true;
  for (const item of mappedPlaylist) {
    item.continue_play = true;
    item.torrent = true;
  }

  if (historyCard.id !== undefined && typeof Lampa !== 'undefined' && typeof Lampa.Favorite?.add === 'function') {
    Lampa.Favorite.add('history', historyCard, 100);
  }
  recordWatchedHistory(historyCard, playerItem);

  if (typeof Lampa !== 'undefined' && Lampa.Player && typeof Lampa.Player.playlist === 'function') {
    rememberPlayerPlaylist(mappedPlaylist);
    Lampa.Player.playlist(mappedPlaylist);
  }
  PlaybackFocus.arm(mappedPlaylist, () => {
    Lampa.Controller.toggle(returnController);
  });
  Lampa.Player.play(playerItem);
  markTorrentViewed(sourceTorrentItem);

  if (typeof Lampa !== 'undefined' && Lampa.Listener && typeof Lampa.Listener.send === 'function') {
    Lampa.Listener.send('torrent_file', {
      element: playerItem,
      item: null,
      items: playlist,
      params: {
        files: playlist,
        movie: historyCard,
      },
      type: 'onenter',
    });
  }
  return true;
}

function resolvePlaybackPositionSeconds(timeline: unknown): number | undefined {
  // Only an unconditional resume is known to start at the saved position; in
  // 'ask' mode the viewer may still choose to start from the beginning.
  if (Lampa.Storage.field('player_timecode') !== 'continue') return undefined;
  if (!timeline || typeof timeline !== 'object') return undefined;

  const candidate = timeline as { percent?: unknown, time?: unknown };
  // The player skips resuming a file that is nearly finished or barely started.
  if (Number(candidate.percent) >= 90) return undefined;
  const playbackPositionSeconds = Number(candidate.time);
  if (
    !isFinite(playbackPositionSeconds)
    || playbackPositionSeconds <= 10
  ) return undefined;

  return playbackPositionSeconds;
}
