// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import type { Torrent } from '../../src/types/torst';

export function createTorstTorrent(torrent: Omit<Partial<Torrent>, 'storage'> & { storage?: string }) {
  return {
    created_at: '2026-10-24T12:00:00Z',
    file_count: torrent.files?.length || 0,
    id: torrent.id || `trr_${torrent.hash}`,
    info_hashes: [{ algorithm: 'sha1', value: torrent.hash }],
    name: torrent.name,
    observed_state: 'downloading',
    poster: torrent.poster ? {} : null,
    retention: torrent.retention || 'persisted',
    size_bytes: torrent.total_size || 0,
    storage_mode: torrent.storage === 'file' ? 'disk' : 'memory',
    title: torrent.title || null,
  };
}
