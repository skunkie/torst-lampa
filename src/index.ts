// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import { initPlayerPlaylist } from './engine/player-playlist';
import { SavedTorrents } from './engine/saved-torrents';
import { TorstEngine } from './engine/torst-engine';
import { InstanceManager } from './instances/instance-manager';
import { initTranslations, translate } from './lang/translations';
import { ParserHook } from './providers/parser-hook';
import { ProviderManager } from './providers/provider-manager';
import { CatalogChoice } from './ui/catalog-choice';
import { DatabaseSearch } from './ui/database-search';
import { ProfileHeaderUi } from './ui/profile-header';
import { SettingsUi } from './ui/settings';
import { SidebarManager } from './ui/sidebar';
import { PLUGIN_BUILD_COMMIT, PLUGIN_BUILD_DATE, PLUGIN_VERSION } from './version';

export { PLUGIN_BUILD_COMMIT, PLUGIN_BUILD_DATE, PLUGIN_VERSION };

function initPlugin(): void {
  if (window.plugin_torst_ready) return;

  try {
    initTranslations();
    InstanceManager.init();
    SavedTorrents.init();
    ProviderManager.init();
    SettingsUi.init();
    SidebarManager.init();
    CatalogChoice.init();
    TorstEngine.init();
    initPlayerPlaylist();
    ParserHook.init();
    DatabaseSearch.init();
    ProfileHeaderUi.init();

    if (Lampa.Manifest) {
      Lampa.Manifest.plugins = {
        description: translate('torst_desc', 'Torst client for torrent streaming'),
        name: 'Torst',
        type: 'video',
        version: PLUGIN_VERSION,
      };
    }

    window.plugin_torst_ready = true;
    console.log(`[Torst] Plugin v${PLUGIN_VERSION} initialized successfully`);
  } catch (error) {
    console.error('[Torst] Failed to initialize plugin:', error);
  }
}

if (typeof window !== 'undefined') {
  if (window.appready) {
    initPlugin();
  } else if (typeof Lampa !== 'undefined' && Lampa.Listener) {
    Lampa.Listener.follow('app', (event: { type: string }) => {
      if (event.type === 'ready') {
        initPlugin();
      }
    });
  } else {
    // Fallback timer for environments where Lampa loads asynchronously
    const checkTimer = setInterval(() => {
      if (typeof Lampa !== 'undefined' && (window.appready || Lampa.Storage)) {
        clearInterval(checkTimer);
        initPlugin();
      }
    }, 200);
  }
}
