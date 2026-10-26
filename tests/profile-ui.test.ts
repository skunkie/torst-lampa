// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { TorstApi } from '../src/api/torst';
import { InstanceManager } from '../src/instances/instance-manager';
import { TorstInstance, TorstProfile } from '../src/types/torst';
import { ProfilesUi } from '../src/ui/profiles';
import { createTestLanguage, getTestTranslation } from './support/translations';

const flush = () => new Promise(resolve => setImmediate(resolve));

describe('Torst profiles UI', () => {
  const originalLampa = (globalThis as any).Lampa;
  const originalImage = (globalThis as any).Image;
  let instance: TorstInstance;
  let menu: any;
  let input: any;
  let inputCallback: (value: string) => void;
  let profiles: TorstProfile[];
  let backs: number;
  let notices: string[];

  beforeEach(() => {
    menu = undefined;
    instance = { authType: 'none', id: 'one', name: 'One', profileId: 'prf_alex', profileName: 'Alex', url: 'http://torst.test' };
    profiles = [{ avatar: null, id: 'prf_alex', name: 'Alex' }];
    backs = 0;
    notices = [];
    (globalThis as any).Lampa = {
      Input: { edit: (options: unknown, callback: (name: string) => void) => { input = options; inputCallback = callback; } },
      Lang: createTestLanguage(),
      Noty: { show: (text: string) => notices.push(text) },
      Select: { show: (options: any) => { menu = options; } },
      Utils: { clearHtmlTags: (text: string) => text.replace(/<[^>]*>/g, '') },
    };
    mock.method(InstanceManager, 'updateInstance', () => {});
    mock.method(InstanceManager, 'getInstances', () => [instance]);
    mock.method(TorstApi, 'getProfiles', async () => profiles);
    mock.method(TorstApi, 'createProfile', async (_instance: TorstInstance, name: string) => {
      const profile = { id: 'prf_sam', name };
      profiles.push(profile);
      return profile;
    });
    mock.method(TorstApi, 'renameProfile', async (_instance: TorstInstance, id: string, name: string) => ({ id, name }));
    mock.method(TorstApi, 'deleteProfile', async (_instance: TorstInstance, id: string) => { profiles = profiles.filter(profile => profile.id !== id); });
  });
  afterEach(() => {
    (ProfilesUi as any).invalidateMenuContext();
    mock.restoreAll();
    (globalThis as any).Lampa = originalLampa;
    (globalThis as any).Image = originalImage;
  });
  const open = () => ProfilesUi.show(instance, () => { backs++; });
  const select = (action: string) => menu.onSelect(menu.items.find((item: any) => item.action === action));

  it('switches the active profile for this instance and can return to local progress', async () => {
    await open();
    assert.equal(menu.items.find((item: any) => item.data?.id === 'prf_alex').selected, true);
    select('profile');
    select('use');
    assert.equal(backs, 1);
    assert.equal(instance.profileId, 'prf_alex');
    await open();
    select('none');
    assert.equal(instance.profileId, undefined);
    assert.equal(instance.profileName, undefined);
    assert.equal((InstanceManager.updateInstance as any).mock.callCount(), 2);
  });

  it('creates and selects a named profile through the remote-friendly input', async () => {
    await open();
    select('create');
    assert.equal(input.nosave, true);
    inputCallback('  Sam  ');
    await flush();
    assert.equal(instance.profileId, 'prf_sam');
    assert.equal(instance.profileName, 'Sam');
    assert.ok(menu.items.some((item: any) => item.data?.id === 'prf_sam' && item.selected));
  });

  it('ignores an empty name and uses the normalized name returned after a rename', async () => {
    await open();
    select('create');
    inputCallback('   ');
    await flush();
    assert.equal((TorstApi.createProfile as any).mock.callCount(), 0);
    select('profile');
    select('rename');
    assert.equal(input.value, 'Alex');
    mock.method(TorstApi, 'renameProfile', async () => ({ id: 'prf_alex', name: 'Normalized Name' }));
    inputCallback('Normalized  Name');
    await flush();
    assert.equal(instance.profileName, 'Normalized Name');
  });

  it('requires confirmation before deleting a profile and clears its selected ID', async () => {
    await open();
    select('profile');
    select('delete');
    assert.equal(menu.title, getTestTranslation('torst_profile_delete_confirm'));
    select('cancel');
    assert.equal((TorstApi.deleteProfile as any).mock.callCount(), 0);
    select('delete');
    select('confirm');
    await flush();
    assert.equal((TorstApi.deleteProfile as any).mock.callCount(), 1);
    assert.equal(instance.profileId, undefined);
  });

  it('clears a successfully deleted profile after another overlay takes focus without reopening the picker', async () => {
    let controller = { controller: {}, name: 'select' };
    (globalThis as any).Lampa.Controller = { enabled: () => controller };
    let finish!: () => void;
    mock.method(TorstApi, 'deleteProfile', () => new Promise<void>(resolve => { finish = resolve; }));
    await open();
    select('profile');
    select('delete');
    select('confirm');
    const previousMenu = menu;
    controller = { controller: {}, name: 'search' };
    finish();
    await flush();
    assert.equal(instance.profileId, undefined);
    assert.equal(instance.profileName, undefined);
    assert.equal((InstanceManager.updateInstance as any).mock.callCount(), 1);
    assert.equal(menu, previousMenu);
    assert.equal(backs, 0);
    assert.deepEqual(notices, []);
  });

  for (const selection of ['prf_sam', undefined]) {
    it(`preserves a newer ${selection ? 'Torst profile selection' : 'local progress selection'} when deletion completes`, async () => {
      let finish!: () => void;
      mock.method(TorstApi, 'deleteProfile', () => new Promise<void>(resolve => { finish = resolve; }));
      await open();
      select('profile');
      select('delete');
      select('confirm');
      instance.profileId = selection;
      instance.profileName = selection ? 'Sam' : undefined;
      finish();
      await flush();
      assert.equal(instance.profileId, selection);
      assert.equal(instance.profileName, selection ? 'Sam' : undefined);
      assert.equal((InstanceManager.updateInstance as any).mock.callCount(), 0);
    });
  }

  it('reconciles deletion against the current pool record without overwriting newer instance fields', async () => {
    let finish!: () => void;
    mock.method(TorstApi, 'deleteProfile', () => new Promise<void>(resolve => { finish = resolve; }));
    await open();
    select('profile');
    select('delete');
    select('confirm');
    const currentInstance = { ...instance, name: 'Updated Instance', password: 'updated-password' };
    mock.method(InstanceManager, 'getInstances', () => [currentInstance]);
    const previousMenu = menu;
    finish();
    await flush();
    assert.equal(currentInstance.profileId, undefined);
    assert.equal(currentInstance.profileName, undefined);
    assert.equal(currentInstance.name, 'Updated Instance');
    assert.equal(currentInstance.password, 'updated-password');
    assert.equal(instance.profileId, 'prf_alex');
    assert.equal((InstanceManager.updateInstance as any).mock.calls[0].arguments[0], currentInstance);
    assert.equal(menu, previousMenu);
    assert.equal(backs, 0);
  });

  for (const change of ['navigation', 'new picker']) {
    it(`clears a deleted selection when ${change === 'navigation' ? 'navigating away' : 'a new picker opens'} without replacing the current view`, async () => {
      let activity = {};
      (globalThis as any).Lampa.Activity = { active: () => activity };
      let finish!: () => void;
      mock.method(TorstApi, 'deleteProfile', () => new Promise<void>(resolve => {
        finish = () => { profiles = profiles.filter(profile => profile.id !== 'prf_alex'); resolve(); };
      }));
      await open();
      select('profile');
      select('delete');
      select('confirm');
      if (change === 'navigation') activity = {};
      else await open();
      const currentMenu = menu;
      finish();
      await flush();
      assert.equal(instance.profileId, undefined);
      assert.equal((InstanceManager.updateInstance as any).mock.callCount(), 1);
      assert.equal(menu, currentMenu);
      assert.equal(backs, 0);
      if (change === 'new picker') {
        menu.onSelect(menu.items.find((item: any) => item.data?.id === 'prf_alex'));
        await flush();
        assert.equal(instance.profileId, undefined);
        assert.ok(!menu.items.some((item: any) => item.data?.id === 'prf_alex'));
        assert.equal((InstanceManager.updateInstance as any).mock.callCount(), 1);
      }
    });
  }

  it('rejects Use from an actions menu opened before its profile deletion completed', async () => {
    let finish!: () => void;
    mock.method(TorstApi, 'deleteProfile', () => new Promise<void>(resolve => {
      finish = () => { profiles = profiles.filter(profile => profile.id !== 'prf_alex'); resolve(); };
    }));
    await open();
    select('profile');
    select('delete');
    select('confirm');
    await open();
    select('profile');
    const actions = menu;
    finish();
    await flush();
    assert.equal(menu, actions);
    select('use');
    await flush();
    assert.equal(instance.profileId, undefined);
    assert.ok(!menu.items.some((item: any) => item.data?.id === 'prf_alex'));
    assert.equal((InstanceManager.updateInstance as any).mock.callCount(), 1);
    assert.equal(backs, 0);
  });

  it('retries a profile list read that overlapped a successful deletion', async () => {
    let finishDelete!: () => void;
    mock.method(TorstApi, 'deleteProfile', () => new Promise<void>(resolve => {
      finishDelete = () => { profiles = []; resolve(); };
    }));
    await open();
    select('profile');
    select('delete');
    select('confirm');
    const staleProfiles = [...profiles];
    let finishRead!: (value: TorstProfile[]) => void;
    let reads = 0;
    mock.method(TorstApi, 'getProfiles', async () => ++reads === 1 ? new Promise<TorstProfile[]>(resolve => { finishRead = resolve; }) : profiles);
    const opening = open();
    finishDelete();
    await flush();
    finishRead(staleProfiles);
    await opening;
    assert.equal(reads, 2);
    assert.ok(!menu.items.some((item: any) => item.data?.id === 'prf_alex'));
    assert.equal(instance.profileId, undefined);
  });

  it('releases stale avatars and refreshes the list when deletion completes during image loading', async () => {
    let finishDelete!: () => void;
    mock.method(TorstApi, 'deleteProfile', () => new Promise<void>(resolve => {
      finishDelete = () => { profiles = profiles.filter(profile => profile.id !== 'prf_alex'); resolve(); };
    }));
    await open();
    select('profile');
    select('delete');
    select('confirm');
    profiles.push({ avatar: { updated_at: '2026-10-26' }, id: 'prf_sam', name: 'Sam' });
    (globalThis as any).Image = undefined;
    let finishAvatar!: (value: Blob) => void;
    let requests = 0;
    mock.method(TorstApi, 'getProfileAvatar', async () => ++requests === 1 ? new Promise<Blob>(resolve => { finishAvatar = resolve; }) : new Blob(['image'], { type: 'image/png' }));
    let imageUrls = 0;
    mock.method(URL, 'createObjectURL', () => `blob:avatar-${++imageUrls}`);
    const revoke = mock.method(URL, 'revokeObjectURL', () => {});
    const opening = open();
    await flush();
    finishDelete();
    await flush();
    finishAvatar(new Blob(['image'], { type: 'image/png' }));
    await opening;
    assert.equal(requests, 2);
    assert.deepEqual(revoke.mock.calls[0].arguments, ['blob:avatar-1']);
    assert.ok(!menu.items.some((item: any) => item.data?.id === 'prf_alex'));
    assert.equal(menu.items.find((item: any) => item.data?.id === 'prf_sam').thumbnail, 'blob:avatar-2');
  });

  it('keeps newer picker actions usable when the pending deletion fails', async () => {
    profiles.push({ avatar: null, id: 'prf_sam', name: 'Sam' });
    let fail!: (error: Error) => void;
    mock.method(TorstApi, 'deleteProfile', () => new Promise<void>((_resolve, reject) => { fail = reject; }));
    await open();
    select('profile');
    select('delete');
    select('confirm');
    await open();
    menu.onSelect(menu.items.find((item: any) => item.data?.id === 'prf_sam'));
    fail(new Error('offline'));
    await flush();
    select('use');
    assert.equal(instance.profileId, 'prf_sam');
    assert.equal((InstanceManager.updateInstance as any).mock.callCount(), 1);
    assert.deepEqual(notices, []);
  });

  it('does not treat the same profile ID on another instance as deleted', async () => {
    const second = { ...instance, id: 'two', profileName: 'Taylor', url: 'http://two.test' };
    mock.method(InstanceManager, 'getInstances', () => [instance, second]);
    mock.method(TorstApi, 'getProfiles', async (source: TorstInstance) => source.id === instance.id ? profiles : [{ avatar: null, id: 'prf_alex', name: 'Taylor' }]);
    let finish!: () => void;
    mock.method(TorstApi, 'deleteProfile', () => new Promise<void>(resolve => {
      finish = () => { profiles = []; resolve(); };
    }));
    await open();
    select('profile');
    select('delete');
    select('confirm');
    await ProfilesUi.show(second, () => {});
    finish();
    await flush();
    select('profile');
    select('use');
    assert.equal(instance.profileId, undefined);
    assert.equal(second.profileId, 'prf_alex');
    assert.equal(second.profileName, 'Taylor');
    assert.equal((InstanceManager.updateInstance as any).mock.calls[1].arguments[0], second);
  });

  it('does not discard a profile rename because deletion finished on a different instance', async () => {
    const second = { ...instance, id: 'two', profileName: 'Taylor', url: 'http://two.test' };
    mock.method(InstanceManager, 'getInstances', () => [instance, second]);
    mock.method(TorstApi, 'getProfiles', async (source: TorstInstance) => source.id === instance.id ? profiles : [{ avatar: null, id: 'prf_alex', name: 'Taylor' }]);
    let finish!: () => void;
    mock.method(TorstApi, 'deleteProfile', () => new Promise<void>(resolve => { finish = resolve; }));
    await open();
    select('profile');
    select('delete');
    select('confirm');
    await ProfilesUi.show(second, () => {});
    select('profile');
    select('rename');
    finish();
    await flush();
    inputCallback('Taylor Updated');
    await flush();
    assert.equal(second.profileName, 'Taylor Updated');
    assert.equal((TorstApi.renameProfile as any).mock.callCount(), 1);
    assert.equal((TorstApi.renameProfile as any).mock.calls[0].arguments[0], second);
  });

  it('does not apply a profile list to an instance record that has been replaced', async () => {
    let finish!: (value: TorstProfile[]) => void;
    mock.method(TorstApi, 'getProfiles', () => new Promise<TorstProfile[]>(resolve => { finish = resolve; }));
    const opening = open();
    const current = { ...instance, password: 'updated-password' };
    mock.method(InstanceManager, 'getInstances', () => [current]);
    finish([{ avatar: null, id: 'prf_alex', name: 'Alex Updated' }]);
    await opening;
    assert.equal(menu, undefined);
    assert.equal(current.profileName, 'Alex');
    assert.equal(current.password, 'updated-password');
    assert.equal((InstanceManager.updateInstance as any).mock.callCount(), 0);
  });

  for (const action of ['none', 'use']) {
    it(`does not apply ${action === 'none' ? 'local mode' : 'a profile selection'} from an obsolete instance menu`, async () => {
      await open();
      if (action === 'use') select('profile');
      const previousMenu = menu;
      const current = { ...instance, name: 'Updated Instance', password: 'updated-password', profileId: 'prf_sam', profileName: 'Sam' };
      mock.method(InstanceManager, 'getInstances', () => [current]);
      select(action);
      assert.equal(current.profileId, 'prf_sam');
      assert.equal(current.password, 'updated-password');
      assert.equal((InstanceManager.updateInstance as any).mock.callCount(), 0);
      assert.equal(menu, previousMenu);
      assert.equal(backs, 1);
    });
  }

  for (const action of ['create', 'rename']) {
    it(`does not submit ${action} from an input whose instance target has changed`, async () => {
      await open();
      if (action === 'rename') select('profile');
      select(action);
      if (action === 'create') instance.url = 'http://other.test';
      else mock.method(InstanceManager, 'getInstances', () => [{ ...instance, password: 'updated-password' }]);
      inputCallback('New Name');
      await flush();
      const request = action === 'create' ? TorstApi.createProfile : TorstApi.renameProfile;
      assert.equal((request as any).mock.callCount(), 0);
      assert.equal((InstanceManager.updateInstance as any).mock.callCount(), 0);
      assert.equal(backs, 1);
    });
  }

  it('does not confirm deletion against an instance URL changed while its menu was open', async () => {
    await open();
    select('profile');
    select('delete');
    instance.url = 'http://other.test';
    select('confirm');
    await flush();
    assert.equal((TorstApi.deleteProfile as any).mock.callCount(), 0);
    assert.equal(backs, 1);
  });

  it('does not reopen actions for an instance removed while the confirmation was open', async () => {
    await open();
    select('profile');
    select('delete');
    const confirmation = menu;
    mock.method(InstanceManager, 'getInstances', () => []);
    menu.onBack();
    assert.equal(menu, confirmation);
    assert.equal(backs, 1);
    assert.equal((TorstApi.deleteProfile as any).mock.callCount(), 0);
  });

  for (const change of ['removed', 'changed URL']) {
    it(`leaves instance state untouched after ${change === 'removed' ? 'its removal' : 'its URL changes'} while deletion is pending`, async () => {
      let finish!: () => void;
      mock.method(TorstApi, 'deleteProfile', () => new Promise<void>(resolve => { finish = resolve; }));
      await open();
      select('profile');
      select('delete');
      select('confirm');
      if (change === 'removed') mock.method(InstanceManager, 'getInstances', () => []);
      else instance.url = 'http://other.test';
      finish();
      await flush();
      assert.equal(instance.profileId, 'prf_alex');
      assert.equal((InstanceManager.updateInstance as any).mock.callCount(), 0);
      assert.equal(backs, 0);
    });
  }

  it('keeps the selection after a deletion failure when another overlay has taken focus', async () => {
    let controller = { controller: {}, name: 'select' };
    (globalThis as any).Lampa.Controller = { enabled: () => controller };
    let fail!: (error: Error) => void;
    mock.method(TorstApi, 'deleteProfile', () => new Promise<void>((_resolve, reject) => { fail = reject; }));
    await open();
    select('profile');
    select('delete');
    select('confirm');
    controller = { controller: {}, name: 'search' };
    fail(new Error('offline'));
    await flush();
    assert.equal(instance.profileId, 'prf_alex');
    assert.equal((InstanceManager.updateInstance as any).mock.callCount(), 0);
    assert.deepEqual(notices, []);
    assert.equal(backs, 0);
  });

  it('does not write an unchanged name when leaving the rename input', async () => {
    await open();
    select('profile');
    select('rename');
    inputCallback('Alex');
    await flush();
    assert.equal((TorstApi.renameProfile as any).mock.callCount(), 0);
    assert.ok(menu.items.some((item: any) => item.action === 'use'));
  });

  it('refreshes the selected profile name after it was renamed on another client', async () => {
    profiles[0].name = 'Alex Updated';
    await open();
    assert.equal(instance.profileId, 'prf_alex');
    assert.equal(instance.profileName, 'Alex Updated');
    assert.equal((InstanceManager.updateInstance as any).mock.callCount(), 1);
    assert.equal(menu.items[1].title, 'Alex Updated');
  });

  it('keeps the selection after a rejected deletion and reports read failures', async () => {
    mock.method(TorstApi, 'deleteProfile', async () => { throw new Error('Last profile'); });
    await open();
    select('profile');
    select('delete');
    select('confirm');
    await flush();
    assert.equal(instance.profileId, 'prf_alex');
    assert.ok(notices[0].includes('Last profile'));
    mock.method(TorstApi, 'getProfiles', async () => { throw new Error('offline'); });
    await open();
    assert.ok(notices[1].includes('offline'));
    assert.equal(backs, 1);
  });

  it('loads authenticated avatar thumbnails, falls back for missing images, and releases image URLs', async () => {
    profiles = [{ avatar: { updated_at: '2026-10-25' }, id: 'prf_alex', name: 'Alex' }, { avatar: null, id: 'prf_sam', name: 'Sam' }];
    (globalThis as any).Image = undefined;
    const avatar = mock.method(TorstApi, 'getProfileAvatar', async () => new Blob(['image'], { type: 'image/png' }));
    mock.method(URL, 'createObjectURL', () => 'blob:profile-avatar');
    const revoke = mock.method(URL, 'revokeObjectURL', () => {});
    await open();
    assert.equal(avatar.mock.callCount(), 1);
    assert.equal(menu.items[1].thumbnail, 'blob:profile-avatar');
    assert.ok(menu.items[2].thumbnail.startsWith('data:image/svg+xml,'));
    menu.onBack();
    assert.equal(revoke.mock.calls[0].arguments[0], 'blob:profile-avatar');
    assert.equal(backs, 1);
  });

  it('uses a fallback when avatar data cannot be decoded or fetched', async () => {
    profiles[0].avatar = { updated_at: '2026-10-25' };
    (globalThis as any).Image = class {
      onerror?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onerror?.()); }
    };
    mock.method(TorstApi, 'getProfileAvatar', async () => new Blob(['image'], { type: 'image/png' }));
    await open();
    assert.ok(menu.items[1].thumbnail.startsWith('data:image/svg+xml,'));
    mock.method(TorstApi, 'getProfileAvatar', async () => { throw new Error('offline'); });
    await open();
    assert.ok(menu.items[1].thumbnail.startsWith('data:image/svg+xml,'));
  });

  it('escapes incomplete markup and template placeholders in profile names', async () => {
    profiles[0].name = 'Alex <img src=x {size} $&';
    await open();
    assert.equal(menu.items[1].title, 'Alex &lt;img src=x &#123;size} $$&amp;');
  });

  it('does not open a delayed profile list after leaving its activity or changing its URL', async () => {
    let activity = {};
    (globalThis as any).Lampa.Activity = { active: () => activity };
    let resolve!: (profiles: TorstProfile[]) => void;
    mock.method(TorstApi, 'getProfiles', () => new Promise<TorstProfile[]>(done => { resolve = done; }));
    const first = open();
    activity = {};
    resolve(profiles);
    await first;
    assert.equal(menu, undefined);
    const second = open();
    instance.url = 'http://other.test';
    resolve(profiles);
    await second;
    assert.equal(menu, undefined);
    assert.equal(backs, 0);
  });

  it('does not replace a newer menu when a profile creation finishes', async () => {
    let resolve!: (profile: TorstProfile) => void;
    mock.method(TorstApi, 'createProfile', () => new Promise<TorstProfile>(done => { resolve = done; }));
    await open();
    select('create');
    inputCallback('Sam');
    await open();
    const currentMenu = menu;
    resolve({ id: 'prf_sam', name: 'Sam' });
    await flush();
    assert.equal(instance.profileId, 'prf_alex');
    assert.equal(menu, currentMenu);
  });

  it('does not reopen or change the selected profile after navigating away during creation', async () => {
    let activity = {};
    (globalThis as any).Lampa.Activity = { active: () => activity };
    let resolve!: (profile: TorstProfile) => void;
    mock.method(TorstApi, 'createProfile', () => new Promise<TorstProfile>(done => { resolve = done; }));
    await open();
    select('create');
    inputCallback('Sam');
    const previousMenu = menu;
    activity = {};
    resolve({ id: 'prf_sam', name: 'Sam' });
    await flush();
    assert.equal(instance.profileId, 'prf_alex');
    assert.equal(menu, previousMenu);
    assert.equal((InstanceManager.updateInstance as any).mock.callCount(), 0);
  });

  it('discards a profile list whose instance was removed while it loaded', async () => {
    let finish!: (value: TorstProfile[]) => void;
    mock.method(TorstApi, 'getProfiles', () => new Promise<TorstProfile[]>(resolve => { finish = resolve; }));
    const opening = open();
    mock.method(InstanceManager, 'getInstances', () => []);
    finish(profiles);
    await opening;
    assert.equal(menu, undefined);
  });

  it('does not select a newly created profile or reopen its menu after another overlay takes focus', async () => {
    let controller = { controller: {}, name: 'head' };
    (globalThis as any).Lampa.Controller = { enabled: () => controller };
    let finish!: (profile: TorstProfile) => void;
    mock.method(TorstApi, 'createProfile', () => new Promise<TorstProfile>(resolve => { finish = resolve; }));
    await open();
    select('create');
    inputCallback('Sam');
    const previousMenu = menu;
    controller = { controller: {}, name: 'search' };
    finish({ id: 'prf_sam', name: 'Sam' });
    await flush();
    assert.equal(instance.profileId, 'prf_alex');
    assert.equal(menu, previousMenu);
    assert.equal((InstanceManager.updateInstance as any).mock.callCount(), 0);
    assert.deepEqual(notices, []);
  });
});
