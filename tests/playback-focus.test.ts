// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { PlaybackFocus } from '../src/engine/playback-focus';

describe('playback focus', () => {
  const originalLampa = (globalThis as any).Lampa;
  const originalWindow = (globalThis as any).window;
  const originalDocument = (globalThis as any).document;
  let browser: EventTarget;
  let page: EventTarget & { visibilityState: string };
  let listeners: Map<string, (data: any) => void>;
  let activity: object;
  let exit: () => void;
  let focused: string;
  let restores: number;
  const item = { title: 'Sintel' };

  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout'] });
    browser = new EventTarget();
    page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    listeners = new Map();
    activity = {};
    focused = '';
    restores = 0;
    (globalThis as any).window = browser;
    (globalThis as any).document = page;
    (globalThis as any).Lampa = {
      Activity: { active: () => activity },
      Player: {
        callback: (callback: () => void) => { exit = callback; },
        listener: {
          follow: (name: string, callback: (data: any) => void) => listeners.set(name, callback),
          remove: (name: string) => listeners.delete(name),
        },
      },
    };
    PlaybackFocus.arm([item], () => { focused = 'file-row'; restores++; });
    listeners.get('create')!({ data: item });
  });

  afterEach(() => {
    PlaybackFocus.resetForTesting();
    mock.timers.reset();
    (globalThis as any).Lampa = originalLampa;
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
  });

  it('restores the file row after an external player returns without an exit callback', () => {
    listeners.get('external')!(item);
    browser.dispatchEvent(new Event('blur'));
    browser.dispatchEvent(new Event('focus'));
    assert.equal(focused, '');
    mock.timers.tick(0);
    assert.equal(focused, 'file-row');
    browser.dispatchEvent(new Event('focus'));
    mock.timers.tick(0);
    assert.equal(restores, 1);
  });

  it('handles Android visibility changes and coalesces duplicate return events', () => {
    listeners.get('external')!(item);
    page.visibilityState = 'hidden';
    page.dispatchEvent(new Event('visibilitychange'));
    page.visibilityState = 'visible';
    page.dispatchEvent(new Event('visibilitychange'));
    browser.dispatchEvent(new Event('focus'));
    mock.timers.tick(0);
    assert.equal(restores, 1);
  });

  it('handles a blur delivered before Lampa announces the external launch', () => {
    browser.dispatchEvent(new Event('blur'));
    listeners.get('external')!(item);
    browser.dispatchEvent(new Event('focus'));
    mock.timers.tick(0);
    assert.equal(focused, 'file-row');
  });

  it('does not steal focus during built-in playback or an unrelated browser focus', () => {
    browser.dispatchEvent(new Event('focus'));
    browser.dispatchEvent(new Event('blur'));
    browser.dispatchEvent(new Event('focus'));
    mock.timers.tick(0);
    assert.equal(restores, 0);
    exit();
    assert.equal(restores, 1);
  });

  it('drops the return handler when another activity or playback replaces its owner', () => {
    listeners.get('external')!(item);
    browser.dispatchEvent(new Event('blur'));
    activity = {};
    browser.dispatchEvent(new Event('focus'));
    mock.timers.tick(0);
    assert.equal(restores, 0);
    PlaybackFocus.arm([item], () => { restores++; });
    listeners.get('create')!({ data: { title: 'Other playback' } });
    listeners.get('external')!(item);
    browser.dispatchEvent(new Event('blur'));
    browser.dispatchEvent(new Event('focus'));
    mock.timers.tick(0);
    assert.equal(restores, 0);
  });

  it('uses the search row callback supplied after the player hand-off', () => {
    PlaybackFocus.setCallback(() => { focused = 'search-row'; });
    listeners.get('external')!(item);
    browser.dispatchEvent(new Event('blur'));
    browser.dispatchEvent(new Event('focus'));
    mock.timers.tick(0);
    assert.equal(focused, 'search-row');
  });

  it('cancels a pending external return when the built-in exit callback runs', () => {
    listeners.get('external')!(item);
    browser.dispatchEvent(new Event('blur'));
    browser.dispatchEvent(new Event('focus'));
    exit();
    mock.timers.tick(0);
    assert.equal(restores, 1);
  });
});
