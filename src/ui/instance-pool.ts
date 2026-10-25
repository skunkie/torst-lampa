// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import { AuthManager } from '../api/auth';
import { TorstApi } from '../api/torst';
import { InstanceManager } from '../instances/instance-manager';
import { translate } from '../lang/translations';
import { TorstInstance } from '../types/torst';
import { toTemplateText } from '../utils/template-text';
import { generateUuid } from '../utils/uuid';
import { ProfilesUi } from './profiles';
import {
  describeConnectionStatus,
  ICON_ARROW_LEFT,
  ICON_DOWNLOAD,
  ICON_KEY,
  ICON_LOCK,
  ICON_PENCIL,
  ICON_PLUS,
  ICON_STAR,
  ICON_TRASH,
  ICON_ZAP,
  iconLabel,
} from './settings';

interface AuthenticationSelectItem extends LampaSelectItem {
  auth: TorstInstance['authType']
}

function describeAuthenticationMode(instance: TorstInstance): string {
  if (instance.authType === 'bearer') return 'Bearer';
  return translate('torst_auth_none', 'None');
}

function buildAuthenticationTag(instance: TorstInstance): string {
  if (instance.authType !== 'bearer') return '';
  const mode = describeAuthenticationMode(instance);
  return ` · ${translate('torst_auth_tag', `Auth: ${mode}`, { mode })}`;
}

