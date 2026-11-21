// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  PlayDialog,
  SAVE_TO_LIBRARY_STORAGE_KEY,
  STORAGE_TYPE_STORAGE_KEY,
} from '../src/ui/play-dialog';

describe('PlayDialog', () => {
  const controls = new Map<string, any>();
  const storage = new Map<string, any>();
  let activeController = '';
  let closeCount = 0;
  let modalOptions: any = null;

  beforeEach(() => {
    activeController = '';
    closeCount = 0;
    controls.clear();
    modalOptions = null;
    storage.clear();
    storage.set(SAVE_TO_LIBRARY_STORAGE_KEY, 'ask');
    storage.set(STORAGE_TYPE_STORAGE_KEY, 'ask');

    const createControl = () => {
      const classes = new Set(['selector']);
      const listeners = new Map<string, () => void>();
      let isChecked = false;
      const control: any = {
        addClass: (className: string) => { classes.add(className); return control; },
        classes,
        css: () => control,
        listeners,
        on: (event: string, callback: () => void) => {
          listeners.set(event, callback);
          return control;
        },
        prop: (name: string, value?: boolean) => {
          if (name !== 'checked') return undefined;
          if (value !== undefined) {
            isChecked = value;
            return control;
          }
          return isChecked;
        },
        removeClass: (className: string) => { classes.delete(className); return control; },
        text: () => control,
      };
      return control;
    };

    (globalThis as any).$ = () => ({
      find: (selector: string) => {
        if (!controls.has(selector)) controls.set(selector, createControl());
        return controls.get(selector);
      },
    });
    (globalThis as any).Lampa = {
      Controller: {
        enabled: () => ({ name: 'content' }),
        toggle: (name: string) => {
          activeController = name;
        },
      },
      Modal: {
        close: () => {
          closeCount++;
        },
        open: (options: any) => {
          modalOptions = options;
        },
      },
      Storage: {
        get: (key: string, fallback: any) => storage.has(key) ? storage.get(key) : fallback,
        set: (key: string, value: any) => storage.set(key, value),
      },
      Utils: {
        clearHtmlTags: (value: string) => value,
      },
    };
  });

  it('closes once and restores the launching controller on Back', async () => {
    const resultPromise = PlayDialog.resolveOptions('Movie');

    assert.ok(modalOptions);
    modalOptions.onBack();
    modalOptions.onBack();

    assert.equal(await resultPromise, null);
    assert.equal(closeCount, 1);
    assert.equal(activeController, 'content');
  });

  it('uses one native activation handler for every modal control', async () => {
    const resultPromise = PlayDialog.resolveOptions('Movie');
    const selectors = [
      '.torst-opt-storage',
      '.torst-opt-savelib',
      '.torst-opt-remember',
      '.torst-btn-play',
    ];

    for (const selector of selectors) {
      const events = Array.from(controls.get(selector).listeners.keys());
      assert.deepEqual(events, ['hover:enter']);
    }

    controls.get('.torst-btn-play').listeners.get('hover:enter')();

    assert.deepEqual(await resultPromise, {
      saveToLibrary: false,
      storage: 'memory',
    });
    assert.equal(closeCount, 1);
    assert.equal(activeController, 'content');
  });

  it('toggles Remember choice through the focusable remote control', async () => {
    const resultPromise = PlayDialog.resolveOptions('Movie');
    const rememberControl = controls.get('.torst-opt-remember');
    const rememberCheckbox = controls.get('.torst-opt-remember input');

    rememberControl.listeners.get('hover:enter')();
    assert.equal(rememberCheckbox.prop('checked'), true);

    controls.get('.torst-btn-play').listeners.get('hover:enter')();
    await resultPromise;

    assert.equal(storage.get(STORAGE_TYPE_STORAGE_KEY), 'memory');
    assert.equal(storage.get(SAVE_TO_LIBRARY_STORAGE_KEY), 'false');
  });

  it('removes disabled storage from D-pad navigation and restores it when enabled', async () => {
    const resultPromise = PlayDialog.resolveOptions('Movie');
    const storageControl = controls.get('.torst-opt-storage');
    const saveLibControl = controls.get('.torst-opt-savelib');

    assert.equal(storageControl.classes.has('selector'), false);
    assert.equal(storageControl.classes.has('torst-opt-disabled'), true);

    saveLibControl.listeners.get('hover:enter')();
    assert.equal(storageControl.classes.has('selector'), true);
    assert.equal(storageControl.classes.has('torst-opt-disabled'), false);

    controls.get('.torst-btn-play').listeners.get('hover:enter')();
    await resultPromise;
  });

  it('ignores storage toggle while Save to Library is off, and re-enables it once turned on', async () => {
    const resultPromise = PlayDialog.resolveOptions('Movie');
    assert.ok(modalOptions);

    const storageControl = controls.get('.torst-opt-storage');
    const saveLibControl = controls.get('.torst-opt-savelib');

    // Save to Library defaults to off (storage key is 'ask' in beforeEach) — toggling storage must be a no-op.
    storageControl.listeners.get('hover:enter')();
    saveLibControl.listeners.get('hover:enter')(); // turn Save to Library on
    storageControl.listeners.get('hover:enter')(); // now toggles memory -> file

    controls.get('.torst-btn-play').listeners.get('hover:enter')();

    assert.deepEqual(await resultPromise, {
      saveToLibrary: true,
      storage: 'file',
    });
  });

  it('forces storage back to memory when Save to Library is turned off after selecting file storage', async () => {
    const resultPromise = PlayDialog.resolveOptions('Movie');
    assert.ok(modalOptions);

    const storageControl = controls.get('.torst-opt-storage');
    const saveLibControl = controls.get('.torst-opt-savelib');

    saveLibControl.listeners.get('hover:enter')(); // turn Save to Library on
    storageControl.listeners.get('hover:enter')(); // memory -> file
    saveLibControl.listeners.get('hover:enter')(); // turn Save to Library back off

    controls.get('.torst-btn-play').listeners.get('hover:enter')();

    assert.deepEqual(await resultPromise, {
      saveToLibrary: false,
      storage: 'memory',
    });
  });

  it('defaults library persistence to false in Ask mode unless the user opts in', async () => {
    storage.set(SAVE_TO_LIBRARY_STORAGE_KEY, 'ask');

    const resultPromise = PlayDialog.resolveOptions('Movie');
    assert.ok(modalOptions);

    controls.get('.torst-btn-play').listeners.get('hover:enter')();

    assert.deepEqual(await resultPromise, {
      saveToLibrary: false,
      storage: 'memory',
    });
  });

  it('bypasses modal and returns saveToLibrary=false when setting is false', async () => {
    storage.set(STORAGE_TYPE_STORAGE_KEY, 'memory');
    storage.set(SAVE_TO_LIBRARY_STORAGE_KEY, 'false');

    const result = await PlayDialog.resolveOptions('Movie');
    assert.deepEqual(result, {
      saveToLibrary: false,
      storage: 'memory',
    });
    assert.equal(modalOptions, null);
  });

  it('bypasses modal and returns saveToLibrary=true when setting is true', async () => {
    storage.set(STORAGE_TYPE_STORAGE_KEY, 'file');
    storage.set(SAVE_TO_LIBRARY_STORAGE_KEY, 'true');

    const result = await PlayDialog.resolveOptions('Movie');
    assert.deepEqual(result, {
      saveToLibrary: true,
      storage: 'file',
    });
    assert.equal(modalOptions, null);
  });

  it('initializes modal with shouldSaveToLibrary=false when library setting is false and storage is ask', async () => {
    storage.set(STORAGE_TYPE_STORAGE_KEY, 'ask');
    storage.set(SAVE_TO_LIBRARY_STORAGE_KEY, 'false');

    const resultPromise = PlayDialog.resolveOptions('Movie');
    assert.ok(modalOptions);

    controls.get('.torst-btn-play').listeners.get('hover:enter')();
    assert.deepEqual(await resultPromise, {
      saveToLibrary: false,
      storage: 'memory',
    });
  });

  it('bypasses modal and defaults saveToLibrary to false when storage key is unset', async () => {
    storage.delete(STORAGE_TYPE_STORAGE_KEY);
    storage.delete(SAVE_TO_LIBRARY_STORAGE_KEY);

    const result = await PlayDialog.resolveOptions('Movie');
    assert.deepEqual(result, {
      saveToLibrary: false,
      storage: 'memory',
    });
    assert.equal(modalOptions, null);
  });
});
