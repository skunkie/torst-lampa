// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import { AuthenticationError } from '../api/auth';
import { PreloadStartUnconfirmedError, TorstApi, TorstApiError } from '../api/torst';
import { translate } from '../lang/translations';
import { PreloadResponse, TorstInstance } from '../types/torst';

// Peer discovery can take longer than a transfer stall, so the opening wait gets
// a wider budget until the first bytes arrive.
const COLD_START_TIMEOUT_MS = 120000;
const STALL_TIMEOUT_MS = 30000;

// A client error answers the same way on every retry, except for the statuses that ask the
// client to come back later.
function isClientRejection(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

function isAuthenticationFailure(error: unknown): boolean {
  if (error instanceof AuthenticationError) {
    return error.status === undefined || isClientRejection(error.status);
  }
  return error instanceof TorstApiError && (error.status === 401 || error.status === 403);
}

function shouldStopRetrying(error: unknown): boolean {
  return error instanceof PreloadStartUnconfirmedError || isAuthenticationFailure(error)
    || (error instanceof TorstApiError && isClientRejection(error.status));
}

export class PreloadModal {
  public static calculateProgress(
    preloadResponse: Partial<PreloadResponse>
  ): number {
    const completedBytes = preloadResponse.completed_bytes ?? 0;
    const targetBytes = preloadResponse.target_bytes ?? 0;

    let progress = 0;
    if (targetBytes > 0) {
      progress = (completedBytes * 100) / targetBytes;
    }

    if (isNaN(progress) || progress < 0) {
      return 0;
    }
    return Math.min(100, progress);
  }

  public static async waitUntilReady(
    instance: TorstInstance,
    torrentHash: string,
    fileIdentifier: { index?: number, path?: string },
    mediaMetadata?: LampaMovie,
    playbackFraction?: number
  ): Promise<boolean> {
    const loadingMedia = mediaMetadata
      ? {
        background: mediaMetadata.background || mediaMetadata.img || '',
        card: mediaMetadata.card || mediaMetadata.movie,
        first_title: mediaMetadata.first_title || mediaMetadata.name || mediaMetadata.title,
        img: mediaMetadata.img || mediaMetadata.poster_path,
        movie: mediaMetadata.movie || mediaMetadata.card,
        title: mediaMetadata.title || mediaMetadata.first_title || 'Torst',
      }
      : {
        title: 'Torst',
      };

    return new Promise<boolean>(resolve => {
      let isStopped = false;
      let lastCompletedBytes = 0;
      let lastProgress = 0;
      let lastProgressAtMs = Date.now();
      let lastPeerCount = 0;
      let hasTransferStarted = false;
      let pollingTimeout: ReturnType<typeof setTimeout> | null = null;
      let pendingStart: Promise<unknown> | null = null;
      let preloadId: string | undefined;

      const cleanup = () => {
        if (pollingTimeout) {
          clearTimeout(pollingTimeout);
          pollingTimeout = null;
        }
        if (typeof Lampa !== 'undefined' && Lampa.Loading) {
          Lampa.Loading.stop();
        }
      };

      const cancelPreload = () => {
        TorstApi.cancelPreload(instance, torrentHash, preloadId).catch(() => {});
      };

      const handleCancel = () => {
        if (isStopped) return;
        isStopped = true;
        cleanup();
        // A start still in flight can reach the instance after the cancel and leave a preload
        // nobody waits for, so the cancel follows it. A failed start may still have reached the
        // instance, so the cancel is sent either way.
        if (pendingStart) {
          pendingStart.then(cancelPreload, cancelPreload);
        } else {
          cancelPreload();
        }
        resolve(false);
      };

      // Start Lampa.Loading if available
      if (typeof Lampa !== 'undefined' && Lampa.Loading) {
        Lampa.Loading.start(handleCancel, '', {
          media: loadingMedia,
        });
      }

      // Returns true once the preload has settled, either ready or given up by the instance.
      const processPreloadResponse = (preloadResponse: PreloadResponse): boolean => {
        if (preloadResponse.preloadId) preloadId = preloadResponse.preloadId;
        // The instance never resumes a failed or evicted preload, and both still report the
        // progress they had made, so this must win over the progress threshold below.
        if (preloadResponse.status === 'failed' || preloadResponse.status === 'evicted') {
          isStopped = true;
          cleanup();
          if (typeof Lampa !== 'undefined' && Lampa.Noty) {
            Lampa.Noty.show(preloadResponse.status === 'failed'
              ? translate(
                'torst_noty_preload_failed',
                'Preload failed: not enough memory or the torrent stopped receiving data'
              )
              : translate('torst_noty_preload_evicted', 'Preload was stopped to free memory'));
          }
          resolve(false);
          return true;
        }

        const progress = PreloadModal.calculateProgress(preloadResponse);

        if (preloadResponse.status === 'ready' || progress >= 95) {
          isStopped = true;
          cleanup();
          resolve(true);
          return true;
        }

        const completedBytes = preloadResponse.completed_bytes ?? 0;
        if (completedBytes > lastCompletedBytes || progress > lastProgress) {
          lastCompletedBytes = completedBytes;
          lastProgress = progress;
          lastProgressAtMs = Date.now();
          hasTransferStarted = true;
        }

        const downloadRateBytesPerSecond = preloadResponse.download_rate ?? 0;
        const speedMbps = Math.max(0, downloadRateBytesPerSecond) * 8 / 1000000;
        const formattedSpeed = `${speedMbps.toFixed(2)} ${translate('speed_mb', 'Mbit/s')}`;
        const targetBytes = preloadResponse.target_bytes ?? 0;
        const bufferSize = typeof Lampa !== 'undefined' && Lampa.Utils
          ? Lampa.Utils.bytesToSize(completedBytes) + (targetBytes > 0 ? ` / ${Lampa.Utils.bytesToSize(targetBytes)}` : '')
          : '';

        const activePeerCount = preloadResponse.active_peers ?? 0;
        const totalPeerCount = preloadResponse.total_peers ?? 0;

        const activePeers = parseInt(String(activePeerCount), 10);
        const totalPeers = parseInt(String(totalPeerCount || activePeers || 0), 10);

        // Peers still arriving is the only sign of life a torrent has before its first bytes,
        // so it counts as forward movement during the opening wait.
        if (!hasTransferStarted && activePeers > lastPeerCount) {
          lastProgressAtMs = Date.now();
        }
        lastPeerCount = Math.max(lastPeerCount, activePeers);

        if (typeof Lampa !== 'undefined' && Lampa.Loading) {
          Lampa.Loading.setProgress(progress, {
            active_peers: activePeers,
            speed: [bufferSize, formattedSpeed].filter(Boolean).join(' · '),
            total_peers: totalPeers,
          });
        }

        return false;
      };

      // A status rejection can leave a known preload behind; an unconfirmed start has no
      // resource ID to cancel.
      const stopOnFinalError = (error: unknown, { shouldCancelPreload }: { shouldCancelPreload: boolean }): boolean => {
        if (!shouldStopRetrying(error)) return false;
        isStopped = true;
        cleanup();
        if (shouldCancelPreload) cancelPreload();
        if (typeof Lampa !== 'undefined' && Lampa.Noty) {
          Lampa.Noty.show(isAuthenticationFailure(error)
            ? translate(
              'torst_noty_preload_unauthorized',
              `Torst rejected the credentials for ${instance.name}. Check them in Settings.`,
              { name: instance.name }
            )
            : error instanceof PreloadStartUnconfirmedError
              ? translate('torst_noty_preload_start_unknown', 'Could not confirm preload start. Try again.')
              : translate('torst_noty_preload_rejected', 'Torst refused to preload this file'));
        }
        resolve(false);
        return true;
      };

      const next = (action: () => void) => {
        if (isStopped) return;

        const idleTimeoutMs = hasTransferStarted ? STALL_TIMEOUT_MS : COLD_START_TIMEOUT_MS;
        if (Date.now() - lastProgressAtMs > idleTimeoutMs) {
          if (typeof Lampa !== 'undefined' && Lampa.Noty) {
            Lampa.Noty.show(translate('torst_noty_preload_timeout', 'Preload stopped: no data is arriving'));
          }
          handleCancel();
          return;
        }

        pollingTimeout = setTimeout(action, 1000);
      };

      const update = async () => {
        if (isStopped) return;

        try {
          const preloadResponse = await TorstApi.getPreload(instance, torrentHash, preloadId);
          if (isStopped) return;

          const isSettled = processPreloadResponse(preloadResponse);
          if (!isSettled) {
            next(update);
          }
        } catch (error) {
          if (isStopped || stopOnFinalError(error, { shouldCancelPreload: true })) return;
          next(update);
        }
      };

      const start = () => {
        const startRequest = TorstApi.startPreload(instance, torrentHash, {
          file_index: fileIdentifier.index,
          file_path: fileIdentifier.path,
          playbackFraction,
        });
        pendingStart = startRequest;
        startRequest.then(initialPreloadResponse => {
          pendingStart = null;
          preloadId = initialPreloadResponse?.preloadId;
          if (isStopped) return;
          lastProgressAtMs = Date.now();
          if (initialPreloadResponse) {
            const isSettled = processPreloadResponse(initialPreloadResponse);
            if (isSettled) return;
          }
          next(update);
        }).catch(error => {
          pendingStart = null;
          if (isStopped || stopOnFinalError(error, { shouldCancelPreload: false })) return;
          next(start);
        });
      };

      start();
    });
  }
}
