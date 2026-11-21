// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

const DESCRIPTION_MAX_CHARACTERS = 4096;
export const GENRE_MAX_CHARACTERS = 128;
const TITLE_MAX_CHARACTERS = 1024;

// Torst refuses control characters in library text; a description may still keep LF and tab.
function removeControlCharacters(text: string, keptCharacters = ''): string {
  return Array.from(text).filter(character => {
    const code = character.charCodeAt(0);
    const isControl = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    return !isControl || keptCharacters.includes(character);
  }).join('');
}

function normalizeUnicode(text: string): string {
  return typeof text.normalize === 'function' ? text.normalize('NFC') : text;
}

function truncateCharacters(text: string, maxCharacters: number): string {
  const characters = Array.from(text);
  return characters.length > maxCharacters ? characters.slice(0, maxCharacters).join('').trim() : text;
}

/**
 * Normalizes a one-line library member the way Torst stores it, or returns undefined when
 * nothing is left, since Torst refuses empty text.
 */
export function normalizeLibraryLine(candidate: unknown, maxCharacters = TITLE_MAX_CHARACTERS): string | undefined {
  if (typeof candidate !== 'string') return undefined;
  const text = removeControlCharacters(normalizeUnicode(candidate).replace(/\s+/g, ' ')).trim();
  return text ? truncateCharacters(text, maxCharacters) : undefined;
}

export function normalizeLibraryDescription(candidate: unknown): string | undefined {
  if (typeof candidate !== 'string') return undefined;
  const text = removeControlCharacters(normalizeUnicode(candidate).replace(/\r\n?/g, '\n'), '\n\t').trim();
  return text ? truncateCharacters(text, DESCRIPTION_MAX_CHARACTERS) : undefined;
}
