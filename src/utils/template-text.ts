// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

/**
 * Prepares text for Lampa's template filling, which inserts each value into HTML through a
 * plain string replacement: markup is dropped, the characters HTML would read as markup are
 * escaped, `$` is doubled so the replacement keeps it literally, and `{` is written as an
 * entity so text such as `{size}` is not filled by a later value.
 */
export function toTemplateText(text: string): string {
  const withoutMarkup = Lampa.Utils?.clearHtmlTags ? Lampa.Utils.clearHtmlTags(text) : text;
  return withoutMarkup
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\$/g, '$$$$');
}

