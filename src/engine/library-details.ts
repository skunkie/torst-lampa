// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import { LibraryDetails } from '../types/torst';
import { GENRE_MAX_CHARACTERS, normalizeLibraryDescription, normalizeLibraryLine } from '../utils/library-text';
import { resolveCardKind } from './media-context';

const GENRE_LIMIT = 16;

function resolveYear(movie: LampaMovie): number | undefined {
  const date = movie.release_date || movie.first_air_date;
  const year = typeof date === 'string' ? Number(date.slice(0, 4)) : NaN;
  return Number.isInteger(year) && year >= 1800 && year <= 2200 ? year : undefined;
}

function resolveGenres(movie: LampaMovie): string[] | undefined {
  if (!Array.isArray(movie.genres)) return undefined;
  const genres: string[] = [];
  for (const genre of movie.genres) {
    const name = normalizeLibraryLine(genre?.name, GENRE_MAX_CHARACTERS);
    // Torst refuses a list whose entries repeat after normalization.
    if (name && !genres.includes(name)) genres.push(name);
    if (genres.length === GENRE_LIMIT) break;
  }
  return genres.length ? genres : undefined;
}

/**
 * Builds the library members Torst keeps for a saved torrent from the catalog card it was
 * opened from. Up next groups a series' episodes only when its kind is known, and the IMDb
 * ID links the torrent to catalogs that key titles by it.
 */
export function buildLibraryDetails(movie?: LampaMovie): LibraryDetails | undefined {
  if (!movie) return undefined;
  const imdbId = typeof movie.imdb_id === 'string' && /^tt[0-9]{7,10}$/.test(movie.imdb_id) ? movie.imdb_id : undefined;
  const details: LibraryDetails = {
    description: normalizeLibraryDescription(movie.overview),
    genres: resolveGenres(movie),
    imdbId,
    kind: resolveCardKind(movie),
    year: resolveYear(movie),
  };
  const members = Object.keys(details) as Array<keyof LibraryDetails>;
  members.forEach(member => {
    if (details[member] === undefined) delete details[member];
  });
  return Object.keys(details).length ? details : undefined;
}
