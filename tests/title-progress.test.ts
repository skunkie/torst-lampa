// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { it } from 'node:test';

import { resolveTitleProgressKey, resolveTitleProgressLookup } from '../src/engine/title-progress';

const movieFile = { episode: null, hash: 42, season: null, serial: false };
const episodeFile = { episode: 2, hash: 42, season: 0, serial: true };

it('uses catalog IDs for movies and explicit season and episode numbers for series', () => {
  assert.equal(resolveTitleProgressKey({ id: 123, source: 'tmdb' }, movieFile), 'tmdb-movie-123');
  assert.equal(resolveTitleProgressKey({ id: 123, original_name: 'Show' }, episodeFile), 'tmdb-tv-123-s0e2');
  assert.equal(resolveTitleProgressLookup({ id: 123, media_type: 'tv' }), 'tmdb-tv-123-');
  assert.equal(resolveTitleProgressKey({ imdb_id: 'tt1234567', source: 'other' }, movieFile), 'imdb-tt1234567');
  assert.equal(resolveTitleProgressKey({ imdb_id: 'tt1234567', original_name: 'Show', source: 'other' }, episodeFile), 'imdb-tt1234567-s0e2');
});

it('does not invent catalog IDs or episode identities from ambiguous metadata', () => {
  for (const movie of [{}, { id: 'trr_one' }, { id: 0 }, { id: '001' }, { id: 123, source: 'other' }, { imdb_id: 'invalid' }]) {
    assert.equal(resolveTitleProgressKey(movie, movieFile), undefined);
  }
  assert.equal(resolveTitleProgressKey({ id: 123 }, episodeFile), undefined);
  for (const episode of [null, -1, 10000, 1.5]) {
    assert.equal(resolveTitleProgressKey({ id: 123, original_name: 'Show' }, { ...episodeFile, episode }), undefined);
  }
  assert.equal(resolveTitleProgressKey({ id: 123, original_name: 'Show' }, { ...episodeFile, season: null }), undefined);
});

it('shares TMDB title identities with the CUB catalog for movies and episodes', () => {
  for (const source of ['tmdb', 'cub']) {
    assert.equal(resolveTitleProgressKey({ id: 123, imdb_id: 'tt1234567', source }, movieFile), 'tmdb-movie-123');
    assert.equal(resolveTitleProgressKey({ id: 123, original_name: 'Show', source }, episodeFile), 'tmdb-tv-123-s0e2');
    assert.equal(resolveTitleProgressLookup({ id: 123, media_type: 'tv', source }), 'tmdb-tv-123-');
  }
});
