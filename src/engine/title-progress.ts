// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import { ParsedFileInfo } from '../types/torst';

export function resolveTitleProgressLookup(movie: LampaMovie): string | undefined {
  const isSeries = Boolean(movie.original_name || movie.number_of_seasons || movie.media_type === 'tv');
  const id = String(movie.id || '');
  if ((!movie.source || movie.source === 'tmdb' || movie.source === 'cub') && /^[1-9][0-9]{0,9}$/.test(id)) {
    return `tmdb-${isSeries ? 'tv' : 'movie'}-${id}${isSeries ? '-' : ''}`;
  }
  const imdbId = movie.imdb_id;
  if (typeof imdbId === 'string' && /^tt[0-9]{7,10}$/.test(imdbId)) return `imdb-${imdbId}${isSeries ? '-' : ''}`;
  return undefined;
}

export function resolveTitleProgressKey(movie: LampaMovie, fileInfo: ParsedFileInfo): string | undefined {
  const prefix = resolveTitleProgressLookup(movie);
  if (!prefix) return undefined;
  if (!prefix.endsWith('-')) return fileInfo.serial ? undefined : prefix;
  const { episode, season } = fileInfo;
  if (season === null || episode === null || !Number.isInteger(season) || !Number.isInteger(episode)
    || season < 0 || episode < 0 || season > 9999 || episode > 9999) return undefined;
  return `${prefix}s${season}e${episode}`;
}
