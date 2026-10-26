// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { TorstApi } from '../src/api/torst';
import { InstanceManager } from '../src/instances/instance-manager';
import { TorstInstance, TorstProfile } from '../src/types/torst';
import { ProfileHeaderUi } from '../src/ui/profile-header';
import { ProfilesUi } from '../src/ui/profiles';
import { createTestLanguage, getTestTranslation } from './support/translations';

describe('Torst profile header button', () => {
  const originalLampa = (globalThis as any).Lampa;
  const originalImage = (globalThis as any).Image;
  const originalShowProfiles = ProfilesUi.show;
  let instances: TorstInstance[];
  let activity: object;
  let controller: { controller: object, name: string };
  let activate: () => void;
  let menu: any;
  let attributes: Map<string, string>;
  let classes: Set<string>;
  let focused: string[];
  let notices: string[];
  const flush = () => new Promise(resolve => setImmediate(resolve));

  beforeEach(() => {
    (ProfileHeaderUi as any).isRegistered = false;
    activity = {};
    controller = { controller: {}, name: 'head' };
    instances = [{ authType: 'none', id: 'one', name: 'One', profileId: 'prf_alex', profileName: 'Alex', url: 'http://one.test' }];
    menu = undefined;
    attributes = new Map();
    classes = new Set();
    focused = [];
    notices = [];
    const button = {
      addClass: (name: string) => { classes.add(name); return button; },
      attr: (name: string, value: string) => { attributes.set(name, value); return button; },
    };
    (globalThis as any).Lampa = {
      Activity: { active: () => activity },
      Controller: {
        enabled: () => controller,
        toggle: (name: string) => { controller = { controller: {}, name }; focused.push(name); },
      },
      Head: { addIcon: (_icon: string, callback: () => void) => { activate = callback; return button; } },
      Lang: createTestLanguage(),
      Noty: { show: (message: string) => notices.push(message) },
      Select: { show: (options: any) => { controller = { controller: {}, name: 'select' }; menu = options; } },
      Utils: { clearHtmlTags: (text: string) => text.replace(/<[^>]*>/g, '') },
    };
    mock.method(InstanceManager, 'getInstances', () => instances);
    mock.method(InstanceManager, 'getPrimaryInstance', () => instances[0]);
    mock.method(ProfilesUi, 'show', async () => {});
  });
  afterEach(() => {
    (ProfilesUi as any).invalidateMenuContext();
    mock.restoreAll();
    ProfilesUi.show = originalShowProfiles;
    (ProfileHeaderUi as any).isRegistered = false;
    (globalThis as any).Lampa = originalLampa;
    (globalThis as any).Image = originalImage;
  });

  it('registers one native head action with an accessible translated label', () => {
    const addIcon = mock.method((globalThis as any).Lampa.Head, 'addIcon');
    ProfileHeaderUi.init();
    ProfileHeaderUi.init();
    assert.equal(addIcon.mock.callCount(), 1);
    const icon = addIcon.mock.calls[0].arguments[0];
    assert.ok(icon.includes('fill="currentColor"'));
    assert.ok(icon.includes('stroke="currentColor"'));
    assert.ok(!icon.includes('="white"'));
    assert.ok(classes.has('torst-profile-button'));
    assert.equal(attributes.get('aria-label'), getTestTranslation('torst_profiles_title'));
    assert.equal(attributes.get('title'), getTestTranslation('torst_profiles_title'));
    assert.equal(attributes.get('role'), 'button');
  });

  it('waits for a supported native head API before marking the button installed', () => {
    const head = (globalThis as any).Lampa.Head;
    delete (globalThis as any).Lampa.Head;
    assert.doesNotThrow(() => ProfileHeaderUi.init());
    (globalThis as any).Lampa.Head = { title: () => {} };
    assert.doesNotThrow(() => ProfileHeaderUi.init());
    (globalThis as any).Lampa.Head = head;
    const addIcon = mock.method(head, 'addIcon');
    ProfileHeaderUi.init();
    assert.equal(addIcon.mock.callCount(), 1);
  });

  it('opens the sole instance directly and returns focus to the native head controller', async () => {
    ProfileHeaderUi.init();
    activate();
    await flush();
    const call = (ProfilesUi.show as any).mock.calls[0];
    assert.equal(call.arguments[0], instances[0]);
    assert.equal(menu, undefined);
    call.arguments[1]();
    assert.deepEqual(focused, ['head']);
    assert.equal((InstanceManager.getPrimaryInstance as any).mock.callCount(), 0);
  });

  it('lets the user choose an instance and shows its current profile or local progress mode', async () => {
    instances.push({ authType: 'none', id: 'two', name: 'Two', url: 'http://two.test' });
    ProfileHeaderUi.init();
    activate();
    assert.equal(menu.title, getTestTranslation('torst_profile_instance_title'));
    assert.notEqual(menu.title, getTestTranslation('torst_profiles_title'));
    assert.equal(menu.items[0].subtitle, 'Alex');
    assert.equal(menu.items[0].selected, true);
    assert.equal(menu.items[1].subtitle, getTestTranslation('torst_profile_local'));
    menu.onSelect(menu.items[1]);
    await flush();
    assert.equal((ProfilesUi.show as any).mock.calls[0].arguments[0], instances[1]);
  });

  it('escapes instance and profile names before passing them to Lampa templates', () => {
    instances[0].name = 'One <img src=x {size} $&';
    instances[0].profileName = 'Alex <img src=x {size} $&';
    instances.push({ authType: 'none', id: 'two', name: 'Two', url: 'http://two.test' });
    ProfileHeaderUi.init();
    activate();
    assert.equal(menu.items[0].title, 'One &lt;img src=x &#123;size} $$&amp;');
    assert.equal(menu.items[0].subtitle, 'Alex &lt;img src=x &#123;size} $$&amp;');
  });

  it('restores head focus when canceling instance selection', () => {
    instances.push({ authType: 'none', id: 'two', name: 'Two', url: 'http://two.test' });
    ProfileHeaderUi.init();
    activate();
    menu.onBack();
    assert.deepEqual(focused, ['head']);
  });

  it('ignores stale selections and return callbacks after navigation', async () => {
    ProfileHeaderUi.init();
    activate();
    await flush();
    const onBack = (ProfilesUi.show as any).mock.calls[0].arguments[1];
    activity = {};
    onBack();
    assert.deepEqual(focused, []);
    instances.push({ authType: 'none', id: 'two', name: 'Two', url: 'http://two.test' });
    activate();
    activity = {};
    menu.onSelect(menu.items[0]);
    assert.equal((ProfilesUi.show as any).mock.callCount(), 1);
  });

  it('resolves the selected instance again and ignores one that has been removed', async () => {
    instances.push({ authType: 'none', id: 'two', name: 'Two', url: 'http://two.test' });
    ProfileHeaderUi.init();
    activate();
    const selected = menu.items[1];
    instances[1] = { ...instances[1], profileId: 'prf_sam', profileName: 'Sam' };
    menu.onSelect(selected);
    await flush();
    assert.equal((ProfilesUi.show as any).mock.calls[0].arguments[0], instances[1]);
    instances.pop();
    menu.onSelect(selected);
    assert.equal((ProfilesUi.show as any).mock.callCount(), 1);
    assert.deepEqual(focused, ['head']);
  });

  it('handles an empty pool and profile picker failures without losing head focus', async () => {
    ProfileHeaderUi.init();
    const instance = instances[0];
    instances = [];
    activate();
    assert.deepEqual(notices, [getTestTranslation('torst_noty_no_instances')]);
    instances = [instance];
    mock.method(ProfilesUi, 'show', async () => { throw new Error('offline'); });
    activate();
    await flush();
    assert.ok(notices[1].includes('offline'));
    assert.deepEqual(focused, ['head', 'head']);
  });

  it('does not open the real picker after settings, search, or content takes focus during loading', async () => {
    mock.method(ProfilesUi, 'show', originalShowProfiles);
    let finish!: (profiles: TorstProfile[]) => void;
    mock.method(TorstApi, 'getProfiles', () => new Promise<TorstProfile[]>(resolve => { finish = resolve; }));
    ProfileHeaderUi.init();
    for (const name of ['settings_component', 'search', 'content']) {
      controller = { controller: {}, name: 'head' };
      activate();
      const overlay = { controller: {}, name };
      controller = overlay;
      finish([{ avatar: null, id: 'prf_alex', name: 'Alex' }]);
      await flush();
      assert.equal(menu, undefined);
      assert.equal(controller, overlay);
    }
    assert.deepEqual(focused, []);
  });

  it('distinguishes another select controller while loading profiles for a chosen instance', async () => {
    mock.method(ProfilesUi, 'show', originalShowProfiles);
    instances.push({ authType: 'none', id: 'two', name: 'Two', url: 'http://two.test' });
    let finish!: (profiles: TorstProfile[]) => void;
    mock.method(TorstApi, 'getProfiles', () => new Promise<TorstProfile[]>(resolve => { finish = resolve; }));
    ProfileHeaderUi.init();
    activate();
    const instanceMenu = menu;
    menu.onSelect(menu.items[1]);
    const overlay = { controller: {}, name: 'select' };
    controller = overlay;
    finish([{ avatar: null, id: 'prf_alex', name: 'Alex' }]);
    await flush();
    assert.equal(menu, instanceMenu);
    assert.equal(controller, overlay);
    assert.deepEqual(focused, []);
  });

  it('does not restore head focus or show a stale error after an overlay opens', async () => {
    mock.method(ProfilesUi, 'show', originalShowProfiles);
    let fail!: (error: Error) => void;
    mock.method(TorstApi, 'getProfiles', () => new Promise<TorstProfile[]>((_resolve, reject) => { fail = reject; }));
    ProfileHeaderUi.init();
    activate();
    const overlay = { controller: {}, name: 'settings_component' };
    controller = overlay;
    fail(new Error('offline'));
    await flush();
    assert.equal(menu, undefined);
    assert.equal(controller, overlay);
    assert.deepEqual(focused, []);
    assert.deepEqual(notices, []);
  });

  it('releases loaded avatars when another overlay opens during image loading', async () => {
    mock.method(ProfilesUi, 'show', originalShowProfiles);
    (globalThis as any).Image = undefined;
    mock.method(TorstApi, 'getProfiles', async () => [{ avatar: { updated_at: '2026-10-26' }, id: 'prf_alex', name: 'Alex' }]);
    let finish!: (avatar: Blob) => void;
    mock.method(TorstApi, 'getProfileAvatar', () => new Promise<Blob>(resolve => { finish = resolve; }));
    mock.method(URL, 'createObjectURL', () => 'blob:avatar');
    const revoke = mock.method(URL, 'revokeObjectURL', () => {});
    ProfileHeaderUi.init();
    activate();
    await flush();
    const overlay = { controller: {}, name: 'search' };
    controller = overlay;
    finish(new Blob(['image'], { type: 'image/png' }));
    await flush();
    assert.equal(menu, undefined);
    assert.equal(controller, overlay);
    assert.deepEqual(revoke.mock.calls[0].arguments, ['blob:avatar']);
    assert.deepEqual(focused, []);
  });

  it('still opens the real picker and restores head focus when it closes normally', async () => {
    mock.method(ProfilesUi, 'show', originalShowProfiles);
    mock.method(TorstApi, 'getProfiles', async () => [{ avatar: null, id: 'prf_alex', name: 'Alex' }]);
    ProfileHeaderUi.init();
    activate();
    await flush();
    assert.equal(menu.title, getTestTranslation('torst_profiles_title'));
    assert.equal(controller.name, 'select');
    menu.onBack();
    assert.equal(controller.name, 'head');
    assert.deepEqual(focused, ['head']);
  });
});
