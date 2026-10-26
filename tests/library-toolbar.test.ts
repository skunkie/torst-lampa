// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { TorstApi } from '../src/api/torst';
import { SavedTorrents } from '../src/engine/saved-torrents';
import { InstanceManager } from '../src/instances/instance-manager';
import { TorstInstance } from '../src/types/torst';
import { TorstTorrentsComponent } from '../src/ui/torst-torrents';
import { UpNextUi } from '../src/ui/up-next';
import { createTestLanguage, getTestTranslation } from './support/translations';

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
    text: (value: string) => { wrapper.textValue = value; return wrapper; },
  };
  node.wrapper = wrapper;
  return wrapper;
}

describe('Torst library toolbar', () => {
  const loadLibrary = TorstTorrentsComponent.prototype.load;
  const originalLampa = (globalThis as any).Lampa;
  const originalJquery = (globalThis as any).$;
  const originalNavigator = (globalThis as any).Navigator;
  const instance: TorstInstance = { authType: 'none', id: 'one', name: 'One', url: 'http://torst.test' };
  let component: TorstTorrentsComponent;
  let focused: any;
  let collectionRoot: any;
  let nativeEmptyStarts: number;
  let notices: string[];
  let activeController: string;

  beforeEach(() => {
    focused = null;
    activeController = 'content';
    notices = [];
    nativeEmptyStarts = 0;
    (globalThis as any).$ = (value: any) => typeof value === 'object' ? value.wrapper || value : element(value);
    (globalThis as any).Navigator = { focused: (value: any) => { focused = value; }, getFocusedElement: () => focused };
    (globalThis as any).Lampa = {
      Controller: {
        add: () => {},
        collectionFocus: () => {},
        collectionSet: (root: any) => { collectionRoot = root; focused = null; },
        enabled: () => ({ name: activeController }),
        toggle: (name: string) => { activeController = name; },
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

  it('keeps the Up Next control when the grid is rebuilt', () => {
    const root: any = component.render();
    const toolbar = root[0].children[0];
    assert.ok(toolbar.wrapper.markup.includes('torst-library-toolbar'));
    const button = toolbar.wrapper.find('.torst-library-up-next')[0];
    const torrent = { files: [], hash: 'one', name: 'One', retention: 'persisted' as const, storage: 'memory' as const, total_size: 1 };
    component.renderTorrents([torrent], instance);
    focused = button;
    component.renderTorrents([{ ...torrent, total_size: 2 }], instance, true);
    assert.equal(root[0].children[0], toolbar);
    assert.equal(focused, button);
    assert.equal(collectionRoot, root);
  });

  it('renders only Up Next as a native Lampa button with a translated label', () => {
    const toolbar: any = (component.render() as any)[0].children[0].wrapper;
    assert.ok(toolbar.markup.includes('class="simple-button selector torst-library-up-next"'));
    assert.equal((toolbar.markup.match(/\bselector\b/g) || []).length, 1);
    assert.ok(!toolbar.markup.includes('torst-library-profile'));
    assert.equal(toolbar.find('.torst-library-up-next span').textValue, getTestTranslation('torst_up_next_title'));
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
    const button = toolbar.find('.torst-library-up-next')[0];
    toolbar.find('.selector').events['hover:focus']({ currentTarget: button });
    (component as any).lastFocusedTorrentHash = 'one';
    component.renderTorrents([{ files: [], hash: 'one', name: 'One', retention: 'persisted', storage: 'memory', total_size: 1 }], instance, true);
    assert.equal((component as any).lastFocusedElement, button);
  });

  it('opens Up Next from the toolbar and restores the content controller on Back', async () => {
    let onBack!: () => void;
    const upNext = mock.method(UpNextUi, 'show', async (_instance: TorstInstance, close: () => void) => { onBack = close; });
    const root: any = component.render();
    const toolbar = root[0].children[0].wrapper;
    toolbar.find('.torst-library-up-next').events['hover:enter']();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(upNext.mock.calls[0].arguments[0], instance);
    activeController = 'select';
    onBack();
    assert.equal(activeController, 'content');
  });

  for (const transition of ['pause', 'stop'] as const) {
    it(`restores directional handlers before the library reload completes after ${transition}`, async () => {
      const controllers = new Map<string, any>();
      const genericController = { up: () => { activeController = 'head'; } };
      controllers.set('content', genericController);
      mock.method(Lampa.Controller, 'add', (name: string, controller: any) => { controllers.set(name, controller); });
      mock.method(Lampa.Controller, 'toggle', (name: string) => {
        activeController = name;
        controllers.get(name)?.toggle?.();
      });
      const directions: string[] = [];
      (globalThis as any).Navigator.canmove = () => true;
      (globalThis as any).Navigator.move = (direction: string) => { directions.push(direction); };
      let finish!: () => void;
      const loading = new Promise<void>(resolve => { finish = resolve; });
      mock.method(component, 'load', () => loading);
      const polling = mock.method(component as any, 'startPolling', () => {});

      component[transition]();
      component.start();
      try {
        const controller = controllers.get('content');
        assert.notEqual(controller, genericController);
        for (const direction of ['up', 'down', 'left', 'right']) controller[direction]();
        assert.deepEqual(directions, ['up', 'down', 'left', 'right']);
        assert.equal(activeController, 'content');
        assert.equal(collectionRoot, component.render());
        assert.equal(polling.mock.callCount(), 0);
      } finally {
        finish();
        await loading;
      }
      assert.equal(polling.mock.callCount(), 1);
    });
  }

  for (const outcome of ['populated', 'empty', 'failure']) {
    it(`preserves Up Next focus when a pending reload completes with a ${outcome} result`, async () => {
      const controllers = new Map<string, any>();
      mock.method(Lampa.Controller, 'add', (name: string, controller: any) => { controllers.set(name, controller); });
      mock.method(Lampa.Controller, 'toggle', (name: string) => {
        activeController = name;
        controllers.get(name)?.toggle?.();
      });
      mock.method(InstanceManager, 'getInstances', () => [instance]);
      mock.method(InstanceManager, 'getPrimaryInstance', () => instance);
      mock.method(SavedTorrents, 'syncFromListing', () => {});
      mock.method(TorstApi, 'getSettings', async () => ({}));
      let finish!: () => void;
      const pending = new Promise<any>((resolve, reject) => {
        finish = () => outcome === 'failure'
          ? reject(new Error('Unavailable'))
          : resolve({ torrents: outcome === 'empty' ? [] : [{ files: [], hash: 'one', name: 'One', retention: 'persisted', storage: 'memory', total_size: 1 }] });
      });
      mock.method(TorstApi, 'getTorrents', () => pending);
      const load = mock.method(component, 'load', loadLibrary.bind(component));
      const toggleActivity = mock.fn();
      const loader = mock.fn();
      component.componentActivity = { loader, toggle: toggleActivity } as any;
      let onBack!: () => void;
      mock.method(UpNextUi, 'show', async (_instance: TorstInstance, close: () => void) => {
        activeController = 'select';
        onBack = close;
      });
      component.pause();
      component.start();
      await new Promise(resolve => setImmediate(resolve));
      const toolbar = (component.render() as any)[0].children[0].wrapper;
      toolbar.find('.torst-library-up-next').events['hover:enter']();
      await new Promise(resolve => setImmediate(resolve));
      const overlay = element('Up Next');
      collectionRoot = overlay;
      focused = overlay[0];

      finish();
      await load.mock.calls[0].result;

      assert.equal(activeController, 'select');
      assert.equal(collectionRoot, overlay);
      assert.equal(focused, overlay[0]);
      assert.equal(toggleActivity.mock.callCount(), 0);
      assert.equal(loader.mock.calls[loader.mock.calls.length - 1].arguments[0], false);
      if (outcome === 'populated') assert.equal((component as any).renderedTorrents.length, 1);
      else assert.ok((component as any).emptyState);
      onBack();
      assert.equal(activeController, 'content');
      assert.equal(collectionRoot, component.render());
    });
  }

  it('uses the pinned search instance before its first library load completes', async () => {
    const pinned = { ...instance, id: 'pinned' };
    mock.method(InstanceManager, 'getInstances', () => [pinned]);
    (component as any).searchInstanceId = pinned.id;
    const upNext = mock.method(UpNextUi, 'show', async () => {});
    await (component as any).openUpNext();
    assert.equal(upNext.mock.calls[0].arguments[0], pinned);
    assert.equal((InstanceManager.getBestInstance as any).mock.callCount(), 0);
  });

  for (const change of ['navigation', 'destruction']) {
    it(`does not restore library focus after ${change}`, async () => {
      let activity = {};
      (globalThis as any).Lampa.Activity = { active: () => activity };
      let onBack!: () => void;
      mock.method(UpNextUi, 'show', async (_instance: TorstInstance, close: () => void) => { onBack = close; });
      await (component as any).openUpNext();
      if (change === 'navigation') activity = {};
      else component.destroy();
      activeController = 'select';
      onBack();
      assert.equal(activeController, 'select');
    });
  }

  it('reports an unavailable instance and ignores selection completed after navigation', async () => {
    mock.method(InstanceManager, 'getBestInstance', async () => { throw new Error('offline'); });
    await (component as any).openUpNext();
    assert.ok(notices[0].includes('offline'));
    let activity = {};
    (globalThis as any).Lampa.Activity = { active: () => activity };
    let finish!: (value: TorstInstance) => void;
    mock.method(InstanceManager, 'getBestInstance', () => new Promise<TorstInstance>(resolve => { finish = resolve; }));
    const show = mock.method(UpNextUi, 'show', async () => {});
    const opening = (component as any).openUpNext();
    activity = {};
    finish(instance);
    await opening;
    assert.equal(show.mock.callCount(), 0);
  });
});
