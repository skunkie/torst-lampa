// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import { translate } from '../lang/translations';
import { ParserHook } from '../providers/parser-hook';
import { PROVIDER_SEARCH_ENABLED_STORAGE_KEY, ProviderManager } from '../providers/provider-manager';
import { ProviderType, TorrentProvider } from '../types/provider';
import { readTriggerSetting, writeTriggerSetting } from '../utils/trigger-setting';
import { generateUuid } from '../utils/uuid';
import {
  describeConnectionStatus,
  ICON_ARROW_LEFT,
  ICON_DOWNLOAD,
  ICON_KEY,
  ICON_PENCIL,
  ICON_PLUS,
  ICON_SEARCH,
  ICON_TRASH,
  ICON_ZAP,
  iconLabel,
} from './settings';

function normalizeProviderUrl(value: string): string | null {
  let cleanUrl = value.trim().replace(/\/+$/, '');
  if (!cleanUrl) return null;
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//i.test(cleanUrl)) {
    cleanUrl = `http://${cleanUrl}`;
  }
  try {
    const parsed = new URL(cleanUrl);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
      return null;
    }
    return cleanUrl;
  } catch {
    return null;
  }
}

export class ProviderSettingsUi {
  public static openPoolManager(): void {
    if (typeof Lampa === 'undefined' || !Lampa.Select) return;

    const providers = ProviderManager.getProviders();

    const menuItems: Array<LampaSelectItem<TorrentProvider>> = [
      {
        action: 'add',
        subtitle: translate('torst_provider_add_descr', 'Add a Jackett or Prowlarr provider'),
        title: iconLabel(ICON_PLUS, translate('torst_provider_add', 'Add Provider')),
      },
      {
        action: 'ping_all',
        subtitle: translate('torst_provider_test_all_descr', 'Test latency across all providers'),
        title: iconLabel(ICON_ZAP, translate('torst_provider_test_all', 'Test All Providers')),
      },
    ];

    if (ParserHook.isProviderSearchToggleAvailable()) {
      const stateTag = readTriggerSetting(PROVIDER_SEARCH_ENABLED_STORAGE_KEY)
        ? translate('torst_status_enabled', 'Enabled')
        : translate('torst_status_disabled', 'Disabled');
      menuItems.push({
        action: 'toggle_global_search',
        subtitle: `${translate('torst_provider_search_descr', 'Results in a separate tab')} · ${stateTag}`,
        title: iconLabel(ICON_SEARCH, translate('torst_provider_search_name', 'Show in Global Search')),
      });
    }

    providers.forEach(provider => {
      const statusDescription = describeConnectionStatus(provider);
      const enabledTag = provider.isEnabled
        ? translate('torst_status_enabled', 'Enabled')
        : translate('torst_status_disabled', 'Disabled');

      menuItems.push({
        action: 'provider',
        data: provider,
        selected: provider.isEnabled,
        subtitle: `${provider.url} · ${statusDescription} · ${enabledTag}`,
        title: `[${provider.type === 'prowlarr' ? 'Prowlarr' : 'Jackett'}] ${provider.name}`,
      });
    });

    menuItems.push({
      action: 'back',
      subtitle: translate('torst_back_to_settings', 'Return to Torst settings'),
      title: iconLabel(ICON_ARROW_LEFT, translate('torst_back', 'Back')),
    });

    Lampa.Select.show({
      items: menuItems,
      onBack: () => {
        if (typeof Lampa !== 'undefined' && Lampa.Controller) {
          Lampa.Controller.toggle('settings_component');
        }
      },
      onSelect: (selectedItem: LampaSelectItem<TorrentProvider>) => {
        if (selectedItem.action === 'back') {
          if (typeof Lampa !== 'undefined' && Lampa.Controller) {
            Lampa.Controller.toggle('settings_component');
          }
        } else if (selectedItem.action === 'add') {
          this.promptAddProvider();
        } else if (selectedItem.action === 'toggle_global_search') {
          writeTriggerSetting(
            PROVIDER_SEARCH_ENABLED_STORAGE_KEY,
            !readTriggerSetting(PROVIDER_SEARCH_ENABLED_STORAGE_KEY)
          );
          this.openPoolManager();
        } else if (selectedItem.action === 'ping_all') {
          if (Lampa.Noty) Lampa.Noty.show(translate('torst_provider_noty_pinging_all', 'Testing all search providers...'));
          ProviderManager.pingAll().then(() => {
            this.openPoolManager();
          });
        } else if (selectedItem.action === 'provider' && selectedItem.data) {
          this.openProviderActions(selectedItem.data);
        }
      },
      title: translate('torst_provider_pool_title', 'Torrent Search Providers'),
    });
  }

