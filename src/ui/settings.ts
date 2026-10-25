// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import { DATABASE_SEARCH_ENABLED_STORAGE_KEY } from '../engine/database-search';
import { InstanceManager, SelectionMode } from '../instances/instance-manager';
import { translate } from '../lang/translations';
import { ParserHook } from '../providers/parser-hook';
import { STORAGE_KEY_PROVIDERS } from '../providers/provider-manager';
import type { TorrentProvider } from '../types/provider';
import type { TorstInstance } from '../types/torst';
import { AboutUi } from './about';
import { InstancePoolUi } from './instance-pool';
import { SAVE_TO_DATABASE_STORAGE_KEY, STORAGE_TYPE_STORAGE_KEY } from './play-dialog';
import { ProviderSettingsUi } from './provider-settings';
import { TORST_ENABLED_STORAGE_KEY } from './settings-keys';

export const PLAYBACK_MODE_STORAGE_KEY = 'torst_playback_mode';
export { TORST_ENABLED_STORAGE_KEY };
export const TORST_SETTINGS_COMPONENT_ID = 'torst_settings';

export const TORST_ICON = `
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="2.25" y="2.25" width="5.5" height="5.5" rx="1.25" fill="white"/>
  <rect x="9.25" y="2.25" width="5.5" height="5.5" rx="1.25" fill="white"/>
  <rect x="16.25" y="2.25" width="5.5" height="5.5" rx="1.25" fill="white"/>
  <rect x="2.25" y="9.25" width="5.5" height="5.5" rx="1.25" stroke="white" stroke-width="1.1"/>
  <rect x="9.25" y="9.25" width="5.5" height="5.5" rx="1.25" fill="white"/>
  <rect x="16.25" y="9.25" width="5.5" height="5.5" rx="1.25" stroke="white" stroke-width="1.1"/>
  <rect x="2.25" y="16.25" width="5.5" height="5.5" rx="1.25" stroke="white" stroke-width="1.1"/>
  <rect x="9.25" y="16.25" width="5.5" height="5.5" rx="1.25" fill="white"/>
  <rect x="16.25" y="16.25" width="5.5" height="5.5" rx="1.25" stroke="white" stroke-width="1.1"/>
</svg>
`;

const ICON_ATTRS = 'width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;flex-shrink:0;width:1em !important;min-width:1em !important;max-width:1em !important;height:1em !important;vertical-align:middle"';

export const ICON_ARROW_LEFT = `<svg ${ICON_ATTRS}><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>`;
export const ICON_DOWNLOAD   = `<svg ${ICON_ATTRS}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`;
export const ICON_KEY        = `<svg ${ICON_ATTRS}><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>`;
export const ICON_LOCK       = `<svg ${ICON_ATTRS}><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
export const ICON_PENCIL     = `<svg ${ICON_ATTRS}><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`;
export const ICON_PLUS       = `<svg ${ICON_ATTRS}><path d="M5 12h14"/><path d="M12 5v14"/></svg>`;
export const ICON_SEARCH     = `<svg ${ICON_ATTRS}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;
export const ICON_STAR       = `<svg ${ICON_ATTRS}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
export const ICON_TRASH      = `<svg ${ICON_ATTRS}><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`;
export const ICON_ZAP        = `<svg ${ICON_ATTRS}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;

export function iconLabel(icon: string, label: string): string {
  return `<span style="display:inline-flex;gap:0.5em;align-items:center">${icon}${label}</span>`;
}

export function describeConnectionStatus(target: Pick<TorrentProvider, 'latencyMs' | 'status'> | Pick<TorstInstance, 'latencyMs' | 'status'>): string {
  if (target.status === 'online' && target.latencyMs !== undefined && target.latencyMs < Infinity) {
    return translate('torst_latency_ms', `${target.latencyMs} ms`, { latency: target.latencyMs });
  }
  if (target.status === 'offline') return translate('torst_status_offline', 'Offline');
  if (target.status === 'checking') return translate('torst_status_checking', 'Checking...');
  return translate('torst_status_unknown', 'Unknown');
}