function normalizeInstanceUrl(value: string): string | null {
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

export class InstancePoolUi {
  public static openPoolManager(): void {
    if (typeof Lampa === 'undefined' || !Lampa.Select) return;

    const instances = InstanceManager.getInstances();
    const selectionMode = InstanceManager.getMode();
    const activeInstance = InstanceManager.getPrimaryInstance();

    const menuItems: Array<LampaSelectItem<TorstInstance>> = [
      {
        action: 'add',
        subtitle: translate('torst_add_instance_descr', 'Add a new Torst instance to the pool'),
        title: iconLabel(ICON_PLUS, translate('torst_add_instance', 'Add Instance')),
      },
      {
        action: 'ping_all',
        subtitle: translate('torst_test_all_descr', 'Test latency across all pool instances'),
        title: iconLabel(ICON_ZAP, translate('torst_test_all', 'Test All Instances')),
      },
    ];

    if (selectionMode === 'manual') {
      menuItems.push({
        action: 'set_active',
        subtitle: translate('torst_change_active_descr', 'Choose which instance handles requests'),
        title: iconLabel(ICON_STAR, translate('torst_change_active', 'Change Active Instance')),
      });
    }

    instances.forEach(instance => {
      const isActive = instance.id === activeInstance?.id;
      const statusDescription = describeConnectionStatus(instance);

      const activeTag = isActive
        ? (selectionMode === 'auto'
          ? translate('torst_active_auto_badge', ' [Active (Auto)]')
          : translate('torst_active_badge', ' [Active]'))
        : '';
      const authenticationTag = buildAuthenticationTag(instance);

      menuItems.push({
        action: 'instance',
        data: instance,
        selected: isActive,
        subtitle: `${instance.url} · ${statusDescription}${authenticationTag}`,
        title: `${instance.name}${activeTag}`,
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
      onSelect: (selectedItem: LampaSelectItem<TorstInstance>) => {
        if (selectedItem.action === 'back') {
          if (typeof Lampa !== 'undefined' && Lampa.Controller) {
            Lampa.Controller.toggle('settings_component');
          }
        } else if (selectedItem.action === 'add') {
          this.promptAddInstance();
        } else if (selectedItem.action === 'ping_all') {
          if (Lampa.Noty) Lampa.Noty.show(translate('torst_noty_pinging_all', 'Checking all Torst instances...'));
          InstanceManager.pingAll().then(() => {
            this.openPoolManager();
          });
        } else if (selectedItem.action === 'set_active') {
          this.promptSelectActiveInstance();
        } else if (selectedItem.action === 'instance' && selectedItem.data) {
          this.openInstanceActions(selectedItem.data);
        }
      },
      title: translate('torst_pool_title', `Torst Pool (${selectionMode === 'auto' ? 'Auto Mode' : 'Manual Mode'})`, {
        mode: selectionMode === 'auto'
          ? translate('torst_pool_auto_mode', 'Auto Mode')
          : translate('torst_pool_manual_mode', 'Manual Mode'),
      }),
    });
  }

  public static promptSelectActiveInstance(): void {
    if (typeof Lampa === 'undefined' || !Lampa.Select) return;

    const instances = InstanceManager.getInstances();
    if (instances.length === 0) {
      if (Lampa.Noty) {
        Lampa.Noty.show(translate('torst_noty_no_instances', 'Add an instance to the pool first'));
      }
      if (Lampa.Controller) Lampa.Controller.toggle('settings_component');
      return;
    }

    const activeInstance = InstanceManager.getPrimaryInstance();

    const menuItems = instances.map(instance => {
      const isActive = instance.id === activeInstance?.id;
      const statusDescription = describeConnectionStatus(instance);

      const authenticationTag = buildAuthenticationTag(instance);

      return {
        data: instance,
        selected: isActive,
        subtitle: `${instance.url} · ${statusDescription}${authenticationTag}`,
        title: `${instance.name}${isActive ? translate('torst_active_badge', ' [Active]') : ''}`,
      };
    });

    Lampa.Select.show({
      items: menuItems,
      onBack: () => {
        if (Lampa.Controller) Lampa.Controller.toggle('settings_component');
      },
      onSelect: (selectedItem: LampaSelectItem<TorstInstance>) => {
        const instance = selectedItem.data;
        if (!instance) return;
        InstanceManager.setSelectedId(instance.id);
        if (Lampa.Noty) {
          Lampa.Noty.show(
            translate('torst_noty_selected_active', `Selected ${instance.name} as active instance`, {
              name: instance.name,
            })
          );
        }
        if (Lampa.Controller) Lampa.Controller.toggle('settings_component');
      },
      title: translate('torst_select_active_title', 'Select Active Instance'),
    });
  }

  public static openInstanceActions(instance: TorstInstance): void {
    if (typeof Lampa === 'undefined' || !Lampa.Select) return;

    if (typeof instance.enableDownloader === 'undefined') {
      TorstApi.getSettings(instance).then(settings => {
        let changed = false;
        if (settings && typeof settings.background_downloads === 'boolean' && typeof instance.enableDownloader === 'undefined') {
          instance.enableDownloader = settings.background_downloads;
          changed = true;
        }
        if (changed) {
          InstanceManager.updateInstance(instance);
        }
      }).catch(() => {});
    }

    const menuItems: LampaSelectItem[] = [
      {
        action: 'profile',
        subtitle: toTemplateText(instance.profileName || translate('torst_profile_local', 'Local Lampa Progress')),
        title: translate('torst_profiles_title', 'Torst Profiles'),
      },
      {
        action: 'test',
        subtitle: translate('torst_test_conn_descr', 'Check availability and measure latency'),
        title: iconLabel(ICON_ZAP, translate('torst_test_conn', 'Test Connection')),
      },
      {
        action: 'edit_name',
        subtitle: translate('torst_current_value', `Current: ${instance.name}`, { value: instance.name }),
        title: iconLabel(ICON_PENCIL, translate('torst_edit_name', 'Edit Name')),
      },
      {
        action: 'edit_url',
        subtitle: translate('torst_current_value', `Current: ${instance.url}`, { value: instance.url }),
        title: iconLabel(ICON_PENCIL, translate('torst_edit_url', 'Edit Instance URL')),
      },
      {
        action: 'edit_auth',
        subtitle: translate('torst_current_value', `Current: ${describeAuthenticationMode(instance)}`, {
          value: describeAuthenticationMode(instance),
        }),
        title: iconLabel(ICON_LOCK, translate('torst_auth_mode', 'Authentication Mode')),
      },
    ];

    if (instance.authType === 'bearer') {
      menuItems.push({
        action: 'edit_password',
        subtitle: instance.password ? '••••••••' : translate('torst_value_none', '(none)'),
        title: iconLabel(ICON_KEY, translate('torst_edit_password', 'Edit Password')),
      });
    }

    const isDownloaderEnabled = Boolean(instance.enableDownloader);
    menuItems.push({
      action: 'toggle_downloader',
      subtitle: translate('torst_current_value', `Current: ${isDownloaderEnabled ? 'Enabled' : 'Disabled'}`, {
        value: isDownloaderEnabled ? translate('torst_status_enabled', 'Enabled') : translate('torst_status_disabled', 'Disabled'),
      }),
      title: iconLabel(
        ICON_DOWNLOAD,
        isDownloaderEnabled
          ? translate('torst_disable_downloader', 'Disable Background Downloader')
          : translate('torst_enable_downloader', 'Enable Background Downloader')
      ),
    });

    menuItems.push({
      action: 'delete',
      subtitle: translate('torst_delete_instance_descr', 'Remove this instance from pool'),
      title: iconLabel(ICON_TRASH, translate('torst_delete_instance', 'Delete Instance')),
    });

    menuItems.push({
      action: 'back',
      subtitle: translate('torst_back_to_instances', 'Return to instance list'),
      title: iconLabel(ICON_ARROW_LEFT, translate('torst_back', 'Back')),
    });

    Lampa.Select.show({
      items: menuItems,
      onBack: () => {
        this.openPoolManager();
      },
      onSelect: (selectedItem: LampaSelectItem) => {
        if (selectedItem.action === 'profile') {
          void ProfilesUi.show(instance, () => this.openInstanceActions(instance));
        } else if (selectedItem.action === 'test') {
          if (Lampa.Noty) {
            Lampa.Noty.show(
              translate('torst_noty_testing', `Testing ${instance.url}...`, { url: instance.url })
            );
          }
          TorstApi.checkHealth(instance).then(healthResult => {
            if (healthResult.isOk) {
              TorstApi.getSettings(instance).then(settings => {
                let changed = false;
                if (settings && typeof settings.background_downloads === 'boolean') {
                  instance.enableDownloader = settings.background_downloads;
                  changed = true;
                }
                if (changed) {
                  InstanceManager.updateInstance(instance);
                }
              }).catch(() => {});
              if (Lampa.Noty) {
                Lampa.Noty.show(
                  translate('torst_noty_connected', `Connected! Latency: ${healthResult.latencyMs} ms`, {
                    latency: healthResult.latencyMs ?? 0,
                  })
                );
              }
            } else {
              if (Lampa.Noty) {
                Lampa.Noty.show(
                  translate('torst_noty_failed_connect', `Failed to connect to ${instance.url}`, {
                    url: instance.url,
                  })
                );
              }
            }
            this.openInstanceActions(instance);
          });
        } else if (selectedItem.action === 'edit_name') {
          if (Lampa.Input) {
            Lampa.Input.edit({
              free: true,
              nosave: true,
              title: translate('torst_edit_name', 'Instance Name'),
              value: instance.name,
            }, value => {
              if (value && value.trim()) {
                instance.name = value.trim();
                InstanceManager.updateInstance(instance);
              }
              this.openInstanceActions(instance);
            });
          }
        } else if (selectedItem.action === 'edit_url') {
          this.promptEditInstanceUrl(instance);
        } else if (selectedItem.action === 'edit_auth') {
          Lampa.Select.show({
            items: [
              {
                auth: 'none',
                selected: instance.authType === 'none',
                subtitle: translate('torst_auth_none_descr', 'No credentials required'),
                title: translate('torst_auth_none', 'None'),
              },
              {
                auth: 'bearer',
                selected: instance.authType === 'bearer',
                subtitle: translate('torst_auth_bearer_descr', 'Sign in with the Torst password'),
                title: 'Bearer',
              },
            ],
            onBack: () => {
              this.openInstanceActions(instance);
            },
            onSelect: (selectedAuthentication: AuthenticationSelectItem) => {
              instance.authType = selectedAuthentication.auth;
              AuthManager.invalidateTokens(instance);
              InstanceManager.updateInstance(instance);
              this.openInstanceActions(instance);
            },
            title: translate('torst_auth_mode', 'Authentication Mode'),
          });
        } else if (selectedItem.action === 'edit_password') {
          if (Lampa.Input) {
            Lampa.Input.edit({
              free: true,
              nosave: true,
              password: true,
              title: translate('torst_edit_password', 'Password'),
              value: instance.password || '',
            }, value => {
              instance.password = value || '';
              AuthManager.invalidateTokens(instance);
              InstanceManager.updateInstance(instance);
              this.openInstanceActions(instance);
            });
          }
        } else if (selectedItem.action === 'toggle_downloader') {
          const nextState = !instance.enableDownloader;
          TorstApi.updateSettings(instance, { background_downloads: nextState }).then(() => {
            instance.enableDownloader = nextState;
            InstanceManager.updateInstance(instance);
            if (Lampa.Noty) {
              const notyKey = nextState ? 'torst_noty_downloader_enabled' : 'torst_noty_downloader_disabled';
              const notyFallback = `Background downloader ${nextState ? 'enabled' : 'disabled'} on ${instance.name}`;
              Lampa.Noty.show(translate(notyKey, notyFallback, { name: instance.name }));
            }
            this.openInstanceActions(instance);
          }).catch((error: unknown) => {
            if (Lampa.Noty) {
              const msg = error instanceof Error ? error.message : String(error);
              Lampa.Noty.show(
                translate('torst_noty_downloader_failed', `Failed to update background downloader: ${msg}`, { msg })
              );
            }
            this.openInstanceActions(instance);
          });
        } else if (selectedItem.action === 'delete') {
          if (InstanceManager.getInstances().length <= 1) {
            if (Lampa.Noty) {
              Lampa.Noty.show(
                translate('torst_noty_cannot_delete_only', 'Cannot delete the only instance in pool')
              );
            }
            this.openInstanceActions(instance);
            return;
          }
          this.confirmDeleteInstance(instance);
        } else if (selectedItem.action === 'back') {
          this.openPoolManager();
        }
      },
      title: instance.name,
    });
  }

  public static promptEditInstanceUrl(instance: TorstInstance, initialValue?: string): void {
    if (typeof Lampa === 'undefined' || !Lampa.Input) return;

    const currentUrl = initialValue !== undefined ? initialValue : instance.url;

    Lampa.Input.edit({
      free: true,
      nosave: true,
      title: translate('torst_edit_url', 'Instance URL'),
      value: currentUrl,
    }, value => {
      const rawInput = (value || '').trim();

      // If user canceled, cleared input, or submitted original unchanged URL
      if (!rawInput || rawInput === instance.url) {
        this.openInstanceActions(instance);
        return;
      }

      if (rawInput === 'http://' || rawInput === 'https://') {
        if (Lampa.Noty) {
          Lampa.Noty.show(
            translate('torst_noty_valid_url', 'Enter a valid HTTP or HTTPS instance URL')
          );
        }
        this.openInstanceActions(instance);
        return;
      }

      // If user backed out on re-prompt without changing the invalid input
      if (initialValue !== undefined && rawInput === initialValue) {
        this.openInstanceActions(instance);
        return;
      }

      const cleanUrl = normalizeInstanceUrl(rawInput);
      if (!cleanUrl) {
        if (Lampa.Noty) {
          Lampa.Noty.show(
            translate('torst_noty_valid_url', 'Enter a valid HTTP or HTTPS instance URL')
          );
        }
        this.promptEditInstanceUrl(instance, rawInput);
        return;
      }

      if (cleanUrl === instance.url) {
        this.openInstanceActions(instance);
        return;
      }

      const isDuplicate = InstanceManager.getInstances().some(
        inst => inst.id !== instance.id && inst.url === cleanUrl
      );
      if (isDuplicate) {
        if (Lampa.Noty) {
          Lampa.Noty.show(
            translate('torst_noty_duplicate_url', 'An instance with this URL already exists')
          );
        }
        this.promptEditInstanceUrl(instance, rawInput);
        return;
      }

      instance.url = cleanUrl;
      instance.status = 'unknown';
      delete instance.latencyMs;
      AuthManager.invalidateTokens(instance);
      InstanceManager.updateInstance(instance);
      if (Lampa.Noty) {
        Lampa.Noty.show(translate('torst_noty_url_updated', 'Instance URL updated'));
      }

      TorstApi.checkHealth(instance).then(healthResult => {
        if (Lampa.Noty) {
          if (healthResult.isOk) {
            Lampa.Noty.show(
              translate('torst_noty_online', `Instance online! Latency: ${healthResult.latencyMs} ms`, {
                latency: healthResult.latencyMs ?? 0,
              })
            );
          } else {
            Lampa.Noty.show(
              translate('torst_noty_offline_warning', 'Warning: Instance is offline or unreachable')
            );
          }
        }
      });

      this.openInstanceActions(instance);
    });
  }

  public static promptAddInstance(): void {
    if (typeof Lampa === 'undefined' || !Lampa.Input) return;

    Lampa.Input.edit({
      free: true,
      nosave: true,
      title: translate('torst_instance_url_placeholder', 'Instance URL (e.g. http://192.168.1.100:8080)'),
      value: 'http://',
    }, instanceUrlInput => {
      if (!instanceUrlInput || !instanceUrlInput.trim() || instanceUrlInput.trim() === 'http://') {
        this.openPoolManager();
        return;
      }
      const normalizedUrl = normalizeInstanceUrl(instanceUrlInput);
      if (!normalizedUrl) {
        if (Lampa.Noty) {
          Lampa.Noty.show(
            translate('torst_noty_valid_url', 'Enter a valid HTTP or HTTPS instance URL')
          );
        }
        this.openPoolManager();
        return;
      }
      const isDuplicate = InstanceManager.getInstances().some(inst => inst.url === normalizedUrl);
      if (isDuplicate) {
        if (Lampa.Noty) {
          Lampa.Noty.show(
            translate('torst_noty_duplicate_url', 'An instance with this URL already exists')
          );
        }
        this.openPoolManager();
        return;
      }
      const parsed = new URL(normalizedUrl);
      const defaultName = parsed.hostname;

      Lampa.Input.edit({
        free: true,
        nosave: true,
        title: translate('torst_edit_name', 'Instance Name'),
        value: defaultName,
      }, instanceNameInput => {
        const newInst: TorstInstance = {
          authType: 'none',
          id: generateUuid(),
          name: (instanceNameInput && instanceNameInput.trim()) || defaultName,
          status: 'unknown',
          url: normalizedUrl,
        };
        this.confirmAddInstance(newInst);
      });
    });
  }

  private static confirmAddInstance(instance: TorstInstance): void {
    Lampa.Select.show({
      items: [
        {
          action: 'confirm_add',
          subtitle: instance.url,
          title: translate('torst_confirm_add_name', `Add ${instance.name}`, { name: instance.name }),
        },
        {
          action: 'cancel',
          subtitle: translate('torst_discard_instance', 'Discard this instance'),
          title: translate('torst_cancel', 'Cancel'),
        },
      ],
      onBack: () => {
        this.openPoolManager();
      },
      onSelect: (selectedItem: LampaSelectItem) => {
        if (selectedItem.action !== 'confirm_add') {
          this.openPoolManager();
          return;
        }

        InstanceManager.addInstance(instance);
        if (Lampa.Noty) {
          Lampa.Noty.show(
            translate('torst_noty_added', `Added ${instance.name} to pool`, { name: instance.name })
          );
        }
        TorstApi.checkHealth(instance).then(healthResult => {
          if (Lampa.Noty) {
            if (healthResult.isOk) {
              Lampa.Noty.show(
                translate('torst_noty_online', `Instance online! Latency: ${healthResult.latencyMs} ms`, {
                  latency: healthResult.latencyMs ?? 0,
                })
              );
            } else {
              Lampa.Noty.show(
                translate('torst_noty_offline_warning', 'Warning: Instance is offline or unreachable')
              );
            }
          }
        });
        this.openPoolManager();
      },
      title: translate('torst_confirm_add_title', 'Add Instance?'),
    });
  }

  private static confirmDeleteInstance(instance: TorstInstance): void {
    Lampa.Select.show({
      items: [
        {
          action: 'confirm_delete',
          subtitle: translate('torst_confirm_delete_descr', 'This also removes its saved credentials'),
          title: translate('torst_confirm_delete_name', `Delete ${instance.name}`, { name: instance.name }),
        },
        {
          action: 'cancel',
          subtitle: translate('torst_keep_instance', 'Keep this instance'),
          title: translate('torst_cancel', 'Cancel'),
        },
      ],
      onBack: () => {
        this.openInstanceActions(instance);
      },
      onSelect: (selectedItem: LampaSelectItem) => {
        if (selectedItem.action !== 'confirm_delete') {
          this.openInstanceActions(instance);
          return;
        }

        InstanceManager.removeInstance(instance.id);
        if (Lampa.Noty) {
          Lampa.Noty.show(
            translate('torst_noty_deleted', `Deleted ${instance.name}`, { name: instance.name })
          );
        }
        this.openPoolManager();
      },
      title: translate('torst_confirm_delete_title', 'Delete Instance?'),
    });
  }
}