  public static openProviderActions(provider: TorrentProvider): void {
    if (typeof Lampa === 'undefined' || !Lampa.Select) return;

    const menuItems: LampaSelectItem[] = [
      {
        action: 'toggle_enabled',
        subtitle: provider.isEnabled
          ? translate('torst_provider_disable_descr', 'Exclude this provider from search')
          : translate('torst_provider_enable_descr', 'Include this provider in search'),
        title: iconLabel(
          ICON_DOWNLOAD,
          provider.isEnabled
            ? translate('torst_provider_disable', 'Disable Provider')
            : translate('torst_provider_enable', 'Enable Provider')
        ),
      },
      {
        action: 'test',
        subtitle: translate('torst_test_conn_descr', 'Check availability and measure latency'),
        title: iconLabel(ICON_ZAP, translate('torst_test_conn', 'Test Connection')),
      },
      {
        action: 'edit_name',
        subtitle: translate('torst_current_value', `Current: ${provider.name}`, { value: provider.name }),
        title: iconLabel(ICON_PENCIL, translate('torst_edit_name', 'Edit Name')),
      },
      {
        action: 'edit_url',
        subtitle: translate('torst_current_value', `Current: ${provider.url}`, { value: provider.url }),
        title: iconLabel(ICON_PENCIL, translate('torst_provider_edit_url', 'Edit Provider URL')),
      },
      {
        action: 'edit_api_key',
        subtitle: provider.apiKey ? '••••••••' : translate('torst_value_none', '(none)'),
        title: iconLabel(ICON_KEY, translate('torst_provider_edit_api_key', 'Edit API Key')),
      },
      {
        action: 'switch_type',
        subtitle: translate('torst_current_value', `Current: ${provider.type}`, {
          value: provider.type === 'prowlarr' ? 'Prowlarr' : 'Jackett',
        }),
        title: iconLabel(ICON_PENCIL, translate('torst_provider_switch_type', 'Switch Provider Type')),
      },
      {
        action: 'delete',
        subtitle: translate('torst_provider_delete_descr', 'Remove this provider from the pool'),
        title: iconLabel(ICON_TRASH, translate('torst_provider_delete', 'Delete Provider')),
      },
      {
        action: 'back',
        subtitle: translate('torst_provider_back_to_list', 'Return to provider list'),
        title: iconLabel(ICON_ARROW_LEFT, translate('torst_back', 'Back')),
      },
    ];

    Lampa.Select.show({
      items: menuItems,
      onBack: () => {
        this.openPoolManager();
      },
      onSelect: (selectedItem: LampaSelectItem) => {
        if (selectedItem.action === 'toggle_enabled') {
          provider.isEnabled = !provider.isEnabled;
          ProviderManager.updateProvider(provider);
          this.openProviderActions(provider);
        } else if (selectedItem.action === 'test') {
          if (Lampa.Noty) {
            Lampa.Noty.show(translate('torst_noty_testing', `Testing ${provider.url}...`, { url: provider.url }));
          }
          ProviderManager.checkHealth(provider).then(healthResult => {
            ProviderManager.updateProvider(provider);
            if (Lampa.Noty) {
              Lampa.Noty.show(
                healthResult.isOk
                  ? translate('torst_noty_connected', `Connected! Latency: ${healthResult.latencyMs} ms`, {
                    latency: healthResult.latencyMs ?? 0,
                  })
                  : translate('torst_noty_failed_connect', `Failed to connect to ${provider.url}`, { url: provider.url })
              );
            }
            this.openProviderActions(provider);
          });
        } else if (selectedItem.action === 'edit_name') {
          if (Lampa.Input) {
            Lampa.Input.edit({
              free: true,
              nosave: true,
              title: translate('torst_edit_name', 'Provider Name'),
              value: provider.name,
            }, value => {
              if (value && value.trim()) {
                provider.name = value.trim();
                ProviderManager.updateProvider(provider);
              }
              this.openProviderActions(provider);
            });
          }
        } else if (selectedItem.action === 'edit_url') {
          this.promptEditProviderUrl(provider);
        } else if (selectedItem.action === 'edit_api_key') {
          if (Lampa.Input) {
            Lampa.Input.edit({
              free: true,
              nosave: true,
              password: true,
              title: translate('torst_provider_edit_api_key', 'API Key'),
              value: provider.apiKey || '',
            }, value => {
              const apiKey = value ? value.trim() : '';
              if (apiKey !== (provider.apiKey || '')) {
                provider.apiKey = apiKey;
                provider.status = 'unknown';
                delete provider.latencyMs;
                ProviderManager.updateProvider(provider);
              }
              this.openProviderActions(provider);
            });
          }
        } else if (selectedItem.action === 'switch_type') {
          const nextType: ProviderType = provider.type === 'prowlarr' ? 'jackett' : 'prowlarr';
          provider.type = nextType;
          provider.status = 'unknown';
          delete provider.latencyMs;
          ProviderManager.updateProvider(provider);
          this.openProviderActions(provider);
        } else if (selectedItem.action === 'delete') {
          this.confirmDeleteProvider(provider);
        } else if (selectedItem.action === 'back') {
          this.openPoolManager();
        }
      },
      title: provider.name,
    });
  }

