// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { InstanceManager } from '../src/instances/instance-manager';
import { TorstInstance } from '../src/types/torst';
import { ProfilesUi } from '../src/ui/profiles';
import { TorstTorrentsComponent } from '../src/ui/torst-torrents';
import { UpNextUi } from '../src/ui/up-next';
import { createTestLanguage } from './support/translations';

function element(markup = ''): any {
  const classes = new Set<string>();
  const node: any = {
    children: [],
    classList: { add: (name: string) => classes.add(name), contains: (name: string) => classes.has(name), remove: (name: string) => classes.delete(name) },
    contains(target: any): boolean { return target === node || node.children.some((child: any) => child.contains(target)); },
    isConnected: true,
    parentNode: null,
  };
  const events: Record<string, () => void> = {};
  const found = new Map<string, any>();
  const wrapper: any = {
    0: node,
    addClass: () => wrapper,
    append: (child: any) => {
      const childNode = child[0] || child;
      node.children.push(childNode);
      childNode.parentNode = node;
      return wrapper;
    },
    attr: () => wrapper,
    before: () => wrapper,
    empty: () => { node.children.forEach((child: any) => { child.parentNode = null; }); node.children = []; return wrapper; },
    events,
    find: (selector: string) => {
      if (!found.has(selector)) {
        const child = element(selector);
        found.set(selector, child);
        wrapper.append(child);
      }
      return found.get(selector);
    },
    length: 1,
    markup,
    on: (name: string, callback: () => void) => { events[name] = callback; return wrapper; },
    remove: () => wrapper,
    removeClass: () => wrapper,
    text: (_value: string) => wrapper,
  };
  node.wrapper = wrapper;
  return wrapper;
}

describe('Torst library toolbar', () => {
  const originalLampa = (globalThis as any).Lampa;
  const originalJquery = (globalThis as any).$;
  const originalNavigator = (globalThis as any).Navigator;
  const instance: TorstInstance = { authType: 'none', id: 'one', name: 'One', url: 'http://torst.test' };
  let component: TorstTorrentsComponent;
  let focused: any;
  let collectionRoot: any;
  let nativeEmptyStarts: number;
  let notices: string[];

  beforeEach(() => {
    focused = null;
    notices = [];
    nativeEmptyStarts = 0;
    (globalThis as any).$ = (value: any) => typeof value === 'object' ? value.wrapper || value : element(value);
    (globalThis as any).Navigator = { focused: (value: any) => { focused = value; }, getFocusedElement: () => focused };
    (globalThis as any).Lampa = {
      Controller: {
        collectionFocus: () => {},
        collectionSet: (root: any) => { collectionRoot = root; focused = null; },
        enabled: () => ({ name: 'content' }),
        toggle: () => {},
      },
      Empty: class {
        destroy() {}
        render() { return element('empty'); }
        start() { nativeEmptyStarts++; }
      },
      Lang: createTestLanguage(),
      Noty: { show: (message: string) => notices.push(message) },
      Scroll: class {
        body = element('scroll');
        append(child: any) { this.body.append(child); }
        clear() { this.body.empty(); }
        destroy() {}
        minus() {}
        nopadding() {}
        render() { return this.body; }
        reset() {}
        update() {}
      },
      Storage: { field: () => true, get: (_key: string, fallback: unknown) => fallback },
      Utils: { bytesToSize: () => '', clearHtmlTags: (text: string) => text },
    };
    mock.method(TorstTorrentsComponent.prototype as any, 'load', async () => {});
    mock.method(InstanceManager, 'getBestInstance', async () => instance);
    mock.method(InstanceManager, 'getInstances', () => []);
    component = new TorstTorrentsComponent();
    component.create();
  });
  afterEach(() => {
    component.destroy();
    mock.restoreAll();
    (globalThis as any).Lampa = originalLampa;
    (globalThis as any).$ = originalJquery;
    (globalThis as any).Navigator = originalNavigator;
  });

  it('keeps profile and Up Next controls when the grid is rebuilt', () => {
    const root: any = component.render();
    const toolbar = root[0].children[0];
    assert.ok(toolbar.wrapper.markup.includes('torst-library-toolbar'));
    const button = toolbar.wrapper.find('.torst-library-profile')[0];
    const torrent = { files: [], hash: 'one', name: 'One', retention: 'persisted' as const, storage: 'memory' as const, total_size: 1 };
    component.renderTorrents([torrent], instance);
    focused = button;
    component.renderTorrents([{ ...torrent, total_size: 2 }], instance, true);
    assert.equal(root[0].children[0], toolbar);
    assert.equal(focused, button);
    assert.equal(collectionRoot, root);
  });

  it('keeps toolbar navigation available when the library is empty', () => {
    const root: any = component.render();
    const toolbar = root[0].children[0];
    component.renderEmptyState('Empty');
    assert.equal(root[0].children[0], toolbar);
    assert.equal(collectionRoot, root);
    assert.equal(nativeEmptyStarts, 0, 'the native empty controller must not replace the toolbar collection');
  });

  it('remembers a toolbar button across a card refresh and menu return', () => {
    const toolbar: any = (component.render() as any)[0].children[0].wrapper;
    const button = toolbar.find('.torst-library-profile')[0];
    toolbar.find('.selector').events['hover:focus']({ currentTarget: button });
    (component as any).lastFocusedTorrentHash = 'one';
    component.renderTorrents([{ files: [], hash: 'one', name: 'One', retention: 'persisted', storage: 'memory', total_size: 1 }], instance, true);
    assert.equal((component as any).lastFocusedElement, button);
  });

  it('opens the selected instance profile picker and Up Next from the toolbar', async () => {
    const profile = mock.method(ProfilesUi, 'show', async () => {});
    const upNext = mock.method(UpNextUi, 'show', async () => {});
    const root: any = component.render();
    const toolbar = root[0].children[0].wrapper;
    toolbar.find('.torst-library-profile').events['hover:enter']();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(profile.mock.calls[0].arguments[0], instance);
    toolbar.find('.torst-library-up-next').events['hover:enter']();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(upNext.mock.calls[0].arguments[0], instance);
  });

  it('uses the pinned search instance before its first library load completes', async () => {
    const pinned = { ...instance, id: 'pinned' };
    mock.method(InstanceManager, 'getInstances', () => [pinned]);
    (component as any).searchInstanceId = pinned.id;
    const profile = mock.method(ProfilesUi, 'show', async () => {});
    await (component as any).openLibraryView(ProfilesUi);
    assert.equal(profile.mock.calls[0].arguments[0], pinned);
    assert.equal((InstanceManager.getBestInstance as any).mock.callCount(), 0);
  });

  it('reports an unavailable instance and ignores selection completed after navigation', async () => {
    mock.method(InstanceManager, 'getBestInstance', async () => { throw new Error('offline'); });
    await (component as any).openLibraryView(ProfilesUi);
    assert.ok(notices[0].includes('offline'));
    let activity = {};
    (globalThis as any).Lampa.Activity = { active: () => activity };
    let finish!: (value: TorstInstance) => void;
    mock.method(InstanceManager, 'getBestInstance', () => new Promise<TorstInstance>(resolve => { finish = resolve; }));
    const show = mock.method(ProfilesUi, 'show', async () => {});
    const opening = (component as any).openLibraryView(ProfilesUi);
    activity = {};
    finish(instance);
    await opening;
    assert.equal(show.mock.callCount(), 0);
  });
});
