// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import { TorstApi } from '../api/torst';
import { closeModalSafely } from '../engine/engine-utils';
import { PlaybackFocus } from '../engine/playback-focus';
import { PlaybackProgress } from '../engine/playback-progress';
import { TorstEngine } from '../engine/torst-engine';
import { InstanceManager } from '../instances/instance-manager';
import { translate } from '../lang/translations';
import { TorstInstance, UpNextEntry } from '../types/torst';

export class UpNextUi {
  private static generation = 0;
  private static closeCurrent: (() => void) | undefined;

  public static async show(instance: TorstInstance, onBack: () => void): Promise<void> {
    this.closeCurrent?.();
    const generation = ++this.generation;
    const profileId = instance.profileId;
    const instanceUrl = instance.url;
    const activity = Lampa.Activity?.active?.();
    const isSameActivity = () => activity === undefined || Lampa.Activity?.active?.() === activity;
    const isCurrent = () => generation === this.generation && instance.profileId === profileId && instance.url === instanceUrl
      && InstanceManager.getInstances().some(candidate => candidate.id === instance.id && candidate.url === instanceUrl && candidate.profileId === profileId)
      && isSameActivity();
    if (!profileId) {
      Lampa.Noty?.show(translate('torst_profile_required', 'Select a Torst profile first'));
      onBack();
      return;
    }

    let isBusy = false;
    let isClosed = false;
    let selectedIndex = 0;
    const playbackAbort = new AbortController();
    const close = () => {
      if (isClosed) return;
      isClosed = true;
      playbackAbort.abort();
      closeModalSafely();
      this.closeCurrent = undefined;
    };
    const back = () => {
      if (isClosed) return;
      const shouldRestore = generation === this.generation && isSameActivity();
      close();
      if (generation === this.generation) this.generation++;
      if (shouldRestore) onBack();
    };
    this.closeCurrent = close;

    const loading = this.createDialog(instance, back);
    loading.find('.torst-up-next__entries').append($('<div class="modal-loading" role="status"></div>').attr('aria-label', Lampa.Lang?.translate('loading') || 'Loading'));
    Lampa.Modal.open({ html: loading, mask: true, onBack: back, size: 'large', title: translate('torst_up_next_title', 'Up Next') });

    const load = async () => {
      isBusy = true;
      try {
        await PlaybackProgress.flush();
        if (!isCurrent() || isClosed) return;
        const entries = await TorstApi.getUpNext(instance, profileId);
        if (!isCurrent() || isClosed) return;
        const root = this.createDialog(instance, back);
        const list = root.find('.torst-up-next__entries');
        const playButtons: LampaDomElement[] = [];
        entries.forEach((entry, index) => {
          const row = this.buildEntryRow(entry);
          const playButton = row.find('.torst-up-next__play');
          playButtons.push(playButton);
          playButton.on('hover:enter', () => {
            if (isBusy || !isCurrent() || isClosed) return;
            isBusy = true;
            selectedIndex = index;
            void this.play(instance, entry, () => { if (isCurrent() && !isClosed) void load(); }, () => isCurrent() && !isClosed, playbackAbort.signal);
          });
          row.find('.torst-up-next__dismiss').on('hover:enter', () => {
            if (isBusy || !isCurrent() || isClosed) return;
            isBusy = true;
            selectedIndex = index;
            root.attr('aria-busy', 'true');
            void TorstApi.dismissUpNext(instance, profileId, entry.id).catch(error => { if (isCurrent() && !isClosed) this.report(error); }).then(() => {
              if (isCurrent() && !isClosed) void load();
            });
          });
          list.append(row);
        });
        if (!entries.length) list.append($('<div class="torst-up-next__message"></div>').text(translate('torst_up_next_empty', 'Nothing to continue yet')));
        isBusy = false;
        Lampa.Modal.update(root);
        const focus = playButtons[Math.min(selectedIndex, playButtons.length - 1)];
        if (focus) Lampa.Controller.collectionFocus(focus[0], root);
      } catch (error) {
        if (!isCurrent() || isClosed) return;
        const root = this.createDialog(instance, back);
        root.find('.torst-up-next__entries').append($('<div class="torst-up-next__message" role="alert"></div>').text(this.errorMessage(error)));
        Lampa.Modal.update(root);
      }
    };
    await load();
  }