export class SettingsUi {
  public static init(): void {
    if (!Lampa.SettingsApi) return;

    Lampa.SettingsApi.addComponent({
      // 'tmdb' is never conditionally removed, unlike 'parser'/'server' (dropped
      // when torrents_use is disabled) — anchoring to a removed component id is a no-op.
      before: 'tmdb',
      component: TORST_SETTINGS_COMPONENT_ID,
      icon: TORST_ICON,
      name: translate('torst_settings_name', 'Torst'),
    });

    Lampa.SettingsApi.addParam({
      component: TORST_SETTINGS_COMPONENT_ID,
      field: {
        description: translate('torst_enabled_descr', 'Torrent playback and search via Torst'),
        name: translate('torst_enabled_name', 'Enable Torst'),
      },
      onChange: () => {
        this.updateTorrServerVisibility();
      },
      param: {
        default: true,
        name: TORST_ENABLED_STORAGE_KEY,
        type: 'trigger',
      },
    });

    Lampa.SettingsApi.addParam({
      component: TORST_SETTINGS_COMPONENT_ID,
      field: {
        description: translate(
          'torst_database_search_descr',
          'Show saved torrents in Lampa global search'
        ),
        name: translate('torst_database_search_name', 'Torst Database in Global Search'),
      },
      param: {
        default: false,
        name: DATABASE_SEARCH_ENABLED_STORAGE_KEY,
        type: 'trigger',
      },
    });

    Lampa.SettingsApi.addParam({
      component: TORST_SETTINGS_COMPONENT_ID,
      field: {
        description: translate(
          'torst_selection_mode_descr',
          'Lowest latency or a manually chosen instance'
        ),
        name: translate('torst_selection_mode_name', 'Instance Selection'),
      },
      onChange: (selectionMode: string) => {
        InstanceManager.setMode(selectionMode as SelectionMode);
        if (selectionMode === 'manual') {
          InstancePoolUi.promptSelectActiveInstance();
        }
      },
      param: {
        default: 'auto',
        name: 'torst_selection_mode',
        type: 'select',
        values: {
          auto: translate('torst_selection_mode_auto', 'Auto (Lowest Latency)'),
          manual: translate('torst_selection_mode_manual', 'Manual Selection'),
        },
      },
    });

    Lampa.SettingsApi.addParam({
      component: TORST_SETTINGS_COMPONENT_ID,
      field: {
        description: translate(
          'torst_manage_pool_descr',
          'Instances, authentication, and latency checks'
        ),
        name: translate('torst_manage_pool_name', 'Manage Instance Pool'),
      },
      onChange: () => {
        InstancePoolUi.openPoolManager();
      },
      param: {
        name: 'torst_instances_btn',
        type: 'button',
      },
    });

    Lampa.SettingsApi.addParam({
      component: TORST_SETTINGS_COMPONENT_ID,
      field: {
        description: translate(
          'torst_manage_providers_descr',
          'Configure Jackett and Prowlarr providers'
        ),
        name: translate('torst_manage_providers_name', 'Manage Search Providers'),
      },
      onChange: () => {
        ProviderSettingsUi.openPoolManager();
      },
      param: {
        name: 'torst_providers_btn',
        type: 'button',
      },
    });

    Lampa.SettingsApi.addParam({
      component: TORST_SETTINGS_COMPONENT_ID,
      field: {
        description: translate('torst_playback_mode_descr', 'Torst or TorrServer when a torrent starts'),
        name: translate('torst_playback_mode_name', 'Torrent Playback'),
      },
      onChange: () => {
        this.updateTorrServerVisibility();
      },
      param: {
        default: 'torst',
        name: PLAYBACK_MODE_STORAGE_KEY,
        type: 'select',
        /* eslint-disable perfectionist/sort-objects -- Lampa lists select options in insertion order */
        values: {
          torst: translate('torst_playback_mode_torst', 'Always Torst'),
          context: translate('torst_playback_mode_context', 'Manual (Context Menu & Button)'),
          ask: translate('torst_playback_mode_ask', 'Ask Before Play (Torst / TorrServer)'),
        },
        /* eslint-enable perfectionist/sort-objects */
      },
    });

    Lampa.SettingsApi.addParam({
      component: TORST_SETTINGS_COMPONENT_ID,
      field: {
        description: translate('torst_storage_type_descr', 'Where to keep the torrent during playback'),
        name: translate('torst_storage_type_name', 'Storage Type'),
      },
      param: {
        default: 'memory',
        name: STORAGE_TYPE_STORAGE_KEY,
        type: 'select',
        values: {
          ask: translate('torst_storage_type_ask', 'Ask Before Play'),
          file: translate('torst_storage_type_disk', 'Disk'),
          memory: translate('torst_storage_type_ram', 'RAM'),
        },
      },
    });

    Lampa.SettingsApi.addParam({
      component: TORST_SETTINGS_COMPONENT_ID,
      field: {
        description: translate('torst_save_to_db_descr', 'Save torrents to the Torst database'),
        name: translate('torst_save_to_db_name', 'Save to Database'),
      },
      param: {
        default: 'false',
        name: SAVE_TO_DATABASE_STORAGE_KEY,
        type: 'select',
        values: {
          ask: translate('torst_save_to_db_ask', 'Ask Before Play'),
          false: translate('torst_save_to_db_false', 'Never'),
          true: translate('torst_save_to_db_true', 'Always'),
        },
      },
    });

    Lampa.SettingsApi.addParam({
      component: TORST_SETTINGS_COMPONENT_ID,
      field: {
        description: translate('torst_about_descr', 'Plugin version and build info'),
        name: translate('torst_about_name', 'About Plugin'),
      },
      onChange: () => {
        AboutUi.show();
      },
      param: {
        name: 'torst_about_btn',
        type: 'button',
      },
    });

    this.updateTorrServerVisibility();

    if (typeof Lampa !== 'undefined' && Lampa.Storage?.listener) {
      Lampa.Storage.listener.follow('change', (event: LampaStorageChangeEvent) => {
        if (
          event.name === PLAYBACK_MODE_STORAGE_KEY
          || event.name === STORAGE_KEY_PROVIDERS
          || event.name === TORST_ENABLED_STORAGE_KEY
        ) {
          this.updateTorrServerVisibility();
        }
      });
    }
  }

