// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import { TorstApi } from '../api/torst';
import { PlaybackFocus } from '../engine/playback-focus';
import { PlaybackProgress } from '../engine/playback-progress';
import { TorstEngine } from '../engine/torst-engine';
import { InstanceManager } from '../instances/instance-manager';
import { translate } from '../lang/translations';
import { TorstInstance, UpNextEntry } from '../types/torst';
import { toTemplateText } from '../utils/template-text';

export class UpNextUi {
  public static async show(instance: TorstInstance, onBack: () => void): Promise<void> {
    const profileId = instance.profileId;
    const instanceUrl = instance.url;
    const activity = Lampa.Activity?.active?.();
    const isCurrent = () => instance.profileId === profileId && instance.url === instanceUrl
      && (activity === undefined || Lampa.Activity?.active?.() === activity);
    if (!profileId) {
      Lampa.Noty?.show(translate('torst_profile_required', 'Select a Torst profile first'));
      onBack();
      return;
    }
    const returnTo = () => { void this.show(instance, onBack); };
    try {
      await PlaybackProgress.flush();
      const entries = await TorstApi.getUpNext(instance, profileId);
      if (!isCurrent()) return;
      const items: LampaSelectItem<UpNextEntry>[] = entries.map(entry => ({
        data: entry,
        subtitle: entry.reason === 'next_episode'
          ? translate('torst_up_next_episode', 'Next Episode')
          : translate('torst_up_next_resume', 'Resume · {percent}%', { percent: Math.round((entry.progress?.completion_ratio || 0) * 100) }),
        title: toTemplateText(`${entry.torrent.title || entry.torrent.name} · ${entry.file.name}`),
      }));
      if (!items.length) items.push({ ghost: true, noenter: true, title: translate('torst_up_next_empty', 'Nothing to continue yet') });
      Lampa.Select.show({
        items,
        onBack,
        onSelect: (item: LampaSelectItem<UpNextEntry>) => {
          if (item.data) this.actions(instance, profileId, item.data, returnTo);
        },
        title: translate('torst_up_next_title', 'Up Next'),
      });
    } catch (error) {
      if (!isCurrent()) return;
      this.report(error);
      onBack();
    }
  }

  private static actions(instance: TorstInstance, profileId: string, entry: UpNextEntry, onBack: () => void): void {
    Lampa.Select.show({
      items: [
        { action: 'play', title: translate('torst_btn_start_play', 'Start Playback') },
        { action: 'dismiss', title: translate('torst_up_next_dismiss', 'Remove from Up Next') },
      ],
      onBack,
      onSelect: (item: LampaSelectItem) => {
        if (!InstanceManager.getInstances().some(candidate => candidate.id === instance.id && candidate.url === instance.url && candidate.profileId === profileId)) return onBack();
        if (item.action === 'dismiss') {
          void TorstApi.dismissUpNext(instance, profileId, entry.id).catch(error => this.report(error)).then(onBack);
        } else if (item.action === 'play') {
          Lampa.Controller.toggle('content');
          void this.play(instance, profileId, entry, onBack);
        }
      },
      title: Lampa.Utils.clearHtmlTags(entry.file.name),
    });
  }

  private static async play(instance: TorstInstance, profileId: string, entry: UpNextEntry, onBack: () => void): Promise<void> {
    try {
      const torrent = await TorstApi.getTorrent(instance, entry.torrent.hash);
      if (instance.profileId !== profileId) return onBack();
      const fileIndex = torrent.files.findIndex(file => file.fileId === entry.file.fileId);
      if (fileIndex < 0) throw new Error(translate('torst_noty_no_video', 'No video files found in torrent'));
      if (await TorstEngine.startTorrentPlayback(torrent, fileIndex, undefined, instance, 'content')) PlaybackFocus.setCallback(onBack);
      else onBack();
    } catch (error) {
      this.report(error);
      onBack();
    }
  }

  private static report(error: unknown): void {
    Lampa.Noty?.show(translate('torst_noty_error', 'Torst: {msg}', { msg: error instanceof Error ? error.message : String(error) }));
  }
}
