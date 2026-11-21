// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { resolveFileIndex, resolveFileInfo, selectVideoFiles } from '../src/engine/file-parser';
import { resolveTitleProgressKey } from '../src/engine/title-progress';

describe('File Parser', () => {
  it('resolves duplicate file paths by object identity before falling back to path matching', () => {
    const firstFile = { path: 'duplicate.mkv' };
    const secondFile = { path: 'duplicate.mkv' };
    const torrentFiles = [firstFile, secondFile];

    assert.equal(resolveFileIndex(torrentFiles, secondFile), 1);
    assert.equal(resolveFileIndex(torrentFiles, { path: 'duplicate.mkv' }), 0);
    assert.equal(resolveFileIndex(torrentFiles, { path: 'missing.mkv' }), -1);
  });
});

describe('File Parser (selectVideoFiles)', () => {
  it('keeps video files in natural order and tolerates missing file lists', () => {
    const files = [
      { name: 'readme.txt', path: 'readme.txt' },
      { name: 'Show.S01E10.MKV', path: 'Show.S01E10.MKV' },
      { name: 'Show.S01E2.mp4', path: 'Show.S01E2.mp4' },
    ];
    assert.deepEqual(selectVideoFiles(files).map(file => file.name), ['Show.S01E2.mp4', 'Show.S01E10.MKV']);
    assert.deepEqual(selectVideoFiles(undefined), []);
  });

  it('detects video files by path first, matching the playlist the engine builds', () => {
    const files = [
      { name: 'Episode 1', path: 'Show/ep1.mkv' },
      { name: 'notes.mkv', path: 'Show/notes.txt' },
    ];
    assert.deepEqual(selectVideoFiles(files).map(file => file.path), ['Show/ep1.mkv']);
  });
});

describe('File Parser (Torst file details)', () => {
  it('lets Torst\'s media type decide and falls back to the extension only without one', () => {
    const files = [
      { mediaType: 'video/ogg', name: 'Spring.ogv', path: 'Spring.ogv' },
      { mediaType: 'video/mp2t', name: 'Spring.m2ts', path: 'Spring.m2ts' },
      { mediaType: 'application/octet-stream', name: 'Spring.mkv', path: 'Spring.mkv' },
      { name: 'Spring.vob', path: 'Spring.vob' },
      { mediaType: 'text/plain', name: 'Spring.txt', path: 'Spring.txt' },
    ];
    assert.deepEqual(selectVideoFiles(files).map(file => file.name), ['Spring.m2ts', 'Spring.ogv', 'Spring.vob']);
  });

  it('takes Torst\'s season with its episode unless the name or folder gives a higher one', () => {
    const seriesCard = { first_air_date: '2013-01-01', id: 1, name: 'Caminandes', original_name: 'Caminandes' };
    const torstEpisode = { number: 3, season: 2 };
    const defaulted = resolveFileInfo({ name: 'Caminandes.Ep-3.mkv', path: 'Caminandes/Caminandes.Ep-3.mkv', torstEpisode }, seriesCard, 'hash');
    assert.deepEqual([defaulted.season, defaulted.episode], [2, 3]);
    const fromFolder = resolveFileInfo({ name: 'Caminandes.Ep-3.mkv', path: 'Season 4/Caminandes.Ep-3.mkv', torstEpisode: { number: 3, season: 1 } }, seriesCard, 'hash');
    assert.deepEqual([fromFolder.season, fromFolder.episode], [4, 3]);
  });

  it('fills in the episode Torst numbers only when the name gives none, keeping the timeline hash', () => {
    const torstEpisode = { number: 7, season: 2 };
    const unnumbered = { name: 'Caminandes.mkv', path: 'Caminandes/Caminandes.mkv' };
    const plain = resolveFileInfo(unnumbered, undefined, 'hash');
    const filled = resolveFileInfo({ ...unnumbered, torstEpisode }, undefined, 'hash');
    assert.deepEqual(filled, { ...plain, episode: 7, season: 2, serial: true });
    const seriesCard = { first_air_date: '2013-01-01', id: 1, name: 'Caminandes', original_name: 'Caminandes' };
    assert.equal(resolveFileInfo({ ...unnumbered, torstEpisode }, seriesCard, 'hash').episode, 7);
    const numbered = resolveFileInfo({ name: 'Show.S01E02.mkv', path: 'Show.S01E02.mkv', torstEpisode }, undefined, 'hash');
    assert.equal(numbered.season, 1);
    assert.equal(numbered.episode, 2);
  });
});

describe('File Parser (movie cards)', () => {
  it('keeps a movie card file out of the episode fallback so it keeps the movie progress key', () => {
    const movieCard = { id: 45745, original_title: 'Sintel', release_date: '2010-09-27', title: 'Sintel' };
    const file = { name: 'Sintel.Episode.2.mkv', path: 'Sintel/Sintel.Episode.2.mkv', torstEpisode: { number: 2, season: 1 } };
    const info = resolveFileInfo(file, movieCard, 'hash');
    assert.deepEqual(info, resolveFileInfo({ name: file.name, path: file.path }, movieCard, 'hash'));
    assert.equal(info.serial, false);
    assert.equal(resolveTitleProgressKey(movieCard, info), 'tmdb-movie-45745');
  });
});

describe('File Parser (Lampa episode parser)', () => {
  const originalLampa = (globalThis as any).Lampa;
  afterEach(() => { (globalThis as any).Lampa = originalLampa; });

  it('fills in Torst\'s season and episode over the default season Lampa\'s parser gives', () => {
    const parsedNames: string[] = [];
    (globalThis as any).Lampa = {
      Torserver: { parse: (data: { filename: string }) => { parsedNames.push(data.filename); return { episode: null, hash: 99, season: 1, serial: true }; } },
      Utils: { clearHtmlTags: (text: string) => text },
    };
    const info = resolveFileInfo({ name: 'Caminandes.Ep-3.mkv', path: 'Caminandes.Ep-3.mkv', torstEpisode: { number: 3, season: 2 } }, { name: 'Caminandes', original_name: 'Caminandes' });
    assert.deepEqual(info, { episode: 3, hash: 99, season: 2, serial: true });
    assert.deepEqual(parsedNames, ['Caminandes.Ep-3.mkv']);
  });
});