  public static updateTorrServerVisibility(): void {
    if (typeof Lampa === 'undefined' || !Lampa.Storage) return;
    const isEnabled = Lampa.Storage.get<boolean>(TORST_ENABLED_STORAGE_KEY, true);
    const playbackMode = Lampa.Storage.get<string>(PLAYBACK_MODE_STORAGE_KEY, 'torst');
    const isAlwaysTorst = isEnabled && playbackMode === 'torst';
    const shouldHideNativeParser = ParserHook.isReplacingNativeParser();

    if (typeof document !== 'undefined') {
      const styleId = 'torst-hide-torrserver-style';
      if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
          body.torst--hide-torrserver .settings-folder[data-component="server"],
          body.torst--hide-torrserver .settings-folder[data-component="parser"],
          body.torst--hide-torrserver .menu__item[data-action="mytorrents"],
          body.torst--hide-torrserver .menu__item[data-action="torrents"],
          body.torst--hide-torrserver [data-action="mytorrents"],
          body.torst--hide-torrserver [data-action="torrents"],
          body.torst--hide-torrserver .full-start__button.view--torrent,
          body.torst--hide-torrserver .view--torrent {
            display: none !important;
          }
          body.torst--hide-native-parser .settings-folder[data-component="parser"] {
            display: none !important;
          }
        `;
        if (document.head) {
          document.head.appendChild(style);
        }
      }
      const jquery = (globalThis as typeof globalThis & { $?: LampaJQuery }).$
        || (typeof window !== 'undefined' ? window.$ : undefined);
      const targetSelector = '[data-action="mytorrents"], [data-action="torrents"], .settings-folder[data-component="server"], .settings-folder[data-component="parser"], .view--torrent';
      if (typeof jquery !== 'undefined' && typeof jquery('body').toggleClass === 'function') {
        jquery('body').toggleClass('torst--hide-torrserver', isAlwaysTorst);
        jquery('body').toggleClass('torst--hide-native-parser', shouldHideNativeParser);
        const nativeElements = jquery(targetSelector);
        if (nativeElements && typeof nativeElements.toggleClass === 'function') {
          nativeElements.toggleClass('hide', isAlwaysTorst);
          nativeElements.toggleClass('selector', !isAlwaysTorst);
        }
      } else if (document.body) {
        document.body.classList.toggle('torst--hide-torrserver', isAlwaysTorst);
        document.body.classList.toggle('torst--hide-native-parser', shouldHideNativeParser);
        if (typeof document.querySelectorAll === 'function') {
          const nativeElements = document.querySelectorAll(targetSelector);
          nativeElements.forEach(element => {
            if (element && element.classList) {
              element.classList.toggle('hide', isAlwaysTorst);
              element.classList.toggle('selector', !isAlwaysTorst);
            }
          });
        }
      }
    }
  }
}
