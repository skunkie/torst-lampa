// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { AuthenticationError } from '../src/api/auth';
import { NetworkError } from '../src/api/http-client';
import { TorstApi, TorstApiError } from '../src/api/torst';
import { resolveFileInfo, sortTorrentFiles } from '../src/engine/file-parser';
import { resolveMovieContext, resolvePosterUrl } from '../src/engine/media-context';
import { displayFileList, playTorrentFile } from '../src/engine/playback-session';
import { initPlayerPlaylist, resetPlayerPlaylistForTesting } from '../src/engine/player-playlist';
import { TorstEngine } from '../src/engine/torst-engine';
import { InstanceManager } from '../src/instances/instance-manager';
import type { Torrent, TorrentAdd, TorstInstance } from '../src/types/torst';
import { SAVE_TO_DATABASE_STORAGE_KEY } from '../src/ui/play-dialog';
import { PreloadModal } from '../src/ui/preload-modal';
import {
  PLAYBACK_MODE_STORAGE_KEY,
  TORST_ENABLED_STORAGE_KEY,
} from '../src/ui/settings';
import { createTestLanguage, getTestTranslation } from './support/translations';

describe('TorstEngine', () => {
  const originalFetch = globalThis.fetch;
  const storageMap = new Map<string, any>();
  let lastSelectShow: any = null;
  let lastNoty: string | null = null;

  beforeEach(() => {
    TorstEngine.resetForTesting();
    mock.method(PreloadModal, 'waitUntilReady', async () => true);
    mock.method(TorstApi, 'getStreamUrl', async (instance: TorstInstance, hash: string, file: { index?: number }) =>
      instance.url + '/api/v1/torrents/' + hash + '/files/' + (file.index ?? 0) + '/content');
    storageMap.clear();
    lastSelectShow = null;
    lastNoty = null;

    (globalThis as any).Lampa = {
      Activity: {
        active: () => null,
        all: () => [],
        push: () => {},
      },
      Lang: createTestLanguage(),
      Noty: {
        show: (text: string) => {
          lastNoty = text;
        },
      },
      Select: {
        show: (options: any) => {
          lastSelectShow = options;
        },
      },
      Storage: {
        field: (k: string) => storageMap.get(k),
        get: (k: string, d: any) => (storageMap.has(k) ? storageMap.get(k) : d),
        set: (k: string, v: any) => storageMap.set(k, v),
      },
      Torrent: {
        open: () => {},
        start: () => {},
      },
      Utils: {
        bytesToSize: (b: number) => `${b} B`,
        clearHtmlTags: (s: string) => s,
        hash: (s: string) => s,
      },
    };

    InstanceManager.init();
    TorstEngine.init();
  });

  afterEach(() => {
    TorstApi.resetForTesting();
    mock.restoreAll();
    globalThis.fetch = originalFetch;
    TorstEngine.resetForTesting();
  });

  it('reports enabled status based on storage', () => {
    storageMap.set(TORST_ENABLED_STORAGE_KEY, true);
    assert.equal(TorstEngine.isEnabled(), true);

    storageMap.set(TORST_ENABLED_STORAGE_KEY, false);
    assert.equal(TorstEngine.isEnabled(), false);
  });

  it('reports playback mode based on storage', () => {
    assert.equal(TorstEngine.getPlaybackMode(), 'torst');

    storageMap.set(PLAYBACK_MODE_STORAGE_KEY, 'ask');
    assert.equal(TorstEngine.getPlaybackMode(), 'ask');

    storageMap.set(PLAYBACK_MODE_STORAGE_KEY, 'context');
    assert.equal(TorstEngine.getPlaybackMode(), 'context');

    storageMap.set(PLAYBACK_MODE_STORAGE_KEY, 'torst');
    assert.equal(TorstEngine.getPlaybackMode(), 'torst');
  });

  it('prompts player choice when in ask mode', () => {
    TorstEngine.promptPlayerChoice({ Title: 'Test Movie' }, { title: 'Test Movie' });
    assert.ok(lastSelectShow);
    assert.equal(lastSelectShow.items.length, 2);
    assert.equal(lastSelectShow.items[0].action, 'torst');
    assert.equal(lastSelectShow.items[1].action, 'default');
  });

  it('delegates to Lampa.Api.img if available for poster resolution', () => {
    (globalThis as any).Lampa.Api = {
      img: (path: string, size: string) => `https://proxy.lampa.app/${size}${path}`,
    };

    const resolved = resolvePosterUrl(undefined, {
      poster_path: '/custom_path.jpg',
    });

    assert.equal(resolved, 'https://proxy.lampa.app/w500/custom_path.jpg');
    delete (globalThis as any).Lampa.Api;
  });

  it('handles absolute URLs, data URIs, and filters broken images in resolvePosterUrl', () => {
    assert.equal(
      resolvePosterUrl({ poster: 'https://example.com/poster.jpg' }),
      'https://example.com/poster.jpg'
    );
    assert.equal(
      resolvePosterUrl({ poster: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }),
      'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
    );
    assert.equal(
      resolvePosterUrl({ poster: '//image.tmdb.org/t/p/w500/abc.jpg' }),
      'https://image.tmdb.org/t/p/w500/abc.jpg'
    );
    // Skips broken image and uses movie poster_path
    assert.equal(
      resolvePosterUrl(
        { poster: './img/img_broken.svg' },
        { poster_path: '/fallback.jpg' }
      ),
      'https://image.tmdb.org/t/p/w500/fallback.jpg'
    );
  });

  it('shows error notification when no supported torrent source is present', async () => {
    let requestMade = false;
    globalThis.fetch = async () => {
      requestMade = true;
      return new Response(null, { status: 200 });
    };

    await TorstEngine.saveToDatabase({
      hash: '2938472948', // Numeric hash without magnet
      Link: 'not-a-torrent-source',
      Title: 'Invalid Source',
    });

    assert.equal(requestMade, false);
    assert.equal(lastNoty, getTestTranslation('torst_noty_hash_required'));
  });

  it('routes Lampa.Torrent.start directly to Torst startPlayback', () => {
    let startedPlaybackItem: any = null;
    let originalStarted = false;
    const origStartPlayback = TorstEngine.startPlayback;
    const origOriginalStart = (TorstEngine as any).originalTorrentStart;

    TorstEngine.startPlayback = async (item: any) => { startedPlaybackItem = item; };
    (TorstEngine as any).originalTorrentStart = () => { originalStarted = true; };

    try {
      // When disabled, routes to original Lampa.Torrent.start
      storageMap.set(TORST_ENABLED_STORAGE_KEY, false);
      (globalThis as any).Lampa.Torrent.start({ title: 'Test' });
      assert.equal(originalStarted, true);
      assert.equal(startedPlaybackItem, null);

      // When enabled, forwards directly to startPlayback
      originalStarted = false;
      storageMap.set(TORST_ENABLED_STORAGE_KEY, true);
      (globalThis as any).Lampa.Torrent.start({ title: 'Test Torrent' });
      assert.ok(startedPlaybackItem);
      assert.equal((startedPlaybackItem as any).title, 'Test Torrent');
      assert.equal(originalStarted, false);
    } finally {
      TorstEngine.startPlayback = origStartPlayback;
      (TorstEngine as any).originalTorrentStart = origOriginalStart;
    }
  });

  it('routes Lampa.Torrent.open directly to Torst startPlayback', () => {
    let startedPlaybackItem: any = null;
    let originalOpenedHash = '';
    const origStartPlayback = TorstEngine.startPlayback;
    const origOriginalOpen = (TorstEngine as any).originalTorrentOpen;

    TorstEngine.startPlayback = async (item: any) => { startedPlaybackItem = item; };
    (TorstEngine as any).originalTorrentOpen = (hash: string) => { originalOpenedHash = hash; };

    try {
      const testHash = '0123456789abcdef0123456789abcdef01234567';

      // When disabled, routes to original Lampa.Torrent.open
      storageMap.set(TORST_ENABLED_STORAGE_KEY, false);
      (globalThis as any).Lampa.Torrent.open(testHash);
      assert.equal(originalOpenedHash, testHash);
      assert.equal(startedPlaybackItem, null);

      // When enabled, forwards directly to startPlayback
      originalOpenedHash = '';
      storageMap.set(TORST_ENABLED_STORAGE_KEY, true);
      (globalThis as any).Lampa.Torrent.open(testHash);
      assert.ok(startedPlaybackItem);
      assert.equal((startedPlaybackItem as any).hash, testHash);
      assert.equal(originalOpenedHash, '');
    } finally {
      TorstEngine.startPlayback = origStartPlayback;
      (TorstEngine as any).originalTorrentOpen = origOriginalOpen;
    }
  });

  it('routes Lampa.Torrent.start and open per configured playback mode', () => {
    let startedPlaybackItem: any = null;
    let originalStarted = false;
    let originalOpenedHash = '';
    let promptedItem: any = null;
    const origStartPlayback = TorstEngine.startPlayback;
    const origPromptPlayerChoice = TorstEngine.promptPlayerChoice;
    const origOriginalStart = (TorstEngine as any).originalTorrentStart;
    const origOriginalOpen = (TorstEngine as any).originalTorrentOpen;

    TorstEngine.startPlayback = async (item: any) => { startedPlaybackItem = item; };
    TorstEngine.promptPlayerChoice = (item: any) => { promptedItem = item; };
    (TorstEngine as any).originalTorrentStart = () => { originalStarted = true; };
    (TorstEngine as any).originalTorrentOpen = (hash: string) => { originalOpenedHash = hash; };

    try {
      storageMap.set(TORST_ENABLED_STORAGE_KEY, true);
      const testHash = '0123456789abcdef0123456789abcdef01234567';

      // Manual mode: standard clicks fall through to the native player untouched.
      storageMap.set(PLAYBACK_MODE_STORAGE_KEY, 'context');
      (globalThis as any).Lampa.Torrent.start({ title: 'Test' });
      assert.equal(originalStarted, true);
      assert.equal(startedPlaybackItem, null);
      (globalThis as any).Lampa.Torrent.open(testHash);
      assert.equal(originalOpenedHash, testHash);
      assert.equal(startedPlaybackItem, null);

      // Ask mode: prompts the user to choose between Torst and the default player.
      originalStarted = false;
      originalOpenedHash = '';
      storageMap.set(PLAYBACK_MODE_STORAGE_KEY, 'ask');
      (globalThis as any).Lampa.Torrent.start({ title: 'Test' });
      assert.ok(promptedItem);
      assert.equal(startedPlaybackItem, null);
      promptedItem = null;
      (globalThis as any).Lampa.Torrent.open(testHash);
      assert.ok(promptedItem);
      assert.equal(startedPlaybackItem, null);

      // A session opened via the dedicated Torst button always plays directly, even in Manual/Ask mode.
      promptedItem = null;
      (globalThis as any).Lampa.Torrent.start({ title: 'Test' }, { torst: true });
      assert.ok(startedPlaybackItem);
      assert.equal(promptedItem, null);
    } finally {
      TorstEngine.startPlayback = origStartPlayback;
      TorstEngine.promptPlayerChoice = origPromptPlayerChoice;
      (TorstEngine as any).originalTorrentStart = origOriginalStart;
      (TorstEngine as any).originalTorrentOpen = origOriginalOpen;
      storageMap.set(PLAYBACK_MODE_STORAGE_KEY, 'torst');
    }
  });

  it('restores the launching controller when modal playback fails', async () => {
    const originalStartPlayback = TorstEngine.startPlayback;
    let activeController = '';
    let isModalClosed = false;

    (globalThis as any).Lampa.Controller = {
      enabled: () => ({ name: 'content' }),
      toggle: (name: string) => {
        activeController = name;
      },
    };
    (globalThis as any).Lampa.Modal = {
      close: () => {
        isModalClosed = true;
      },
    };
    (TorstEngine as any).startPlayback = async () => {
      throw new Error('Playback failed');
    };

    try {
      TorstEngine.playTorrentDirect({ title: 'Movie' });
      await new Promise(resolve => setTimeout(resolve, 0));
    } finally {
      (TorstEngine as any).startPlayback = originalStartPlayback;
    }

    assert.equal(isModalClosed, true);
    assert.equal(activeController, 'content');
    assert.equal(lastNoty, getTestTranslation('torst_noty_error', { msg: 'Playback failed' }));
  });

  it('renders multi-file torrents with the native TorrServer file dialog', async () => {
    const capturedHtml: string[] = [];
    let activeController = '';
    let isModalClosed = false;
    let modalOptions: any = null;
    let timelineRenderCount = 0;
    let focusedRow: any = null;
    let isModalReady = false;

    (globalThis as any).$ = (html: string) => {
      capturedHtml.push(html);
      const element: any = {
        append: (child: any) => { element.children.push(child); return element; },
        children: [],
        on: (_event: string, _callback: any) => element,
      };
      return element;
    };
    (globalThis as any).Lampa.Controller = {
      collectionFocus: (target: any, container: any) => {
        assert.equal(isModalReady, true, 'focus must follow modal visibility setup');
        assert.equal(target, false);
        assert.equal(container, modalOptions.html);
        focusedRow = container.children[0];
      },
      toggle: (name: string) => {
        activeController = name;
      },
    };
    (globalThis as any).Lampa.Lang = createTestLanguage('en', { title_files: 'Files' });
    (globalThis as any).Lampa.Modal = {
      close: () => {
        isModalClosed = true;
      },
      open: (options: any) => {
        modalOptions = options;
        focusedRow = null;
        isModalReady = true;
      },
    };
    (globalThis as any).Lampa.Template = {
      get: (_name: string, data: any) => (globalThis as any).$(`
        <div class="torrent-file selector">
          <div class="torrent-file__title">${data.title}<span class="exe">.${data.exe}</span></div>
          <div class="torrent-file__size">${data.size}</div>
        </div>
      `),
    };
    (globalThis as any).Lampa.Timeline = {
      render: () => {
        timelineRenderCount++;
        return (globalThis as any).$('<div class="time-line"></div>');
      },
      view: (hash: string) => ({ hash }),
    };

    await displayFileList(
      { authType: 'none', id: 'test', name: 'Test Node', url: 'http://127.0.0.1:8080' },
      {
        files: [
          { length: 1000, name: 'episode.01.mkv', path: 'episode.01.mkv' },
          { length: 2000, name: 'episode.02.mp4', path: 'episode.02.mp4' },
        ],
        hash: 'multi123',
        name: 'Series',
        retention: 'temporary' as const, storage: 'memory',
        title: 'Series',
        total_size: 3000,
      }
    );

    assert.ok(modalOptions);
    assert.ok(focusedRow);
    assert.equal(focusedRow, modalOptions.html.children[0]);
    assert.equal(modalOptions.mask, true);
    assert.equal(modalOptions.size, 'large');
    assert.equal(modalOptions.title, 'Files');
    assert.ok(capturedHtml.some(html => html.includes('class="torrent-files"')));
    assert.equal(capturedHtml.filter(html => html.includes('torrent-file selector')).length, 2);
    assert.equal(capturedHtml.some(html => html.includes('torst-file-item')), false);
    assert.equal(capturedHtml.some(html => html.includes('style=')), false);
    assert.equal(timelineRenderCount, 2);

    modalOptions.onBack();
    assert.equal(isModalClosed, true);
    assert.equal(activeController, 'content');
  });

  it('restores the caller\'s controller instead of the closed menu when playback cannot start', async () => {
    const toggledControllers: string[] = [];
    (globalThis as any).Lampa.Controller = {
      // A context menu owns the controller by the time its item handler runs.
      enabled: () => ({ name: 'select' }),
      toggle: (name: string) => { toggledControllers.push(name); },
    };
    (globalThis as any).Lampa.Modal = { close: () => {}, open: () => {} };
    storageMap.set(SAVE_TO_DATABASE_STORAGE_KEY, 'false');

    // Neither a magnet, a link, nor an info hash: playback bails out before any request.
    await TorstEngine.startPlayback({ Title: 'Sourceless Torrent' }, undefined, 'content');

    assert.deepEqual(toggledControllers, ['content'], 'the controller passed by the caller must win over the menu\'s own');
    assert.equal(lastNoty, getTestTranslation('torst_noty_hash_required'));

    await TorstEngine.startPlayback({ Title: 'Sourceless Torrent' });

    assert.deepEqual(
      toggledControllers,
      ['content', 'select'],
      'without a caller controller it still falls back to the enabled one'
    );
  });

  it('hands the file list modal back to the controller captured before the caller\'s menu opened', async () => {
    let modalOptions: any = null;
    const toggledControllers: string[] = [];

    (globalThis as any).$ = (_html: string) => {
      const element: any = {
        append: () => element,
        on: () => element,
      };
      return element;
    };
    (globalThis as any).Lampa.Controller = {
      enabled: () => ({ name: 'select' }),
      toggle: (name: string) => { toggledControllers.push(name); },
    };
    (globalThis as any).Lampa.Lang = createTestLanguage('en', { title_files: 'Files' });
    (globalThis as any).Lampa.Modal = {
      close: () => {},
      open: (options: any) => { modalOptions = options; },
    };
    (globalThis as any).Lampa.Template = {
      get: (_name: string, data: any) => ({
        append: () => {},
        html: `${data.title}.${data.exe}`,
        on: () => {},
      }),
    };

    await displayFileList(
      { authType: 'none', id: 'test', name: 'Test Node', url: 'http://127.0.0.1:8080' },
      {
        files: [
          { length: 1000, name: 'part-1.mp4', path: 'part-1.mp4' },
          { length: 1000, name: 'part-2.mp4', path: 'part-2.mp4' },
        ],
        hash: 'multi-return',
        name: 'Part Series',
        retention: 'temporary' as const, storage: 'memory',
        title: 'Part Series',
        total_size: 2000,
      },
      undefined,
      undefined,
      'content'
    );

    assert.ok(modalOptions);
    modalOptions.onBack();
    assert.deepEqual(toggledControllers, ['content'], 'closing the file list must not focus the menu that opened it');
  });

  it('fails over the save action when the selected instance request fails', async () => {
    const testHash = '0123456789abcdef0123456789abcdef01234567';
    const primaryInstance = {
      authType: 'none' as const,
      id: 'primary',
      name: 'Primary',
      url: 'http://primary.example.com',
    };
    const fallbackInstance = {
      authType: 'none' as const,
      id: 'fallback',
      name: 'Fallback',
      url: 'http://fallback.example.com',
    };
    const originalGetBestInstance = InstanceManager.getBestInstance;
    const originalFailover = InstanceManager.failover;
    let fallbackPostCount = 0;

    InstanceManager.getBestInstance = async () => primaryInstance;
    InstanceManager.failover = async () => fallbackInstance;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith(primaryInstance.url)) {
        return new Response(null, { status: 503 });
      }
      if (url.startsWith(fallbackInstance.url) && init?.method === 'POST') fallbackPostCount++;
      return new Response(JSON.stringify({
        files: [],
        hash: testHash,
        name: 'Movie',
        retention: 'temporary' as const, storage: 'memory',
        total_size: 1000,
      }), { status: 201 });
    };

    try {
      await TorstEngine.saveToDatabase({
        MagnetUri: `magnet:?xt=urn:btih:${testHash}`,
        Title: 'Movie',
      });
      assert.equal(fallbackPostCount, 1);
    } finally {
      InstanceManager.getBestInstance = originalGetBestInstance;
      InstanceManager.failover = originalFailover;
    }
  });

  it('awaits single-file playback and propagates its errors from the file list', async () => {
    mock.method(TorstApi, 'getStreamUrl', async () => { throw new Error('Stream unavailable'); });
    await assert.rejects(displayFileList(
      { authType: 'none', id: 'test', name: 'Test', url: 'http://127.0.0.1:8080' },
      {
        files: [{ length: 100, name: 'Sintel', path: 'Sintel.mkv' }],
        hash: 'hash', name: 'Sintel', retention: 'temporary' as const, storage: 'memory', total_size: 100,
      }
    ), /Stream unavailable/);
  });

  for (const variant of ['empty', 'missing-current', 'implicit-indices']) {
    it(`hands the exact played item to the player playlist (${variant})`, async () => {
      const playlist = variant === 'empty' ? [] : [
        { path: 'first.mkv', title: 'First' },
        { path: 'second.mkv', title: 'Second' },
      ];
      const fileIndex = variant === 'implicit-indices' ? 1 : 2;
      const currentItem = variant === 'implicit-indices' ? playlist[1] : { path: 'current.mkv', title: 'Current' };
      let played: any;
      let handedPlaylist: any[] = [];
      const calls: string[] = [];
      (globalThis as any).Lampa.Player = {
        callback: () => {},
        play: (item: any) => { played = item; calls.push('play'); },
        playlist: (items: any[]) => { handedPlaylist = items; calls.push('playlist'); },
      };
      mock.method(TorstApi, 'getStreamUrl', async () => 'http://127.0.0.1/stream');

      await playTorrentFile(
        { authType: 'none', id: 'test', name: 'Test', url: 'http://127.0.0.1:8080' },
        'hash', fileIndex, currentItem, playlist
      );

      assert.deepEqual(calls, ['playlist', 'play']);
      assert.ok(handedPlaylist.includes(played));
      assert.equal(played.file_index, fileIndex);
      assert.equal(played.url, 'http://127.0.0.1/stream');
      assert.equal(handedPlaylist.length, variant === 'implicit-indices' ? 2 : playlist.length + 1);
      assert.ok(handedPlaylist.every(item => item.continue_play === true && item.torrent === true));
      assert.doesNotThrow(() => JSON.stringify(played));
    });
  }

  it('tags player item and playlist with continue_play and torrent for native ad exemption', async () => {
    const testHash = '5555555555555555555555555555555555555555';
    let playedItem: any = null;
    let playedPlaylist: any[] = [];
    const callOrder: string[] = [];

    (globalThis as any).Lampa.Loading = {
      setProgress: () => {},
      start: () => {},
      stop: () => {},
    };
    (globalThis as any).Lampa.Player = {
      callback: () => {},
      play: (item: any) => {
        callOrder.push('play');
        playedItem = item;
      },
      playlist: (items: any[]) => {
        callOrder.push('playlist');
        playedPlaylist = items;
      },
    };

    mock.method(InstanceManager, 'getBestInstance', async () => InstanceManager.getInstances()[0]);
    mock.method(TorstApi, 'addTorrent', async () => ({
      files: [{ length: 5000, name: 'video.mkv', path: 'video.mkv' }],
      hash: testHash,
      name: 'Sintel',
      retention: 'temporary' as const, storage: 'memory',
      total_size: 5000,
    }));

    await TorstEngine.startPlayback({
      MagnetUri: `magnet:?xt=urn:btih:${testHash}&dn=Video`,
      Title: 'Video',
    });

    assert.ok(playedItem);
    assert.equal(playedItem.continue_play, true);
    assert.equal(playedItem.torrent, true);
    assert.ok(playedPlaylist.every(item => item.continue_play === true && item.torrent === true));
    assert.deepEqual(callOrder, ['playlist', 'play']);
    assert.doesNotThrow(() => JSON.stringify(playedItem), 'played item must not be circular');
  });

  it('saves played torrent to Lampa.Favorite history and emits onenter event with movie context', async () => {
    let favoriteCard: any = null;
    let favoriteTarget = '';
    let listenerEvent: any = null;
    let playedItem: any = null;
    let playlistItems: any[] = [];
    const testHash = '0123456789abcdef0123456789abcdef01234567';

    (globalThis as any).Lampa.Favorite = {
      add: (where: string, card: any) => {
        favoriteCard = card;
        favoriteTarget = where;
      },
    };
    (globalThis as any).Lampa.Listener = {
      send: (type: string, data: any) => {
        if (type === 'torrent_file') {
          listenerEvent = data;
        }
      },
    };
    (globalThis as any).Lampa.Loading = {
      setProgress: () => {},
      start: () => {},
      stop: () => {},
    };
    (globalThis as any).Lampa.Player = {
      callback: () => {},
      play: (item: any) => {
        playedItem = item;
      },
      playlist: (items: any[]) => {
        playlistItems = items;
      },
    };

    mock.method(InstanceManager, 'getBestInstance', async () => InstanceManager.getInstances()[0]);
    mock.method(TorstApi, 'addTorrent', async () => ({
      files: [{ length: 5000, name: 'video.mkv', path: 'video.mkv' }],
      hash: testHash,
      name: 'Sintel',
      retention: 'temporary' as const, storage: 'memory',
      total_size: 5000,
    }));

    const movieContext = {
      id: 4242,
      original_title: 'Example Film',
      poster_path: '/example-film-poster.jpg',
      release_date: '1999-03-30',
      title: 'Example Film',
    };

    await TorstEngine.startPlayback(
      {
        MagnetUri: `magnet:?xt=urn:btih:${testHash}&dn=Example%20Film`,
        Title: 'Example Film',
      },
      movieContext
    );

    assert.equal(favoriteTarget, 'history');
    assert.ok(favoriteCard);
    assert.equal(favoriteCard.id, 4242);
    assert.equal(favoriteCard.name, undefined);
    assert.equal(favoriteCard.original_name, undefined);
    assert.equal(favoriteCard.name ? 'tv' : 'movie', 'movie');
    assert.equal(favoriteCard.original_name ? 'tv' : 'movie', 'movie');
    assert.equal(favoriteCard.title, 'Example Film');
    assert.deepEqual(favoriteCard, movieContext);

    assert.ok(playedItem);
    assert.equal(playedItem.card.id, 4242);
    assert.equal(playedItem.first_title, 'Example Film');
    assert.equal(playedItem.movie.id, 4242);
    assert.equal(playedItem.torrent_hash, testHash);

    assert.equal(playlistItems.length, 1);
    assert.equal(playlistItems[0].card.id, 4242);
    assert.equal(playlistItems[0].first_title, 'Example Film');

    assert.ok(listenerEvent);
    assert.equal(listenerEvent.type, 'onenter');
    assert.equal(listenerEvent.params.movie.id, 4242);
    assert.equal(listenerEvent.element.card.id, 4242);
  });

  it('preserves TV and custom catalog identities in history and the player', async () => {

    const cards = [
      { first_air_date: '2020-01-01', id: 123, name: 'Show', original_name: 'Original Show', source: 'tmdb' },
      { id: 'custom-123', source: 'custom', title: 'Custom Movie' },
    ];
    for (const card of cards) {
      let savedCard: any;
      let playerCard: any;
      (globalThis as any).Lampa.Favorite = { add: (_where: string, movie: any) => { savedCard = movie; } };
      (globalThis as any).Lampa.Player = {
        callback: () => {},
        play: (item: any) => { playerCard = item.card; },
        playlist: () => {},
      };
      await playTorrentFile(
        { authType: 'none', id: 'test', name: 'Test', url: 'http://localhost:8080' },
        'hash', 0, { title: 'video.mkv' }, [], card
      );
      assert.deepEqual(savedCard, card);
      assert.deepEqual(playerCard, card);
      assert.notEqual(savedCard, card);
      assert.equal(savedCard.name ? 'tv' : 'movie', card.name ? 'tv' : 'movie');
    }
  });

  it('records the played episode as the show\'s last watched entry, like Lampa\'s own file list', async () => {

    storageMap.set('online_watched_last', { 'Original Show': { balanser_name: 'Online', voice_name: 'Dub' } });
    (globalThis as any).Lampa.Favorite = { add: () => {} };
    (globalThis as any).Lampa.Player = { callback: () => {}, play: () => {}, playlist: () => {} };

    await playTorrentFile(
      { authType: 'none', id: 'test', name: 'Test', url: 'http://localhost:8080' },
      'hash',
      0,
      { path: 'Show/Show.S01E05.mkv', title: 'Show.S01E05.mkv' },
      [],
      { id: 123, name: 'Show', number_of_seasons: 3, original_name: 'Original Show' }
    );

    assert.deepEqual(storageMap.get('online_watched_last'), {
      'Original Show': { balanser_name: 'Torrent', episode: 5, season: 1, voice_name: 'Dub' },
    });
  });

  it('keeps the next episode recognized as continuing the playlist when Lampa switches episodes', async () => {

    const createListeners: Array<(event: any) => void> = [];
    let lampaPlaylist: any[] = [];
    let handedPlaylist: any[] = [];
    (globalThis as any).Lampa.Favorite = { add: () => {} };
    (globalThis as any).Lampa.Player = {
      callback: () => {},
      listener: { follow: (name: string, listener: any) => { if (name === 'create') createListeners.push(listener); } },
      play: () => {},
      playlist: (items: any[]) => { handedPlaylist = items; lampaPlaylist = items; },
    };
    (globalThis as any).Lampa.PlayerPlaylist = { get: () => lampaPlaylist, set: (items: any[]) => { lampaPlaylist = items; } };
    resetPlayerPlaylistForTesting();
    initPlayerPlaylist();

    const playlist = [
      { file_index: 0, path: 'Show/e01.mkv', title: 'e01.mkv' },
      { file_index: 1, path: 'Show/e02.mkv', title: 'e02.mkv' },
    ];
    await playTorrentFile(
      { authType: 'none', id: 'test', name: 'Test', url: 'http://localhost:8080' },
      'hash', 0, playlist[0], playlist, { id: 7, name: 'Show', original_name: 'Show' }
    );

    // Lampa's switch to the next episode: the player is torn down, emptying its playlist,
    // and the next item is announced before the preroll check looks at that playlist.
    lampaPlaylist = [];
    const nextEpisode = handedPlaylist[1];
    createListeners.forEach(listener => listener({ abort: () => {}, data: nextEpisode }));

    assert.ok(nextEpisode.continue_play);
    assert.ok(lampaPlaylist.includes(nextEpisode));
    resetPlayerPlaylistForTesting();
  });

  it('unwraps nested movie and card contexts and resolves from activity stack', () => {
    // Direct with id
    assert.deepEqual(
      resolveMovieContext({ id: 101, title: 'Direct' }),
      { id: 101, title: 'Direct' }
    );

    // Nested in .movie
    assert.deepEqual(
      resolveMovieContext({ movie: { id: 102, title: 'Nested Movie' } }),
      { id: 102, title: 'Nested Movie' }
    );

    // Nested in .card
    assert.deepEqual(
      resolveMovieContext({ card: { id: 103, title: 'Nested Card' } }),
      { id: 103, title: 'Nested Card' }
    );

    // From active activity when passed context has no id
    (globalThis as any).Lampa.Activity.active = () => ({
      movie: { id: 201, title: 'Active Activity Movie' },
    });
    assert.deepEqual(
      resolveMovieContext({ from_search: true }),
      { id: 201, title: 'Active Activity Movie' }
    );

    // From activity stack history when active has no movie
    (globalThis as any).Lampa.Activity.active = () => null;
    (globalThis as any).Lampa.Activity.all = () => [
      { movie: { id: 301, title: 'Stack Movie' } },
      { component: 'search' },
    ];
    assert.deepEqual(
      resolveMovieContext(),
      { id: 301, title: 'Stack Movie' }
    );

    // Fallback to title/name object if no id anywhere
    (globalThis as any).Lampa.Activity.all = () => [];
    assert.deepEqual(
      resolveMovieContext({ title: 'Fallback Title' }),
      { title: 'Fallback Title' }
    );
  });

  it('naturally sorts multi-file torrent files by numeric sequence and directory structure', () => {
    const unsortedFiles = [
      { name: 'Show.S01E10.mkv', path: 'Show.S01E10.mkv' },
      { name: 'Show.S01E02.mkv', path: 'Show.S01E02.mkv' },
      { name: 'Show.S01E01.mkv', path: 'Show.S01E01.mkv' },
      { name: 'Show.S01E20.mkv', path: 'Show.S01E20.mkv' },
      { name: 'Show.S01E03.mkv', path: 'Show.S01E03.mkv' },
    ];

    const sorted = sortTorrentFiles(unsortedFiles);
    assert.deepEqual(
      sorted.map(f => f.name),
      [
        'Show.S01E01.mkv',
        'Show.S01E02.mkv',
        'Show.S01E03.mkv',
        'Show.S01E10.mkv',
        'Show.S01E20.mkv',
      ]
    );

    const folderFiles = [
      { path: 'Season 2/Episode 1.mkv' },
      { path: 'Season 10/Episode 1.mkv' },
      { path: 'Season 1/Episode 2.mkv' },
      { path: 'Season 1/Episode 1.mkv' },
    ];
    const sortedFolders = sortTorrentFiles(folderFiles);
    assert.deepEqual(
      sortedFolders.map(f => f.path),
      [
        'Season 1/Episode 1.mkv',
        'Season 1/Episode 2.mkv',
        'Season 2/Episode 1.mkv',
        'Season 10/Episode 1.mkv',
      ]
    );

    const largeNumberFiles = [
      { name: 'clip-10000.mp4' },
      { name: 'clip-9999.mp4' },
      { name: 'clip-2.mp4' },
      { name: 'clip-1.mp4' },
    ];
    const sortedLargeNumbers = sortTorrentFiles(largeNumberFiles);
    assert.deepEqual(
      sortedLargeNumbers.map(f => f.name),
      [
        'clip-1.mp4',
        'clip-2.mp4',
        'clip-9999.mp4',
        'clip-10000.mp4',
      ]
    );
  });

  it('displays multi-file torrents in natural sorted order and resolves correct file_index', async () => {
    const capturedCards: string[] = [];
    let modalOptions: any = null;

    (globalThis as any).$ = (_html: string) => {
      const element: any = {
        append: (child: any) => {
          if (child && child.html) capturedCards.push(child.html);
          return element;
        },
        on: (_event: string, _callback: any) => element,
      };
      return element;
    };
    (globalThis as any).Lampa.Controller = {
      toggle: () => {},
    };
    (globalThis as any).Lampa.Lang = createTestLanguage('en', { title_files: 'Files' });
    (globalThis as any).Lampa.Modal = {
      close: () => {},
      open: (options: any) => {
        modalOptions = options;
      },
    };
    (globalThis as any).Lampa.Template = {
      get: (_name: string, data: any) => ({
        append: () => {},
        html: `${data.title}.${data.exe}`,
        on: () => {},
      }),
    };

    await displayFileList(
      { authType: 'none', id: 'test', name: 'Test Node', url: 'http://127.0.0.1:8080' },
      {
        files: [
          { length: 1000, name: 'part-10.mp4', path: 'part-10.mp4' },
          { length: 1000, name: 'part-1.mp4', path: 'part-1.mp4' },
          { length: 1000, name: 'part-2.mp4', path: 'part-2.mp4' },
        ],
        hash: 'multi-sort',
        name: 'Part Series',
        retention: 'temporary' as const, storage: 'memory',
        title: 'Part Series',
        total_size: 3000,
      }
    );

    assert.ok(modalOptions);
    assert.deepEqual(capturedCards, [
      'part-1.mp4',
      'part-2.mp4',
      'part-10.mp4',
    ]);
  });

  it('leaves the file list modal open behind the player and refocuses it (instead of the torrent card) when the player exits', async () => {
    let modalOpenCount = 0;
    let modalCloseCount = 0;
    let loadingStopCount = 0;
    let capturedEnterHandler: (() => Promise<void>) | undefined;
    let capturedPlayerExitCallback: (() => void) | undefined;
    let toggledController = '';
    let playedItem: any = null;

    (globalThis as any).$ = (_html: string) => {
      const element: any = {
        append: () => element,
        on: () => element,
      };
      return element;
    };
    (globalThis as any).Lampa.Controller = {
      enabled: () => ({ name: 'content' }),
      toggle: (name: string) => { toggledController = name; },
    };
    (globalThis as any).Lampa.Lang = createTestLanguage('en', { title_files: 'Files' });
    (globalThis as any).Lampa.Modal = {
      close: () => { modalCloseCount += 1; },
      open: () => { modalOpenCount += 1; },
    };
    (globalThis as any).Lampa.Template = {
      get: () => {
        const element: any = {
          append: () => element,
          on: (event: string, callback: any) => {
            if (event === 'hover:enter') capturedEnterHandler = callback;
            return element;
          },
        };
        return element;
      },
    };
    (globalThis as any).Lampa.Loading = { stop: () => { loadingStopCount++; } };
    (globalThis as any).Lampa.Favorite = { add: () => {} };
    (globalThis as any).Lampa.Player = {
      callback: (cb: () => void) => {
        capturedPlayerExitCallback = cb;
      },
      play: (item: any) => {
        playedItem = item;
      },
      playlist: () => {},
    };

    await displayFileList(
      { authType: 'none', id: 'test', name: 'Test Node', url: 'http://127.0.0.1:8080' },
      {
        files: [
          { length: 1000, name: 'part-1.mp4', path: 'part-1.mp4' },
          { length: 1000, name: 'part-2.mp4', path: 'part-2.mp4' },
        ],
        hash: 'multi-exit-test',
        name: 'Part Series',
        retention: 'temporary' as const, storage: 'memory',
        title: 'Part Series',
        total_size: 2000,
      }
    );

    assert.equal(modalOpenCount, 1, 'file list modal should open initially');
    assert.ok(capturedEnterHandler, 'hover:enter handler should be registered on each file item');

    await capturedEnterHandler!();
    await new Promise(resolve => setImmediate(resolve));

    assert.ok(playedItem, 'selecting a file should start playback');
    assert.equal(loadingStopCount, 0, 'playback must not stop a loading screen outside the preload lifecycle');
    assert.equal(modalCloseCount, 0, 'selecting a file must NOT close the file list modal (Lampa leaves it open behind the player)');
    assert.ok(capturedPlayerExitCallback, 'a Player.callback exit handler should be registered');

    capturedPlayerExitCallback!();

    assert.equal(modalOpenCount, 1, 'the modal must not be recreated on exit, only refocused');
    assert.equal(toggledController, 'modal', 'player exit must refocus the still-open file list modal, not the torrent card');
  });

  it('reports multi-file playback failures and restores D-pad focus to the file modal', async () => {
    let capturedEnterHandler: (() => void) | undefined;
    let loadingStopCount = 0;
    let toggledController = '';

    (globalThis as any).$ = () => {
      const element: any = {
        append: () => element,
        on: () => element,
      };
      return element;
    };
    (globalThis as any).Lampa.Controller = {
      enabled: () => ({ name: 'content' }),
      toggle: (name: string) => { toggledController = name; },
    };
    (globalThis as any).Lampa.Lang = createTestLanguage();
    (globalThis as any).Lampa.Loading = { stop: () => { loadingStopCount++; } };
    (globalThis as any).Lampa.Modal = { open: () => {} };
    (globalThis as any).Lampa.Template = {
      get: () => {
        const element: any = {
          append: () => element,
          on: (event: string, callback: () => void) => {
            if (event === 'hover:enter') capturedEnterHandler = callback;
            return element;
          },
        };
        return element;
      },
    };

    const originalGetStreamUrl = TorstApi.getStreamUrl;
    (TorstApi as any).getStreamUrl = async () => { throw new Error('stream unavailable'); };

    try {
      await displayFileList(
        { authType: 'none', id: 'test', name: 'Test Node', url: 'http://127.0.0.1:8080' },
        {
          files: [
            { length: 1, name: 'part-1.mp4', path: 'part-1.mp4' },
            { length: 1, name: 'part-2.mp4', path: 'part-2.mp4' },
          ],
          hash: 'failed-playback',
          name: 'Parts',
          retention: 'temporary' as const, storage: 'memory',
          total_size: 2,
        }
      );

      assert.ok(capturedEnterHandler);
      capturedEnterHandler();
      await new Promise(resolve => setImmediate(resolve));

      assert.equal(loadingStopCount, 1);
      assert.equal(toggledController, 'modal');
      assert.equal(lastNoty, getTestTranslation('torst_noty_error', { msg: 'stream unavailable' }));
    } finally {
      TorstApi.getStreamUrl = originalGetStreamUrl;
    }
  });

  it('renders TV episode files with a TMDB still image, episode name, and air date instead of a plain title row', async () => {
    const templateCalls: Array<{ data: any, name: string }> = [];
    let capturedSeasonsQuery: { movie: any, seasons: number[] } | undefined;

    (globalThis as any).$ = (_html: string) => {
      const element: any = {
        append: () => element,
        find: () => element,
        on: () => element,
      };
      element[0] = {};
      return element;
    };
    (globalThis as any).Lampa.Controller = { enabled: () => ({ name: 'content' }), toggle: () => {} };
    (globalThis as any).Lampa.Lang = createTestLanguage('en', { title_files: 'Files' });
    (globalThis as any).Lampa.Modal = { close: () => {}, open: () => {} };
    (globalThis as any).Lampa.Template = {
      get: (name: string, data: any) => {
        templateCalls.push({ data, name });
        const element: any = {
          append: () => element,
          find: () => element,
          on: () => element,
        };
        element[0] = {};
        return element;
      },
    };
    (globalThis as any).Lampa.Api = {
      img: (path: string) => `https://image.tmdb.org/t/p/w300${path}`,
      seasons: (movie: any, seasons: number[], onComplete: (data: any) => void) => {
        capturedSeasonsQuery = { movie, seasons };
        onComplete({
          1: {
            episodes: [
              { air_date: '2020-01-02', episode_number: 1, name: 'Pilot', still_path: '/pilot.jpg' },
              { air_date: '2020-01-09', episode_number: 2, name: 'Second Episode', still_path: '/second.jpg' },
            ],
          },
        });
      },
    };
    (globalThis as any).Lampa.Utils = {
      ...(globalThis as any).Lampa.Utils,
      parseTime: (value: string) => ({ full: `formatted:${value}` }),
    };

    await displayFileList(
      { authType: 'none', id: 'test', name: 'Test Node', url: 'http://127.0.0.1:8080' },
      {
        files: [
          { length: 1000, name: 'Show.S01E01.mkv', path: 'Show.S01E01.mkv' },
          { length: 1000, name: 'Show.S01E02.mkv', path: 'Show.S01E02.mkv' },
        ],
        hash: 'tv-show-hash',
        name: 'Show',
        retention: 'temporary' as const, storage: 'memory',
        title: 'Show',
        total_size: 2000,
      },
      { id: 99, name: 'Show', number_of_seasons: 1, original_name: 'Show' }
    );

    assert.deepEqual(capturedSeasonsQuery?.seasons, [1], 'must fetch the season detected from the parsed episode files');
    assert.equal(templateCalls.length, 2);
    assert.equal(templateCalls[0].name, 'torrent_file_serial');
    assert.equal(templateCalls[0].data.fname, 'Pilot');
    assert.equal(templateCalls[0].data.img, 'https://image.tmdb.org/t/p/w300/pilot.jpg');
    assert.equal(templateCalls[0].data.air_date, 'formatted:2020-01-02');
    assert.equal(templateCalls[1].data.fname, 'Second Episode');
    assert.equal(templateCalls[1].data.img, 'https://image.tmdb.org/t/p/w300/second.jpg');
  });

  it('resolves standard Lampa timeline hash, season, and episode for movies and TV shows', () => {
    // Single movie: hash must match movie.original_title
    const movieInfo = resolveFileInfo(
      { path: 'Example.Film.2026.1080p.mkv' },
      { original_title: 'Example Film', title: 'Пример фильма' },
      'torrent123'
    );
    assert.equal(movieInfo.season, null);
    assert.equal(movieInfo.episode, null);
    assert.equal(movieInfo.serial, false);
    assert.equal(
      movieInfo.hash,
      (globalThis as any).Lampa.Utils.hash('Example Film')
    );

    // TV show with S02E07 pattern
    const showInfo = resolveFileInfo(
      { path: 'Season 02/Example.Series.S02E07.mkv' },
      { number_of_seasons: 8, original_title: 'Example Series' },
      'torrent123'
    );
    assert.equal(showInfo.season, 2);
    assert.equal(showInfo.episode, 7);
    assert.equal(showInfo.serial, true);
    assert.equal(
      showInfo.hash,
      (globalThis as any).Lampa.Utils.hash('27Example Series')
    );

    // TV show with Russian text "1 сезон 12 серия"
    const ruShowInfo = resolveFileInfo(
      { path: '1 сезон 12 серия.mkv' },
      { original_name: 'Сериал' },
      'torrent123'
    );
    assert.equal(ruShowInfo.season, 1);
    assert.equal(ruShowInfo.episode, 12);
    assert.equal(ruShowInfo.serial, true);
    assert.equal(
      ruShowInfo.hash,
      (globalThis as any).Lampa.Utils.hash('112Сериал')
    );

    // TV show in season folder with numeric episode "Season 3/09.mkv"
    const folderShowInfo = resolveFileInfo(
      { path: 'Season 3/09.mkv' },
      { number_of_seasons: 5, original_title: 'Show' },
      'torrent123'
    );
    assert.equal(folderShowInfo.season, 3);
    assert.equal(folderShowInfo.episode, 9);
    assert.equal(
      folderShowInfo.hash,
      (globalThis as any).Lampa.Utils.hash('39Show')
    );

    // Season > 10 format uses colon separator (e.g. 11:4)
    const lateSeasonInfo = resolveFileInfo(
      { path: 'S11E04.mkv' },
      { number_of_seasons: 15, original_title: 'Show' },
      'torrent123'
    );
    assert.equal(lateSeasonInfo.season, 11);
    assert.equal(lateSeasonInfo.episode, 4);
    assert.equal(
      lateSeasonInfo.hash,
      (globalThis as any).Lampa.Utils.hash('11:4Show')
    );

    // Standalone video without movie metadata falls back to torrent hash and path
    const standaloneInfo = resolveFileInfo(
      { path: 'video.mp4' },
      undefined,
      'standalonehash'
    );
    assert.equal(
      standaloneInfo.hash,
      (globalThis as any).Lampa.Utils.hash('standalonehash:video.mp4')
    );

    // Delegates to `Lampa.Torserver.parse` when present
    const originalTorserver = (globalThis as any).Lampa.Torserver;
    try {
      (globalThis as any).Lampa.Torserver = {
        parse: () => ({
          episode: 5,
          hash: 777888,
          season: 2,
          serial: true,
        }),
      };
      const nativeParsed = resolveFileInfo(
        { path: 'dummy.mkv' },
        { original_title: 'Any' },
        'anyhash'
      );
      assert.equal(nativeParsed.hash, 777888);
      assert.equal(nativeParsed.season, 2);
      assert.equal(nativeParsed.episode, 5);
      assert.equal(nativeParsed.serial, true);
    } finally {
      (globalThis as any).Lampa.Torserver = originalTorserver;
    }

    // Falls back gracefully and logs when `Lampa.Torserver.parse` throws
    try {
      let debugMessage = '';
      const originalDebug = console.debug;
      console.debug = (...args: any[]) => {
        debugMessage = args.join(' ');
      };
      (globalThis as any).Lampa.Torserver = {
        parse: () => {
          throw new Error('Malformed torrent descriptor');
        },
      };

      try {
        const fallbackParsed = resolveFileInfo(
          { path: 'Season 01/Show.S01E03.mkv' },
          { number_of_seasons: 1, original_title: 'Fallback Show' },
          'anyhash'
        );
        assert.equal(fallbackParsed.season, 1);
        assert.equal(fallbackParsed.episode, 3);
        assert.ok(debugMessage.includes('Lampa.Torserver.parse failed'));
      } finally {
        console.debug = originalDebug;
      }
    } finally {
      (globalThis as any).Lampa.Torserver = originalTorserver;
    }
  });

  it('uses the torrent\'s own poster and title instead of an unrelated active movie when playing from the database browser', async () => {
    let playedItem: any = null;
    const testHash = '0123456789abcdef0123456789abcdef01234567';

    (globalThis as any).Lampa.Favorite = { add: () => {} };
    (globalThis as any).Lampa.Loading = { setProgress: () => {}, start: () => {}, stop: () => {} };
    (globalThis as any).Lampa.Player = {
      callback: () => {},
      play: (item: any) => { playedItem = item; },
      playlist: () => {},
    };
    // Simulate the user having some unrelated movie open elsewhere in the app —
    // this must never bleed into a torrent played directly from the database browser.
    (globalThis as any).Lampa.Activity.active = () => ({
      movie: { id: 999, img: 'https://example.com/unrelated-movie-poster.jpg', title: 'Unrelated Movie' },
    });

    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/torrents')) {
        return new Response(JSON.stringify({
          files: [{ length: 1000, name: 'movie.mkv', path: 'movie.mkv' }],
          hash: testHash,
          name: 'My Saved Torrent',
          poster: 'https://example.com/my-torrent-poster.jpg',
          retention: 'temporary' as const, storage: 'memory',
          title: 'My Saved Torrent',
          total_size: 1000,
        }), {
          headers: { 'Content-Type': 'application/json' },
          status: 201,
        });
      }
      return new Response(null, { status: 200 });
    };

    // No movie argument passed — matches how the database torrents browser calls this.
    await TorstEngine.startTorrentPlayback({
      files: [{ length: 1000, name: 'movie.mkv', path: 'movie.mkv' }],
      hash: testHash,
      name: 'My Saved Torrent',
      poster: 'https://example.com/my-torrent-poster.jpg',
      retention: 'temporary' as const, storage: 'memory',
      title: 'My Saved Torrent',
      total_size: 1000,
    });

    assert.ok(playedItem);
    assert.equal(playedItem.card.title, 'My Saved Torrent');
    assert.equal(playedItem.card.img, 'https://example.com/my-torrent-poster.jpg');
    assert.notEqual(playedItem.card.title, 'Unrelated Movie');
  });

  it('uses the originating instance when playing an existing database torrent', async () => {
    let playedItem: any = null;
    let getBestInstanceCallCount = 0;
    const testHash = '0123456789abcdef0123456789abcdef01234567';
    const sourceInstance = {
      authType: 'none' as const,
      id: 'database-instance',
      name: 'Database Instance',
      url: 'http://database.example.com',
    };
    const originalGetBestInstance = InstanceManager.getBestInstance;

    InstanceManager.getBestInstance = async () => {
      getBestInstanceCallCount++;
      throw new Error('Must not select a different instance');
    };
    (globalThis as any).Lampa.Loading = { setProgress: () => {}, start: () => {}, stop: () => {} };
    (globalThis as any).Lampa.Player = {
      callback: () => {},
      play: (item: any) => { playedItem = item; },
      playlist: () => {},
    };

    try {
      const isHandedOff = await TorstEngine.startTorrentPlayback(
        {
          files: [{ length: 1000, name: 'movie.mkv', path: 'movie.mkv' }],
          hash: testHash,
          name: 'Saved Movie',
          retention: 'temporary' as const, storage: 'memory',
          total_size: 1000,
        },
        0,
        undefined,
        sourceInstance
      );

      assert.equal(isHandedOff, true);
      assert.equal(getBestInstanceCallCount, 0);
      assert.ok(playedItem.url.startsWith(sourceInstance.url));
    } finally {
      InstanceManager.getBestInstance = originalGetBestInstance;
    }
  });

  it('reports no hand-off when the preload is canceled', async () => {
    let playCount = 0;
    const originalWaitUntilReady = PreloadModal.waitUntilReady;
    PreloadModal.waitUntilReady = async () => false;
    (globalThis as any).Lampa.Player = {
      callback: () => {},
      play: () => { playCount++; },
      playlist: () => {},
    };

    try {
      const isHandedOff = await TorstEngine.startTorrentPlayback(
        {
          files: [{ length: 1000, name: 'movie.mkv', path: 'movie.mkv' }],
          hash: '0123456789abcdef0123456789abcdef01234567',
          name: 'Saved Movie',
          retention: 'temporary' as const, storage: 'memory',
          total_size: 1000,
        },
        0,
        undefined,
        { authType: 'none', id: 'database-instance', name: 'Database Instance', url: 'http://database.example.com' }
      );

      assert.equal(isHandedOff, false);
      assert.equal(playCount, 0);
    } finally {
      PreloadModal.waitUntilReady = originalWaitUntilReady;
    }
  });

  it('waits for preload readiness before resolving the stream and opening the player', async () => {
    let finishPreload: (isReady: boolean) => void = () => {};
    const preload = mock.method(PreloadModal, 'waitUntilReady', () => new Promise<boolean>(resolve => {
      finishPreload = resolve;
    }));
    const streamUrl = mock.method(TorstApi, 'getStreamUrl', async () => 'http://test.local/api/v1/torrents/trr_test/files/fil_test/content');
    const playedItems: LampaPlayerItem[] = [];
    (globalThis as any).Lampa.Player = {
      callback: () => {},
      play: (item: LampaPlayerItem) => playedItems.push(item),
      playlist: () => {},
    };
    const item = { file_index: 0, path: 'movie.mkv', title: 'Movie' };
    const pendingPlayback = playTorrentFile(
      { authType: 'none', id: 'test', name: 'Test', url: 'http://test.local' },
      'hash',
      0,
      item,
      [item]
    );

    assert.equal(preload.mock.callCount(), 1);
    assert.equal(streamUrl.mock.callCount(), 0);
    assert.equal(playedItems.length, 0);
    finishPreload(true);
    assert.equal(await pendingPlayback, true);
    assert.equal(playedItems.length, 1);
  });

  it('tolerates Lampa.Modal.close() throwing when no modal is open during single-file playback', async () => {
    let playedItem: any = null;
    const testHash = '0123456789abcdef0123456789abcdef01234567';

    (globalThis as any).Lampa.Favorite = { add: () => {} };
    (globalThis as any).Lampa.Loading = { setProgress: () => {}, start: () => {}, stop: () => {} };
    (globalThis as any).Lampa.Modal = {
      close: () => {
        throw new TypeError("Cannot read properties of undefined (reading 'destroy')");
      },
      open: () => {},
    };
    (globalThis as any).Lampa.Player = {
      callback: () => {},
      play: (item: any) => { playedItem = item; },
      playlist: () => {},
    };

    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/torrents')) {
        return new Response(JSON.stringify({
          files: [{ length: 1000, name: 'movie.mkv', path: 'movie.mkv' }],
          hash: testHash,
          name: 'My Saved Torrent',
          retention: 'temporary' as const, storage: 'memory',
          total_size: 1000,
        }), {
          headers: { 'Content-Type': 'application/json' },
          status: 201,
        });
      }
      return new Response(null, { status: 200 });
    };

    await TorstEngine.startTorrentPlayback({
      files: [{ length: 1000, name: 'movie.mkv', path: 'movie.mkv' }],
      hash: testHash,
      name: 'My Saved Torrent',
      retention: 'temporary' as const, storage: 'memory',
      total_size: 1000,
    });

    assert.ok(playedItem, 'playback must complete despite Modal.close() throwing');
  });

  it('propagates timeline, season, and episode to player item and all playlist entries', async () => {
    let playedItem: any = null;
    let playlistItems: any[] = [];
    let listenerEvent: any = null;
    const testHash = '0123456789abcdef0123456789abcdef01234567';

    (globalThis as any).Lampa.Favorite = {
      add: () => {},
    };
    (globalThis as any).Lampa.Listener = {
      send: (type: string, data: any) => {
        if (type === 'torrent_file') listenerEvent = data;
      },
    };
    (globalThis as any).Lampa.Loading = {
      setProgress: () => {},
      start: () => {},
      stop: () => {},
    };
    (globalThis as any).Lampa.Player = {
      callback: () => {},
      play: (item: any) => {
        playedItem = item;
      },
      playlist: (items: any[]) => {
        playlistItems = items;
      },
    };
    (globalThis as any).Lampa.Timeline = {
      render: () => {},
      view: (hash: any) => ({
        duration: 3600,
        handler: () => {},
        hash,
        percent: 25,
        time: 900,
      }),
    };

    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/torrents')) {
        return new Response(JSON.stringify({
          files: [
            { length: 5000, name: 'Show.S01E01.mkv', path: 'Show.S01E01.mkv' },
            { length: 5000, name: 'Show.S01E02.mkv', path: 'Show.S01E02.mkv' },
          ],
          hash: testHash,
          name: 'Show',
          retention: 'temporary' as const, storage: 'memory',
          total_size: 10000,
        }), {
          headers: { 'Content-Type': 'application/json' },
          status: 201,
        });
      }
      return new Response(null, { status: 200 });
    };

    const tvContext = {
      id: 500,
      number_of_seasons: 2,
      original_name: 'Test Show',
      original_title: 'Test Show',
      title: 'Test Show',
    };

    await TorstEngine.startTorrentPlayback(
      {
        files: [
          { length: 5000, name: 'Show.S01E01.mkv', path: 'Show.S01E01.mkv' },
          { length: 5000, name: 'Show.S01E02.mkv', path: 'Show.S01E02.mkv' },
        ],
        hash: testHash,
        name: 'Show',
        retention: 'temporary' as const, storage: 'memory',
        total_size: 10000,
      },
      0,
      tvContext
    );

    // First episode in player
    assert.ok(playedItem);
    assert.equal(playedItem.season, 1);
    assert.equal(playedItem.episode, 1);
    assert.ok(playedItem.timeline);
    assert.equal(
      playedItem.timeline.hash,
      (globalThis as any).Lampa.Utils.hash('11Test Show')
    );

    // Emitted event carries season and episode for WatchedHistory
    assert.ok(listenerEvent);
    assert.equal(listenerEvent.element.season, 1);
    assert.equal(listenerEvent.element.episode, 1);

    // Entire playlist has timeline and episode metadata attached
    assert.equal(playlistItems.length, 2);
    assert.equal(playlistItems[0].season, 1);
    assert.equal(playlistItems[0].episode, 1);
    assert.equal(
      playlistItems[0].timeline.hash,
      (globalThis as any).Lampa.Utils.hash('11Test Show')
    );

    assert.equal(playlistItems[1].season, 1);
    assert.equal(playlistItems[1].episode, 2);
    assert.equal(
      playlistItems[1].timeline.hash,
      (globalThis as any).Lampa.Utils.hash('12Test Show')
    );
  });
  it('selects the player item by matching torrent file_index rather than array position when they diverge', async () => {
    let playedItem: any = null;
    const testHash = '0123456789abcdef0123456789abcdef01234567';

    (globalThis as any).Lampa.Favorite = { add: () => {} };
    (globalThis as any).Lampa.Loading = { setProgress: () => {}, start: () => {}, stop: () => {} };
    (globalThis as any).Lampa.Player = {
      callback: () => {},
      play: (item: any) => {
        playedItem = item;
      },
      playlist: () => {},
    };

    // A leading non-video file shifts every video file's real torrent file_index
    // one past its position in the video-only playlist array.
    const torrentFiles = [
      { length: 10, name: 'readme.txt', path: 'readme.txt' },
      { length: 5000, name: 'Show.S01E01.mkv', path: 'Show.S01E01.mkv' },
      { length: 5000, name: 'Show.S01E02.mkv', path: 'Show.S01E02.mkv' },
    ];

    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/torrents')) {
        return new Response(JSON.stringify({
          files: torrentFiles,
          hash: testHash,
          name: 'Show',
          retention: 'temporary' as const, storage: 'memory',
          total_size: 10010,
        }), {
          headers: { 'Content-Type': 'application/json' },
          status: 201,
        });
      }
      return new Response(null, { status: 200 });
    };

    // Playlist position 0 (first video file) has real file_index 1, not 0.
    await TorstEngine.startTorrentPlayback(
      { files: torrentFiles, hash: testHash, name: 'Show', retention: 'temporary' as const, storage: 'memory', total_size: 10010 },
      0
    );

    assert.ok(playedItem);
    assert.equal(playedItem.fname, 'Show.S01E01.mkv');
    assert.equal(typeof playedItem.url, 'string');
  });

  it('does not hand non-video torrent files to the player', async () => {
    let playCount = 0;
    const sourceInstance = {
      authType: 'none' as const,
      id: 'database-instance',
      name: 'Database Instance',
      url: 'http://database.example.com',
    };

    (globalThis as any).Lampa.Player = {
      callback: () => {},
      play: () => { playCount++; },
      playlist: () => {},
    };

    const isHandedOff = await TorstEngine.startTorrentPlayback(
      {
        files: [
          { length: 100, name: 'readme.txt', path: 'readme.txt' },
          { length: 200, name: 'subtitle.srt', path: 'subtitle.srt' },
        ],
        hash: 'non-video-torrent',
        name: 'Non-video Torrent',
        retention: 'temporary' as const, storage: 'memory',
        total_size: 300,
      },
      0,
      undefined,
      sourceInstance
    );

    assert.equal(isHandedOff, false);
    assert.equal(playCount, 0);
    assert.equal(lastNoty, getTestTranslation('torst_noty_no_video'));
  });

  it('routes Lampa.Torrent.start and open directly to Torst startPlayback', () => {
    let startedPlaybackItem: any = null;
    let startedPlaybackMovie: any = null;
    const origStartPlayback = TorstEngine.startPlayback;
    TorstEngine.startPlayback = async (item: any, movie?: any) => {
      startedPlaybackItem = item;
      startedPlaybackMovie = movie;
    };

    try {
      TorstEngine.init();

      // start() forwards directly to Torst startPlayback
      (globalThis as any).Lampa.Torrent.start({ info_hash: '1111111111111111111111111111111111111111', Title: 'Fresh Torrent' }, { id: 10 });
      assert.ok(startedPlaybackItem);
      assert.equal((startedPlaybackItem as any).Title, 'Fresh Torrent');
      assert.equal((startedPlaybackMovie as any).id, 10);

      // open() forwards directly to Torst startPlayback
      startedPlaybackItem = null;
      (globalThis as any).Lampa.Torrent.open('2222222222222222222222222222222222222222', { id: 20 });
      assert.ok(startedPlaybackItem);
      assert.equal((startedPlaybackItem as any).hash, '2222222222222222222222222222222222222222');
      assert.equal((startedPlaybackMovie as any).id, 20);
    } finally {
      TorstEngine.startPlayback = origStartPlayback;
      TorstEngine.resetForTesting();
    }
  });
});