  public static promptEditProviderUrl(provider: TorrentProvider, initialValue?: string): void {
    if (typeof Lampa === 'undefined' || !Lampa.Input) return;

    const currentUrl = initialValue !== undefined ? initialValue : provider.url;

    Lampa.Input.edit({
      free: true,
      nosave: true,
      title: translate('torst_provider_edit_url', 'Edit Provider URL'),
      value: currentUrl,
    }, value => {
      const rawInput = (value || '').trim();

      if (!rawInput || rawInput === provider.url) {
        this.openProviderActions(provider);
        return;
      }

      const cleanUrl = normalizeProviderUrl(rawInput);
      if (!cleanUrl) {
        if (Lampa.Noty) {
          Lampa.Noty.show(translate('torst_provider_noty_valid_url', 'Enter a valid HTTP or HTTPS provider URL'));
        }
        this.promptEditProviderUrl(provider, rawInput);
        return;
      }

      if (cleanUrl === provider.url) {
        this.openProviderActions(provider);
        return;
      }

      const isDuplicate = ProviderManager.getProviders().some(
        candidate => candidate.id !== provider.id && candidate.url === cleanUrl
      );
      if (isDuplicate) {
        if (Lampa.Noty) {
          Lampa.Noty.show(translate('torst_provider_noty_duplicate_url', 'A provider with this URL already exists'));
        }
        this.promptEditProviderUrl(provider, rawInput);
        return;
      }

      provider.url = cleanUrl;
      provider.status = 'unknown';
      delete provider.latencyMs;
      ProviderManager.updateProvider(provider);
      if (Lampa.Noty) {
        Lampa.Noty.show(translate('torst_provider_noty_url_updated', 'Provider URL updated'));
      }
      this.openProviderActions(provider);
    });
  }

  public static promptAddProvider(): void {
    if (typeof Lampa === 'undefined' || !Lampa.Input) return;

    Lampa.Input.edit({
      free: true,
      nosave: true,
      title: translate('torst_provider_url_placeholder', 'Provider URL (e.g. http://192.168.1.100:9117)'),
      value: 'http://',
    }, providerUrlInput => {
      if (!providerUrlInput || !providerUrlInput.trim() || providerUrlInput.trim() === 'http://') {
        this.openPoolManager();
        return;
      }
      const normalizedUrl = normalizeProviderUrl(providerUrlInput);
      if (!normalizedUrl) {
        if (Lampa.Noty) {
          Lampa.Noty.show(translate('torst_provider_noty_valid_url', 'Enter a valid HTTP or HTTPS provider URL'));
        }
        this.openPoolManager();
        return;
      }
      const isDuplicate = ProviderManager.getProviders().some(candidate => candidate.url === normalizedUrl);
      if (isDuplicate) {
        if (Lampa.Noty) {
          Lampa.Noty.show(translate('torst_provider_noty_duplicate_url', 'A provider with this URL already exists'));
        }
        this.openPoolManager();
        return;
      }

      const parsed = new URL(normalizedUrl);
      const defaultName = parsed.hostname;

      const newProvider: TorrentProvider = {
        id: generateUuid(),
        isEnabled: true,
        name: defaultName,
        status: 'unknown',
        type: 'jackett',
        url: normalizedUrl,
      };
      ProviderManager.addProvider(newProvider);
      if (Lampa.Noty) {
        Lampa.Noty.show(translate('torst_provider_noty_added', `Added ${newProvider.name} to pool`, { name: newProvider.name }));
      }
      this.openProviderActions(newProvider);
    });
  }

  private static confirmDeleteProvider(provider: TorrentProvider): void {
    if (typeof Lampa === 'undefined' || !Lampa.Select) return;

    Lampa.Select.show({
      items: [
        {
          action: 'confirm_delete',
          subtitle: translate('torst_provider_confirm_delete_descr', 'This also removes its saved API key'),
          title: translate('torst_confirm_delete_name', `Delete ${provider.name}`, { name: provider.name }),
        },
        {
          action: 'cancel',
          subtitle: translate('torst_provider_keep', 'Keep this provider'),
          title: translate('torst_cancel', 'Cancel'),
        },
      ],
      onBack: () => {
        this.openProviderActions(provider);
      },
      onSelect: (selectedItem: LampaSelectItem) => {
        if (selectedItem.action !== 'confirm_delete') {
          this.openProviderActions(provider);
          return;
        }

        ProviderManager.removeProvider(provider.id);
        if (Lampa.Noty) {
          Lampa.Noty.show(translate('torst_provider_noty_deleted', `Deleted ${provider.name}`, { name: provider.name }));
        }
        this.openPoolManager();
      },
      title: translate('torst_provider_confirm_delete_title', 'Delete Provider?'),
    });
  }
}
