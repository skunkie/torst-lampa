// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import { TorstApi } from '../api/torst';
import { InstanceManager } from '../instances/instance-manager';
import { translate } from '../lang/translations';
import { TorstInstance, TorstProfile } from '../types/torst';
import { toTemplateText } from '../utils/template-text';

const DEFAULT_AVATAR = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#444"/><circle cx="32" cy="23" r="11" fill="#ddd"/><path d="M12 56a20 20 0 0 1 40 0" fill="#ddd"/></svg>');

interface ProfileActionsContext {
  deletionRevision: number,
  isInstanceCurrent: () => boolean,
  onBack: () => void,
  onExit: () => void
}

export class ProfilesUi {
  private static avatarUrls: string[] = [];
  private static deletionRevisions = new WeakMap<TorstInstance, number>();
  private static generation = 0;

  private static invalidateMenuContext(): void {
    this.generation++;
    this.avatarUrls.forEach(url => URL.revokeObjectURL(url));
    this.avatarUrls = [];
  }

  private static async avatar(instance: TorstInstance, profile: TorstProfile, urls: string[]): Promise<string> {
    if (!profile.avatar) return DEFAULT_AVATAR;
    try {
      const blob = await TorstApi.getProfileAvatar(instance, profile.id);
      if (!blob.type.startsWith('image/')) return DEFAULT_AVATAR;
      const url = URL.createObjectURL(blob);
      urls.push(url);
      if (typeof Image !== 'undefined') {
        const loaded = await new Promise<boolean>(resolve => {
          const image = new Image();
          image.onload = () => resolve(true);
          image.onerror = () => resolve(false);
          image.src = url;
        });
        if (!loaded) return DEFAULT_AVATAR;
      }
      return url;
    } catch {
      return DEFAULT_AVATAR;
    }
  }

  private static createInstanceGuard(instance: TorstInstance): () => boolean {
    const instanceUrl = instance.url;
    return () => instance.url === instanceUrl && InstanceManager.getInstances().includes(instance);
  }

  private static getDeletionRevision(instance: TorstInstance): number {
    return this.deletionRevisions.get(instance) || 0;
  }

  private static createContextGuard(instance: TorstInstance): () => boolean {
    const generation = this.generation;
    const isInstanceCurrent = this.createInstanceGuard(instance);
    const activity = Lampa.Activity?.active?.();
    const controller = Lampa.Controller?.enabled?.();
    return () => {
      const currentController = Lampa.Controller?.enabled?.();
      return generation === this.generation && isInstanceCurrent()
        && (activity === undefined || Lampa.Activity?.active?.() === activity)
        && (controller === undefined || (controller.name === currentController?.name && controller.controller === currentController?.controller));
    };
  }

  private static async perform(instance: TorstInstance, action: (isCurrent: () => boolean) => Promise<void>, returnTo: () => void): Promise<void> {
    const isCurrent = this.createContextGuard(instance);
    try {
      await action(isCurrent);
    } catch (error) {
      if (!isCurrent()) return;
      Lampa.Noty?.show(translate('torst_noty_error', 'Torst: {msg}', { msg: error instanceof Error ? error.message : String(error) }));
    }
    if (isCurrent()) returnTo();
  }

  public static async show(instance: TorstInstance, onBack: () => void): Promise<void> {
    this.invalidateMenuContext();
    const isCurrent = this.createContextGuard(instance);
    const isInstanceCurrent = this.createInstanceGuard(instance);
    const deletionRevision = this.getDeletionRevision(instance);
    let profiles: TorstProfile[];
    let excludedProfileIds: string[];
    const urls: string[] = [];
    let thumbnails: string[];
    try {
      profiles = await TorstApi.getProfiles(instance);
      excludedProfileIds = profiles.filter(profile => profile.kind !== 'person').map(profile => profile.id);
      profiles = profiles.filter(profile => profile.kind === 'person');
      if (!isCurrent()) return;
      if (deletionRevision !== this.getDeletionRevision(instance)) return this.show(instance, onBack);
      thumbnails = await Promise.all(profiles.map(profile => this.avatar(instance, profile, urls)));
    } catch (error) {
      if (!isCurrent()) return;
      Lampa.Noty?.show(translate('torst_noty_error', 'Torst: {msg}', { msg: error instanceof Error ? error.message : String(error) }));
      onBack();
      return;
    }
    if (!isCurrent() || deletionRevision !== this.getDeletionRevision(instance)) {
      urls.forEach(url => URL.revokeObjectURL(url));
      if (isCurrent()) return this.show(instance, onBack);
      return;
    }
    if (instance.profileId && excludedProfileIds.includes(instance.profileId)) {
      delete instance.profileId;
      delete instance.profileName;
      InstanceManager.updateInstance(instance);
    }
    const selectedProfile = profiles.find(profile => profile.id === instance.profileId);
    if (selectedProfile && selectedProfile.name !== instance.profileName) {
      instance.profileName = selectedProfile.name;
      InstanceManager.updateInstance(instance);
    }
    this.avatarUrls = urls;
    const returnTo = () => { void this.show(instance, onBack); };
    const items: LampaSelectItem<TorstProfile>[] = [
      { action: 'none', selected: !instance.profileId, title: translate('torst_profile_local', 'Local Lampa Progress') },
      ...profiles.map((profile, index) => ({ action: 'profile', data: profile, selected: profile.id === instance.profileId, thumbnail: thumbnails[index], title: toTemplateText(profile.name) })),
      { action: 'create', title: translate('torst_profile_create', 'Create Profile') },
    ];
    Lampa.Select.show({
      items,
      onBack: () => { this.invalidateMenuContext(); onBack(); },
      onSelect: (item: LampaSelectItem<TorstProfile>) => {
        this.invalidateMenuContext();
        if (!isInstanceCurrent()) return onBack();
        if (item.action === 'none') {
          delete instance.profileId;
          delete instance.profileName;
          InstanceManager.updateInstance(instance);
          onBack();
        } else if (item.action === 'create') {
          Lampa.Input.edit({ free: true, nosave: true, title: translate('torst_profile_name', 'Profile Name'), value: '' }, name => {
            if (!isInstanceCurrent()) return onBack();
            if (!name.trim()) return returnTo();
            void this.perform(instance, async isCurrent => {
              const profile = await TorstApi.createProfile(instance, name.trim());
              if (!isCurrent()) return;
              instance.profileId = profile.id;
              instance.profileName = profile.name;
              InstanceManager.updateInstance(instance);
            }, returnTo);
          });
        } else if (item.data) {
          this.actions(instance, item.data, { deletionRevision, isInstanceCurrent, onBack: returnTo, onExit: onBack });
        }
      },
      title: translate('torst_profiles_title', 'Torst Profiles'),
    });
  }