describe('Torst playback orchestration', () => {
  const hash = 'a'.repeat(40);
  const instance: TorstInstance = { authType: 'none', id: 'main', name: 'Main', url: 'http://main.test:8080' };
  const torrent: Torrent = {
    files: [{ fileId: 'fil_test', length: 1024, name: 'Sintel.mkv', path: 'Sintel.mkv' }],
    hash,
    id: 'trr_test',
    name: 'Sintel',
    retention: 'persisted' as const,
    storage: 'memory',
    total_size: 1024,
  };
  let storage: Map<string, unknown>;
  let played: any;
  let playlist: any[];
  let isLoading: boolean;
  let cancel: () => void;
  let notices: string[];

  beforeEach(() => {
    storage = new Map();
    played = undefined;
    playlist = [];
    isLoading = false;
    cancel = () => {};
    notices = [];
    (globalThis as any).Lampa = {
      Activity: { active: () => null, all: () => [] },
      Controller: { enabled: () => ({ name: 'content' }), toggle: () => {} },
      Lang: createTestLanguage(),
      Loading: {
        start: (onCancel: () => void) => { isLoading = true; cancel = onCancel; },
        stop: () => { isLoading = false; },
      },
      Noty: { show: (message: string) => notices.push(message) },
      Player: {
        callback: () => {},
        play: (item: any) => { played = item; },
        playlist: (items: any[]) => { playlist = items; },
      },
      Storage: {
        field: (key: string) => storage.get(key),
        get: (key: string, fallback: unknown) => storage.get(key) ?? fallback,
        set: (key: string, value: unknown) => storage.set(key, value),
      },
      Utils: { bytesToSize: (bytes: number) => `${bytes} B`, clearHtmlTags: (value: string) => value, hash: (value: string) => value },
    };
    mock.method(InstanceManager, 'getBestInstance', async () => instance);
    mock.method(InstanceManager, 'failover', async () => null);
    mock.method(TorstApi, 'getStreamUrl', async () => `${instance.url}/api/v1/torrents/trr_test/files/fil_test/content`);
    mock.method(PreloadModal, 'waitUntilReady', async () => {
      assert.equal(isLoading, false, 'the metadata loading screen must be stopped before buffering');
      return true;
    });
  });
  afterEach(() => { mock.restoreAll(); });

  it('saves a magnet with title and poster through the Torst client', async () => {
    const add = mock.method(TorstApi, 'addTorrent', async (_instance: TorstInstance, request: TorrentAdd) => {
      assert.equal(request.hash, hash);
      assert.equal(request.title, 'Sintel');
      assert.equal(request.poster, 'https://images.test/sintel.jpg');
      return torrent;
    });
    await TorstEngine.saveToDatabase({ MagnetUri: `magnet:?xt=urn:btih:${hash}`, poster: 'https://images.test/sintel.jpg', Title: 'Sintel' });
    assert.equal(add.mock.callCount(), 1);
    assert.equal(played, undefined);
    assert.equal(notices[0], getTestTranslation('torst_noty_added_db', { title: 'Sintel' }));
  });

  it('plays a persistent magnet after creation and preserves playlist item identity', async () => {
    storage.set(SAVE_TO_DATABASE_STORAGE_KEY, 'true');
    storage.set('torst_storage_type', 'file');
    const add = mock.method(TorstApi, 'addTorrent', async (_instance: TorstInstance, request: TorrentAdd) => {
      assert.equal(request.storage, 'file');
      return torrent;
    });
    await TorstEngine.startPlayback({ MagnetUri: `magnet:?xt=urn:btih:${hash}`, Title: 'Sintel' });
    assert.equal(add.mock.callCount(), 1);
    assert.ok(playlist.includes(played));
    assert.equal(played.continue_play, true);
    assert.equal(played.torrent, true);
    assert.doesNotThrow(() => JSON.stringify(played));
  });

  it('uploads persistent torrent links once and passes storage and title', async () => {
    storage.set(SAVE_TO_DATABASE_STORAGE_KEY, 'true');
    storage.set('torst_storage_type', 'file');
    const upload = mock.method(TorstApi, 'resolveTorrent', async (_instance: TorstInstance, url: string, options?: TorrentAdd) => {
      assert.equal(url, 'https://indexer.test/sintel.torrent');
      assert.equal(options?.storage, 'file');
      assert.equal(options?.title, 'Sintel');
      return torrent;
    });
    const add = mock.method(TorstApi, 'addTorrent', async () => { throw new Error('Already uploaded'); });
    await TorstEngine.startPlayback({ Link: 'https://indexer.test/sintel.torrent', Title: 'Sintel' });
    assert.equal(upload.mock.callCount(), 1);
    assert.equal(add.mock.callCount(), 0);
    assert.ok(played);
  });

  it('creates a temporary magnet in memory without marking it as saved', async () => {
    storage.set(SAVE_TO_DATABASE_STORAGE_KEY, 'false');
    storage.set('torst_storage_type', 'file');
    const add = mock.method(TorstApi, 'addTorrent', async (_instance: TorstInstance, request: TorrentAdd) => {
      assert.equal(request.retention, 'temporary');
      assert.equal(request.storage, 'memory');
      return { ...torrent, retention: 'temporary' as const };
    });
    await TorstEngine.startPlayback({ MagnetUri: `magnet:?xt=urn:btih:${hash}` });
    assert.equal(add.mock.callCount(), 1);
    assert.ok(played);
  });

  it('uploads temporary torrent files with temporary retention and memory storage', async () => {
    storage.set(SAVE_TO_DATABASE_STORAGE_KEY, 'false');
    const upload = mock.method(TorstApi, 'resolveTorrent', async (_instance: TorstInstance, url: string, request?: TorrentAdd) => {
      assert.equal(url, 'https://indexer.test/sintel.torrent');
      assert.equal(request?.retention, 'temporary');
      assert.equal(request?.storage, 'memory');
      return { ...torrent, retention: 'temporary' as const };
    });
    await TorstEngine.startPlayback({ Link: 'https://indexer.test/sintel.torrent' });
    assert.equal(upload.mock.callCount(), 1);
    assert.ok(played);
  });

  it('stops playback if canceled while creation is in flight', async () => {
    storage.set(SAVE_TO_DATABASE_STORAGE_KEY, 'true');
    mock.method(TorstApi, 'addTorrent', async () => { cancel(); return torrent; });
    await TorstEngine.startPlayback({ MagnetUri: `magnet:?xt=urn:btih:${hash}` });
    assert.equal(played, undefined);
    assert.equal(isLoading, false);
  });

  it('reads the separate file list when created torrent metadata is still arriving', async () => {
    storage.set(SAVE_TO_DATABASE_STORAGE_KEY, 'true');
    mock.method(TorstApi, 'addTorrent', async () => ({ ...torrent, files: [] }));
    const read = mock.method(TorstApi, 'getTorrent', async () => torrent);
    await TorstEngine.startPlayback({ MagnetUri: `magnet:?xt=urn:btih:${hash}` });
    assert.equal(read.mock.callCount(), 1);
    assert.ok(played);
  });

  for (const settings of [
    { expectedFraction: 0.4, mode: 'continue', timeline: { duration: 1500, percent: 40, time: 600 } },
    { expectedFraction: 0.4, mode: 'continue', timeline: { duration: 1500, time: 600 } },
    { expectedFraction: undefined, mode: 'ask', timeline: { duration: 1500, percent: 40, time: 600 } },
    { expectedFraction: undefined, mode: 'continue', timeline: { duration: 1500, percent: 95, time: 1425 } },
    { expectedFraction: undefined, mode: 'continue', timeline: { duration: 1500, percent: 1, time: 8 } },
  ]) {
    it(`passes the saved resume fraction to buffering (${settings.mode}, ${settings.timeline.time} seconds)`, async () => {
      storage.set(SAVE_TO_DATABASE_STORAGE_KEY, 'true');
      storage.set('player_timecode', settings.mode);
      (globalThis as any).Lampa.Timeline = { view: () => settings.timeline };
      mock.method(TorstApi, 'addTorrent', async () => torrent);
      const preload = mock.method(PreloadModal, 'waitUntilReady', async () => true);
      await TorstEngine.startPlayback({ MagnetUri: `magnet:?xt=urn:btih:${hash}` });
      assert.equal(preload.mock.calls[0].arguments[4], settings.expectedFraction);
      assert.ok(played);
    });
  }

  for (const status of [400, 401, 403, 404, 409, 422]) {
    it(`does not fail over on an ordinary creation rejection (${status})`, async () => {
      storage.set(SAVE_TO_DATABASE_STORAGE_KEY, 'true');
      const error = new TorstApiError('Rejected', status);
      mock.method(TorstApi, 'addTorrent', async () => { throw error; });
      const failover = mock.method(InstanceManager, 'failover', async () => null);
      await assert.rejects(TorstEngine.startPlayback({ MagnetUri: `magnet:?xt=urn:btih:${hash}` }), failure => failure === error);
      assert.equal(failover.mock.callCount(), 0);
      assert.equal(isLoading, false);
    });
  }

  it('stops metadata polling when the viewer cancels', async () => {
    mock.method(TorstApi, 'addTorrent', async () => ({ ...torrent, files: [] }));
    const read = mock.method(TorstApi, 'getTorrent', async () => {
      cancel();
      return { ...torrent, files: [] };
    });
    await TorstEngine.startPlayback({ MagnetUri: `magnet:?xt=urn:btih:${hash}` });
    assert.equal(read.mock.callCount(), 1);
    assert.equal(played, undefined);
    assert.equal(isLoading, false);
  });

  for (const error of [new TorstApiError('Torrent failed', 422), new AuthenticationError('Password required')]) {
    it(`stops metadata polling on a permanent error (${error.message})`, async () => {
      mock.method(TorstApi, 'addTorrent', async () => ({ ...torrent, files: [] }));
      const read = mock.method(TorstApi, 'getTorrent', async () => { throw error; });
      await assert.rejects(TorstEngine.startPlayback({ MagnetUri: `magnet:?xt=urn:btih:${hash}` }), failure => failure === error);
      assert.equal(read.mock.callCount(), 1);
      assert.equal(isLoading, false);
    });
  }

  it('retries transient errors while metadata takes more than thirty seconds', async () => {
    mock.method(TorstApi, 'addTorrent', async () => ({ ...torrent, files: [] }));
    let calls = 0;
    mock.method(TorstApi, 'getTorrent', async () => {
      if (++calls === 1) throw new TorstApiError('Unavailable', 503);
      return calls > 31 ? torrent : { ...torrent, files: [] };
    });
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const playback = TorstEngine.startPlayback({ MagnetUri: `magnet:?xt=urn:btih:${hash}` });
      await new Promise(resolve => setImmediate(resolve));
      for (let index = 0; index < 31; index++) {
        mock.timers.tick(1000);
        await new Promise(resolve => setImmediate(resolve));
      }
      await playback;
      assert.equal(calls, 32);
      assert.ok(played);
    } finally {
      mock.timers.reset();
    }
  });

  it('stops waiting when torrent metadata never becomes available', async () => {
    mock.method(TorstApi, 'addTorrent', async () => ({ ...torrent, files: [] }));
    const read = mock.method(TorstApi, 'getTorrent', async () => ({ ...torrent, files: [] }));
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const playback = TorstEngine.startPlayback({ MagnetUri: `magnet:?xt=urn:btih:${hash}` });
      const rejection = assert.rejects(playback, /Timed out waiting for torrent metadata/);
      await new Promise(resolve => setImmediate(resolve));
      for (let index = 0; index < 120; index++) {
        mock.timers.tick(1000);
        await new Promise(resolve => setImmediate(resolve));
      }
      await rejection;
      assert.equal(read.mock.callCount(), 120);
      assert.equal(played, undefined);
      assert.equal(isLoading, false);
    } finally {
      mock.timers.reset();
    }
  });

  it('retries a persistent import on the selected fallback instance', async () => {
    const fallback = { ...instance, id: 'backup', url: 'http://backup.test' };
    mock.method(InstanceManager, 'failover', async () => fallback);
    const upload = mock.method(TorstApi, 'resolveTorrent', async (target: TorstInstance) => {
      if (target.id === instance.id) throw new NetworkError('Unavailable');
      return torrent;
    });
    await TorstEngine.saveToDatabase({ Link: 'https://indexer.test/sintel.torrent' });
    assert.deepEqual(upload.mock.calls.map(call => call.arguments[0]), [instance, fallback]);
    assert.equal(notices[0], getTestTranslation('torst_noty_added_db', { title: 'Torrent' }));
  });
});
