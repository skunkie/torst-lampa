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
    (ProfilesUi as any).clearAvatars();
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
    assert.equal(instance.profileId, 'prf_sam');
    assert.equal(menu, currentMenu);
  });
});