  private static actions(instance: TorstInstance, profile: TorstProfile, context: ProfileActionsContext): void {
    const { deletionRevision, isInstanceCurrent, onBack, onExit } = context;
    if (!isInstanceCurrent()) return onExit();
    if (deletionRevision !== this.getDeletionRevision(instance)) return onBack();
    const returnTo = () => this.actions(instance, profile, context);
    Lampa.Select.show({
      items: [
        { action: 'use', title: translate('torst_profile_use', 'Use This Profile') },
        { action: 'rename', title: translate('torst_profile_rename', 'Rename Profile') },
        { action: 'delete', title: translate('torst_profile_delete', 'Delete Profile') },
      ],
      onBack,
      onSelect: (item: LampaSelectItem) => {
        if (!isInstanceCurrent()) return onExit();
        if (deletionRevision !== this.getDeletionRevision(instance)) return onBack();
        if (item.action === 'use') {
          instance.profileId = profile.id;
          instance.profileName = profile.name;
          InstanceManager.updateInstance(instance);
          onExit();
        } else if (item.action === 'rename') {
          Lampa.Input.edit({ free: true, nosave: true, title: translate('torst_profile_name', 'Profile Name'), value: profile.name }, name => {
            if (!isInstanceCurrent()) return onExit();
            if (deletionRevision !== this.getDeletionRevision(instance)) return onBack();
            if (!name.trim() || name.trim() === profile.name) return returnTo();
            void this.perform(instance, async isCurrent => {
              const renamed = await TorstApi.renameProfile(instance, profile.id, name.trim());
              if (!isCurrent()) return;
              profile.name = renamed.name;
              if (instance.profileId === profile.id) {
                instance.profileName = profile.name;
                InstanceManager.updateInstance(instance);
              }
            }, returnTo);
          });
        } else if (item.action === 'delete') {
          Lampa.Select.show({
            items: [
              { action: 'cancel', title: translate('torst_cancel', 'Cancel') },
              { action: 'confirm', title: translate('torst_profile_delete', 'Delete Profile') },
            ],
            onBack: returnTo,
            onSelect: (choice: LampaSelectItem) => {
              if (!isInstanceCurrent()) return onExit();
              if (deletionRevision !== this.getDeletionRevision(instance)) return onBack();
              if (choice.action !== 'confirm') return returnTo();
              const instanceId = instance.id;
              const instanceUrl = instance.url;
              void this.perform(instance, async () => {
                await TorstApi.deleteProfile(instance, profile.id);
                const currentInstance = InstanceManager.getInstances().find(candidate => candidate.id === instanceId && candidate.url === instanceUrl);
                if (instance.url === instanceUrl) this.deletionRevisions.set(instance, this.getDeletionRevision(instance) + 1);
                if (currentInstance && currentInstance !== instance) this.deletionRevisions.set(currentInstance, this.getDeletionRevision(currentInstance) + 1);
                if (currentInstance?.profileId === profile.id) {
                  delete currentInstance.profileId;
                  delete currentInstance.profileName;
                  InstanceManager.updateInstance(currentInstance);
                }
              }, onBack);
            },
            title: translate('torst_profile_delete_confirm', 'Delete this profile and all its viewing progress?'),
          });
        }
      },
      title: Lampa.Utils.clearHtmlTags(profile.name),
    });
  }
}
