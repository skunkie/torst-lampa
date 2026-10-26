// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import { InstanceManager } from '../instances/instance-manager';
import { translate } from '../lang/translations';
import { TorstInstance } from '../types/torst';
import { toTemplateText } from '../utils/template-text';
import { ProfilesUi } from './profiles';
import { TORST_ICON } from './settings';

// The header changes foreground color on focus, while menu and settings icons use inversion.
const HEADER_ICON = TORST_ICON.replace(/(fill|stroke)="white"/g, '$1="currentColor"');

export class ProfileHeaderUi {
  private static isRegistered = false;

  public static init(): void {
    if (this.isRegistered || !Lampa.Head?.addIcon) return;
    const title = translate('torst_profiles_title', 'Torst Profiles');
    Lampa.Head.addIcon(HEADER_ICON, () => this.open())
      .addClass('torst-profile-button')
      .attr('aria-label', title)
      .attr('role', 'button')
      .attr('title', title);
    this.isRegistered = true;
  }

  private static open(): void {
    const activity = Lampa.Activity?.active?.();
    const isCurrent = () => activity === undefined || Lampa.Activity?.active?.() === activity;
    const returnToHeader = () => {
      if (isCurrent()) Lampa.Controller.toggle('head');
    };
    const showProfiles = (instance: TorstInstance) => {
      void ProfilesUi.show(instance, returnToHeader).catch(error => {
        if (isCurrent()) {
          this.report(error);
          returnToHeader();
        }
      });
    };
    const instances = InstanceManager.getInstances();
    if (!instances.length) {
      Lampa.Noty?.show(translate('torst_noty_no_instances', 'Add an instance to the pool first'));
      returnToHeader();
    } else if (instances.length === 1) {
      showProfiles(instances[0]);
    } else {
      const primaryId = InstanceManager.getPrimaryInstance().id;
      Lampa.Select.show({
        items: instances.map(instance => ({
          data: instance.id,
          selected: instance.id === primaryId,
          subtitle: toTemplateText(instance.profileName || translate('torst_profile_local', 'Local Lampa Progress')),
          title: toTemplateText(instance.name),
        })),
        onBack: returnToHeader,
        onSelect: (item: LampaSelectItem<string>) => {
          if (!isCurrent()) return;
          const instance = InstanceManager.getInstances().find(candidate => candidate.id === item.data);
          if (instance) showProfiles(instance);
          else returnToHeader();
        },
        title: translate('torst_profile_instance_title', 'Torst Profiles — Select Instance'),
      });
    }
  }

  private static report(error: unknown): void {
    Lampa.Noty?.show(translate('torst_noty_error', 'Torst: {msg}', { msg: error instanceof Error ? error.message : String(error) }));
  }
}
