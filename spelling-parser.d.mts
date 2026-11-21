// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import type { Parser } from 'cspell';

export function extractCssProse(content: string): string;
export function extractMarkdownProse(content: string): string;
export function extractSourceProse(content: string, filename: string): string;
export const spellingParsers: Parser[];
