// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import { isTokenComment, tokenize } from '@csstools/css-tokenizer';
import { fromMarkdown } from 'mdast-util-from-markdown';
import ts from 'typescript';

function mask(content, ranges, shouldKeep = false) {
  const output = (shouldKeep ? content.replace(/[^\r\n]/g, ' ') : content).split('');
  for (const [start, end] of ranges) {
    for (let offset = start; offset < end; offset++) {
      output[offset] = shouldKeep ? content[offset] : (/[\r\n]/.test(content[offset]) ? content[offset] : ' ');
    }
  }
  return output.join('');
}

function forEachMarkdownCode(content, visitCode) {
  function visit(node) {
    if (node.type === 'code' || node.type === 'inlineCode') {
      visitCode(node.position);
    } else {
      node.children?.forEach(visit);
    }
  }
  visit(fromMarkdown(content));
}

export function extractMarkdownProse(content) {
  const ranges = [];
  forEachMarkdownCode(content, ({ end, start }) => ranges.push([start.offset, end.offset]));
  return mask(content, ranges);
}

function excludeCommentCode(content, ranges) {
  const grouped = [];
  for (const [start, end] of ranges.sort((first, second) => first[0] - second[0])) {
    const previous = grouped[grouped.length - 1];
    const isContinuingLineComment = previous
      && content.startsWith('//', previous[0])
      && content.startsWith('//', start)
      && /^[\t ]*\r?\n[\t ]*$/.test(content.slice(previous[1], start));
    if (isContinuingLineComment) previous[1] = end;
    else grouped.push([start, end]);
  }
  const codeRanges = [];
  for (const [start, end] of grouped) {
    const offsets = [];
    let lineStart = start;
    const lines = content.slice(start, end).split('\n').map(line => {
      const prefixLength = line.match(/^[\t ]*(?:\/\*+ ?|\/\/ ?|\* ?)?/)[0].length;
      offsets.push(lineStart + prefixLength);
      lineStart += line.length + 1;
      return line.slice(prefixLength).replace(/\*\/$/, '');
    });
    forEachMarkdownCode(lines.join('\n'), ({ end: codeEnd, start: codeStart }) => {
      codeRanges.push([offsets[codeStart.line - 1] + codeStart.column - 1, offsets[codeEnd.line - 1] + codeEnd.column - 1]);
    });
  }
  return mask(mask(content, ranges, true), codeRanges);
}

function collectTranslationRanges(node, source, ranges) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    ranges.push([node.getStart(source) + 1, node.end - 1]);
  } else if (ts.isTemplateExpression(node)) {
    ranges.push([node.head.getStart(source) + 1, node.head.end - 2]);
    for (const { literal } of node.templateSpans) {
      ranges.push([literal.getStart(source) + 1, literal.end - (ts.isTemplateTail(literal) ? 1 : 2)]);
    }
  } else if (ts.isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) collectTranslationRanges(property.initializer, source, ranges);
    }
  } else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)) {
    collectTranslationRanges(node.expression, source, ranges);
  } else if (ts.isConditionalExpression(node)) {
    collectTranslationRanges(node.whenTrue, source, ranges);
    collectTranslationRanges(node.whenFalse, source, ranges);
  } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    collectTranslationRanges(node.left, source, ranges);
    collectTranslationRanges(node.right, source, ranges);
  }
}

export function extractSourceProse(content, filename) {
  const source = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true);
  const comments = new Map();
  const translations = [];
  const hasTranslations = /(?:^|\/)(?:src\/lang\/translations\.ts|landing\/script\.js)$/.test(filename.replace(/\\/g, '/'));
  function visit(node) {
    for (const range of [...(ts.getLeadingCommentRanges(content, node.pos) || []), ...(ts.getTrailingCommentRanges(content, node.end) || [])]) {
      comments.set(range.pos, [range.pos, range.end]);
    }
    if (hasTranslations && ts.isPropertyAssignment(node)) {
      const name = ts.isComputedPropertyName(node.name) ? node.name.expression : node.name;
      if ((ts.isIdentifier(name) || ts.isStringLiteralLike(name)) && name.text === 'en') {
        collectTranslationRanges(node.initializer, source, translations);
      }
    }
    node.getChildren(source).forEach(visit);
  }
  visit(source);
  const commentRanges = [...comments.values()];
  const prose = excludeCommentCode(content, commentRanges);
  const output = prose.split('');
  for (const [start, end] of translations) {
    for (let offset = start; offset < end; offset++) output[offset] = content[offset];
  }
  return output.join('');
}

export function extractCssProse(content) {
  const ranges = tokenize({ css: content }).filter(isTokenComment).map(token => [token[2], token[3] + 1]);
  return excludeCommentCode(content, ranges);
}

function createParser(name, extract) {
  return {
    name,
    parse: (content, filename) => ({
      content,
      filename,
      parsedTexts: [{ range: [0, content.length], text: extract(content, filename) }],
    }),
  };
}

export const spellingParsers = [
  createParser('torrplay-source', extractSourceProse),
  createParser('torrplay-markdown', extractMarkdownProse),
  createParser('torrplay-css', extractCssProse),
];
