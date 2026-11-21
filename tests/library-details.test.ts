// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildLibraryDetails } from '../src/engine/library-details';
import { normalizeLibraryDescription, normalizeLibraryLine } from '../src/utils/library-text';

describe('Library details from catalog cards', () => {
  it('maps a movie card to its kind, year, IMDb ID, description, and genres', () => {
    assert.deepEqual(buildLibraryDetails({
      genres: [{ id: 16, name: 'Animation' }, { id: 14, name: 'Fantasy' }],
      id: 45745,
      imdb_id: 'tt1727587',
      original_title: 'Sintel',
      overview: 'A girl searches for her dragon.',
      release_date: '2010-09-27',
      title: 'Sintel',
    }), {
      description: 'A girl searches for her dragon.',
      genres: ['Animation', 'Fantasy'],
      imdbId: 'tt1727587',
      kind: 'movie',
      year: 2010,
    });
  });

  it('marks a series card as a series from its first air date', () => {
    assert.deepEqual(buildLibraryDetails({ first_air_date: '2015-03-01', name: 'Caminandes', original_name: 'Caminandes' }), { kind: 'series', year: 2015 });
  });

  it('omits details Torst would refuse and returns nothing for a card without any', () => {
    assert.deepEqual(buildLibraryDetails({ imdb_id: 'tt12', overview: '   ', release_date: '0999-01-01', title: 'Spring' }), { kind: 'movie' });
    assert.equal(buildLibraryDetails({ title: 'Spring' }), undefined);
    assert.equal(buildLibraryDetails(undefined), undefined);
  });

  it('keeps at most sixteen genres that stay distinct after normalization', () => {
    const genres = [{ id: 1, name: ' Drama ' }, { id: 2, name: 'Drama' }, { id: 3, name: '' }, { id: 4, name: 'x'.repeat(200) }]
      .concat(Array.from({ length: 20 }, (_unused, index) => ({ id: index + 10, name: `Genre ${index}` })));
    const details = buildLibraryDetails({ genres, title: 'Spring' });
    assert.equal(details?.genres?.length, 16);
    assert.deepEqual(details?.genres?.slice(0, 2), ['Drama', 'x'.repeat(128)]);
    assert.equal(new Set(details?.genres).size, 16);
  });
});

describe('Library text normalization', () => {
  it('stores one-line text in composed form with collapsed whitespace and no control characters', () => {
    assert.equal(normalizeLibraryLine(' Cosmos\t\nLaundromat\u0007 '), 'Cosmos Laundromat');
    assert.equal(normalizeLibraryLine('Café'), 'Café');
    assert.equal(normalizeLibraryLine(' \u0000 '), undefined);
    assert.equal(normalizeLibraryLine(42), undefined);
  });

  it('keeps line breaks and tabs in a description and limits it to 4096 characters', () => {
    assert.equal(normalizeLibraryDescription('First\r\nSecond\rThird\tend\u0001'), 'First\nSecond\nThird\tend');
    assert.equal(Array.from(normalizeLibraryDescription('\u{1F409}'.repeat(5000)) || '').length, 4096);
  });
});
