// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import { TorstApi } from '../api/torst';
import { Torrent, TorstInstance } from '../types/torst';

export const LIBRARY_SEARCH_ENABLED_STORAGE_KEY = 'torst_library_search';

/** Lists the saved torrents matching query, best match first, as the instance ranks them. */
export async function searchLibraryTorrents(instance: TorstInstance, query: string): Promise<Torrent[]> {
  const response = await TorstApi.getTorrents(instance, { fuzzy: true, retention: 'persisted', search: query });
  return response.torrents || [];
}