  private static createDialog(instance: TorstInstance, onBack: () => void): LampaDomElement {
    const root = $(`<div class="torst-up-next">
      <style>
        .torst-up-next { color: #fff; }
        .torst-up-next__instance { margin-bottom: 1em; font-size: 0.9em; color: #bdbdbd; }
        .torst-up-next__row { display: flex; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.12); }
        .torst-up-next__play { flex: 1; min-width: 0; padding: 1em; cursor: pointer; border-radius: 0.5em; }
        .torst-up-next__status { margin-bottom: 0.4em; font-size: 0.85em; color: #bdbdbd; }
        .torst-up-next__title { margin-bottom: 0.3em; font-size: 1.25em; font-weight: 500; overflow-wrap: break-word; }
        .torst-up-next__file { font-size: 0.85em; color: #bdbdbd; overflow-wrap: break-word; }
        .torst-up-next__track { height: 0.2em; margin-top: 0.8em; overflow: hidden; background: rgba(255,255,255,0.2); border-radius: 1em; }
        .torst-up-next__progress { height: 100%; background: currentColor; }
        .torst-up-next__dismiss { display: flex; flex-shrink: 0; align-items: center; justify-content: center; width: 2.8em; height: 2.8em; margin: 0.5em 0.2em 0.5em 1em; color: #bdbdbd; cursor: pointer; border: 1px solid rgba(255,255,255,0.2); border-radius: 0.5em; }
        .torst-up-next__dismiss svg { width: 1.2em; height: 1.2em; pointer-events: none; }
        .torst-up-next .selector.focus { color: #000; outline: 0.15em solid #fff; outline-offset: 0.1em; background: #fff; }
        .torst-up-next__play.focus .torst-up-next__status, .torst-up-next__play.focus .torst-up-next__file { color: #444; }
        .torst-up-next__play.focus .torst-up-next__track { background: rgba(0,0,0,0.2); }
        .torst-up-next__message { padding: 2em 1em; line-height: 1.5; color: #bdbdbd; overflow-wrap: break-word; }
        .torst-up-next__back { display: inline-block; padding: 0.7em 1.5em; margin: 1.5em 0.2em 0.2em; cursor: pointer; background: rgba(255,255,255,0.1); border-radius: 0.5em; }
      </style>
      <div class="torst-up-next__instance"></div>
      <div class="torst-up-next__entries" aria-live="polite"></div>
      <div class="torst-up-next__back selector" role="button"></div>
    </div>`);
    root.find('.torst-up-next__instance').text(instance.name);
    root.find('.torst-up-next__back').text(translate('torst_back', 'Back')).on('hover:enter', onBack);
    return root;
  }

  private static buildEntryRow(entry: UpNextEntry): LampaDomElement {
    const percent = Math.max(0, Math.min(100, Math.round((entry.progress?.completion_ratio || 0) * 100)));
    const status = entry.reason === 'next_episode'
      ? translate('torst_up_next_episode', 'Next Episode')
      : translate('torst_up_next_resume', 'Resume · {percent}%', { percent });
    const row = $(`<div class="torst-up-next__row">
      <div class="torst-up-next__play selector" role="button">
        <div class="torst-up-next__status"></div>
        <div class="torst-up-next__title"></div>
        <div class="torst-up-next__file"></div>
      </div>
      <div class="torst-up-next__dismiss selector" role="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false">
          <path d="m6 6 12 12M18 6 6 18"/>
        </svg>
      </div>
    </div>`);
    row.find('.torst-up-next__status').text(status);
    const title = entry.torrent.title || entry.torrent.name;
    row.find('.torst-up-next__title').text(title);
    row.find('.torst-up-next__file').text(entry.file.name);
    const playButton = row.find('.torst-up-next__play');
    playButton.attr('aria-label', `${translate('torst_btn_start_play', 'Start Playback')}: ${title} · ${entry.file.name} · ${status}`);
    if (entry.reason === 'resume') {
      const track = $('<div class="torst-up-next__track" aria-hidden="true"><div class="torst-up-next__progress"></div></div>');
      track.find('.torst-up-next__progress').css('width', `${percent}%`);
      playButton.append(track);
    }
    const dismissLabel = translate('torst_up_next_dismiss', 'Remove from Up Next');
    row.find('.torst-up-next__dismiss')
      .attr('aria-label', `${dismissLabel}: ${title} · ${entry.file.name}`)
      .attr('title', dismissLabel);
    return row;
  }

  private static async play(instance: TorstInstance, entry: UpNextEntry, onBack: () => void, isCurrent: () => boolean, signal: AbortSignal): Promise<void> {
    try {
      const torrent = await TorstApi.getTorrent(instance, entry.torrent.hash);
      if (!isCurrent()) return;
      const fileIndex = torrent.files.findIndex(file => file.fileId === entry.file.fileId);
      if (fileIndex < 0) throw new Error(translate('torst_noty_no_video', 'No video files found in torrent'));
      const started = await TorstEngine.startTorrentPlayback(torrent, fileIndex, undefined, instance, 'modal', signal);
      if (!isCurrent()) return;
      if (started) PlaybackFocus.setCallback(onBack);
      else onBack();
    } catch (error) {
      if (!isCurrent()) return;
      this.report(error);
      onBack();
    }
  }

  private static errorMessage(error: unknown): string {
    return translate('torst_noty_error', 'Torst: {msg}', { msg: error instanceof Error ? error.message : String(error) });
  }

  private static report(error: unknown): void {
    Lampa.Noty?.show(this.errorMessage(error));
  }
}
