// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import { translate } from '../lang/translations';
import { PlayOptions, TorrentStorage } from '../types/torst';

export const SAVE_TO_DATABASE_STORAGE_KEY = 'torst_save_to_db';
export const STORAGE_TYPE_STORAGE_KEY = 'torst_storage_type';

export class PlayDialog {
  public static async resolveOptions(title?: string): Promise<PlayOptions | null> {
    const rawStorage = Lampa.Storage.get<unknown>(STORAGE_TYPE_STORAGE_KEY, 'memory');
    const rawSaveToDb = Lampa.Storage.get<unknown>(SAVE_TO_DATABASE_STORAGE_KEY, 'false');

    const savedStorageType = String(rawStorage ?? 'memory');
    const isAskStorage = savedStorageType === 'ask';

    const isAskDatabase = String(rawSaveToDb) === 'ask';
    const isSaveToDatabase = !isAskDatabase &&
      rawSaveToDb !== false && rawSaveToDb !== 'false' && rawSaveToDb !== 0 && rawSaveToDb !== '0';

    // If neither setting is set to "ask", return directly
    if (!isAskStorage && !isAskDatabase) {
      return {
        saveToDb: isSaveToDatabase,
        storage: isSaveToDatabase && savedStorageType === 'file' ? 'file' : 'memory',
      };
    }

    return new Promise<PlayOptions | null>(resolve => {
      let currentStorage: TorrentStorage = savedStorageType === 'file' ? 'file' : 'memory';
      let shouldSaveToDatabase = isSaveToDatabase;
      if (!shouldSaveToDatabase) {
        currentStorage = 'memory';
      }
      let shouldRememberChoice = false;
      let isSettled = false;
      const returnController = Lampa.Controller?.enabled?.().name || 'content';

      const defaultTitle = translate('torst_options_title', 'Playback Options');
      const storageLabel = translate('torst_label_storage', 'Storage Type:');
      const persistenceLabel = translate('torst_label_persistence', 'Database:');
      const ramText = translate('torst_storage_type_ram', 'RAM');
      const diskText = translate('torst_storage_type_disk', 'Disk');
      const saveDbText = translate('torst_opt_save_db', 'Save to Database');
      const dontSaveText = translate('torst_opt_dont_save', 'Do Not Save (Temporary)');
      const rememberText = translate('torst_opt_remember', "Remember choice (don't ask again)");
      const playText = translate('torst_btn_start_play', 'Start Playback');
      const storageHintText = translate('torst_hint_storage_requires_save', 'Disk storage requires Save to Database');

      const rootElement = $(`
        <div class="torst-options-modal" style="padding: 1.5em; font-size: 1.1em;">
          <div style="margin-bottom: 1em; font-size: 1.2em; font-weight: bold; color: #fff;">
            ${title ? Lampa.Utils.clearHtmlTags(title) : defaultTitle}
          </div>

          <div style="margin-bottom: 1.2em;">
            <div style="margin-bottom: 0.4em; color: #aaa;">${storageLabel}</div>
            <div class="torst-opt-storage selector" style="display: inline-block; padding: 0.5em 1em; color: #fff; cursor: pointer; background: #2a2a2a; border-radius: 0.4em;">
              ${currentStorage === 'memory' ? ramText : diskText}
            </div>
            <div class="torst-opt-storage-hint" style="display: none; margin-top: 0.4em; font-size: 0.85em; color: #888;">
              ${storageHintText}
            </div>
          </div>

          <div style="margin-bottom: 1.2em;">
            <div style="margin-bottom: 0.4em; color: #aaa;">${persistenceLabel}</div>
            <div class="torst-opt-savedb selector" style="display: inline-block; padding: 0.5em 1em; color: #fff; cursor: pointer; background: #2a2a2a; border-radius: 0.4em;">
              ${shouldSaveToDatabase ? saveDbText : dontSaveText}
            </div>
          </div>

          <div style="margin-bottom: 1.5em;">
            <div class="torst-opt-remember selector" style="display: flex; align-items: center; color: #ccc; cursor: pointer;">
              <input type="checkbox" style="width: 1.2em; height: 1.2em; margin-right: 0.6em; pointer-events: none;" />
              ${rememberText}
            </div>
          </div>

          <div>
            <div class="torst-btn-play selector" style="display: inline-block; padding: 0.7em 2em; font-weight: bold; color: #fff; cursor: pointer; background: #e50914; border-radius: 0.4em;">
              ${playText}
            </div>
          </div>
        </div>
      `);

      const storageButton = rootElement.find('.torst-opt-storage');
      const storageHint = rootElement.find('.torst-opt-storage-hint');
      const saveToDatabaseButton = rootElement.find('.torst-opt-savedb');
      const rememberChoiceControl = rootElement.find('.torst-opt-remember');
      const rememberChoiceCheckbox = rootElement.find('.torst-opt-remember input');
      const playButton = rootElement.find('.torst-btn-play');

      const updateStorageAvailability = () => {
        storageButton.text(currentStorage === 'memory' ? ramText : diskText);
        if (shouldSaveToDatabase) {
          storageButton.addClass('selector').removeClass('torst-opt-disabled').css({ cursor: 'pointer', opacity: 1 });
          storageHint.css('display', 'none');
        } else {
          storageButton.removeClass('selector').addClass('torst-opt-disabled').css({ cursor: 'default', opacity: 0.4 });
          storageHint.css('display', 'block');
        }
      };

      updateStorageAvailability();

      storageButton.on('hover:enter', () => {
        if (!shouldSaveToDatabase) return;
        currentStorage = currentStorage === 'memory' ? 'file' : 'memory';
        updateStorageAvailability();
      });

      saveToDatabaseButton.on('hover:enter', () => {
        shouldSaveToDatabase = !shouldSaveToDatabase;
        saveToDatabaseButton.text(shouldSaveToDatabase ? saveDbText : dontSaveText);
        if (!shouldSaveToDatabase) {
          currentStorage = 'memory';
        }
        updateStorageAvailability();
      });

      rememberChoiceControl.on('hover:enter', () => {
        shouldRememberChoice = !shouldRememberChoice;
        rememberChoiceCheckbox.prop('checked', shouldRememberChoice);
      });

      const closeDialog = (result: PlayOptions | null) => {
        if (isSettled) return;
        isSettled = true;
        Lampa.Modal.close();
        Lampa.Controller.toggle(returnController);
        resolve(result);
      };

      playButton.on('hover:enter', () => {
        if (shouldRememberChoice) {
          Lampa.Storage.set(STORAGE_TYPE_STORAGE_KEY, currentStorage);
          Lampa.Storage.set(SAVE_TO_DATABASE_STORAGE_KEY, shouldSaveToDatabase ? 'true' : 'false');
        }
        closeDialog({ saveToDb: shouldSaveToDatabase, storage: currentStorage });
      });

      Lampa.Modal.open({
        html: rootElement,
        mask: true,
        onBack: () => {
          closeDialog(null);
        },
        size: 'medium',
        title: 'Torst',
      });
    });
  }
}
