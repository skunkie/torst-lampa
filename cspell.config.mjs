// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import { spellingParsers } from './spelling-parser.mjs';

export default {
  dictionaries: ['css', 'html', 'html-symbol-entities', 'typescript'],
  files: ['*.md', 'src/**/*.ts', 'tests/**/*.ts', 'landing/**/*.{html,css,js}', '*.mjs'],
  ignoreRegExpList: ['/\\p{Script=Cyrillic}+/gu'],
  language: 'en-US',
  overrides: [
    { filename: '**/*.{ts,js,mjs}', parser: 'torrplay-source' },
    { filename: '**/*.md', parser: 'torrplay-markdown' },
    { filename: '**/*.css', parser: 'torrplay-css' },
  ],
  plugins: [{ parsers: spellingParsers }],
  useGitignore: true,
  version: '0.2',
  words: [
    'bodyless',
    'Caminandes',
    'ffprobe',
    'Jackett',
    'Lampa',
    'longhands',
    'Mbit',
    'preroll',
    'Prowlarr',
    'Sintel',
    'timecode',
    'timecodes',
    'Tizen',
    'TMDB',
    'TorrPlay',
    'unminified',
    'unviewed',
  ],
};
