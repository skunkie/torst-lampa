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
  private static generation = 0;

  public static async show(instance: TorstInstance, onBack: () => void): Promise<void> {
    const generation = ++this.generation;
    const profileId = instance.profileId;
    const instanceUrl = instance.url;
    const activity = Lampa.Activity?.active?.();
    const isCurrent = () => generation === this.generation && instance.profileId === profileId && instance.url === instanceUrl
      && InstanceManager.getInstances().some(candidate => candidate.id === instance.id && candidate.url === instanceUrl && candidate.profileId === profileId)
      && (activity === undefined || Lampa.Activity?.active?.() === activity);
    if (!profileId) {
      Lampa.Noty?.show(translate('torst_profile_required', 'Select a Torst profile first'));
      onBack();
      return;
    }
    const returnTo = () => { if (isCurrent()) void this.show(instance, onBack); };
    try {
      await PlaybackProgress.flush();
      if (!isCurrent()) return;
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
        onBack: () => { this.generation++; onBack(); },
        onSelect: (item: LampaSelectItem<UpNextEntry>) => {
          if (item.data && isCurrent()) this.actions(instance, profileId, item.data, returnTo, isCurrent);
        },
        title: translate('torst_up_next_title', 'Up Next'),
      });
    } catch (error) {
      if (!isCurrent()) return;
      this.report(error);
      onBack();
    }
  }

  private static actions(instance: TorstInstance, profileId: string, entry: UpNextEntry, onBack: () => void, isCurrent: () => boolean): void {
    Lampa.Select.show({
      items: [
        { action: 'play', title: translate('torst_btn_start_play', 'Start Playback') },
        { action: 'dismiss', title: translate('torst_up_next_dismiss', 'Remove from Up Next') },
      ],
      onBack,
      onSelect: (item: LampaSelectItem) => {
        if (!isCurrent()) return;
        if (item.action === 'dismiss') {
          void TorstApi.dismissUpNext(instance, profileId, entry.id).catch(error => { if (isCurrent()) this.report(error); }).then(onBack);
        } else if (item.action === 'play') {
          Lampa.Controller.toggle('content');
          void this.play(instance, entry, onBack, isCurrent);
        }
      },
      title: Lampa.Utils.clearHtmlTags(entry.file.name),
    });
  }

  private static async play(instance: TorstInstance, entry: UpNextEntry, onBack: () => void, isCurrent: () => boolean): Promise<void> {
    try {
      const torrent = await TorstApi.getTorrent(instance, entry.torrent.hash);
      if (!isCurrent()) return;
      const fileIndex = torrent.files.findIndex(file => file.fileId === entry.file.fileId);
      if (fileIndex < 0) throw new Error(translate('torst_noty_no_video', 'No video files found in torrent'));
      const started = await TorstEngine.startTorrentPlayback(torrent, fileIndex, undefined, instance, 'content');
      if (!isCurrent()) return;
      if (started) PlaybackFocus.setCallback(onBack);
      else onBack();
    } catch (error) {
      if (!isCurrent()) return;
      this.report(error);
      onBack();
    }
  }

  private static report(error: unknown): void {
    Lampa.Noty?.show(translate('torst_noty_error', 'Torst: {msg}', { msg: error instanceof Error ? error.message : String(error) }));
  }
}
