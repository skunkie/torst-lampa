// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractCssProse, extractMarkdownProse, extractSourceProse } from '../spelling-parser.mjs';

describe('Spelling prose extraction', () => {
  it('checks real source comments while excluding strings, regular expressions, and template text', () => {
    const content = [
      'const first = "/* fixtureOne */";',
      "const second = '// fixtureTwo';",
      'const expression = /https?:\\/\\/fixtureThree/;',
      'const template = `/* fixtureFour */ ${value /* interpolationNote */} // fixtureFive`;',
      'call(/* argumentNote */);',
      'function empty() { /* bodyNote */ }',
      '// finalNote',
    ].join('\n');
    const prose = extractSourceProse(content, 'src/example.ts');

    for (const word of ['interpolationNote', 'argumentNote', 'bodyNote', 'finalNote']) assert.ok(prose.includes(word), word);
    for (const word of ['fixtureOne', 'fixtureTwo', 'fixtureThree', 'fixtureFour', 'fixtureFive', 'value']) assert.ok(!prose.includes(word), word);
    assert.equal(prose.length, content.length);
    assert.equal(prose.indexOf('finalNote'), content.indexOf('finalNote'));
  });

  it('keeps comments in files containing only comments', () => {
    assert.ok(extractSourceProse('// note', 'example.js').includes('note'));
    assert.ok(extractSourceProse('/* note */', 'example.mjs').includes('note'));
  });

  it('skips inline and fenced code in consecutive line comments and documentation blocks', () => {
    const content = [
      'function example() {',
      '  // Opening prose with `inlineCode`.',
      '  // ~~~js',
      '  // const hiddenCode = true;',
      '  // ~~~',
      '  /**',
      '   * Closing prose.',
      '   * ````ts',
      '   * nestedCode();',
      '   * ````',
      '   */',
      '}',
    ].join('\n');
    const prose = extractSourceProse(content, 'src/example.ts');

    assert.ok(prose.includes('Opening prose'));
    assert.ok(prose.includes('Closing prose'));
    for (const word of ['inlineCode', 'hiddenCode', 'nestedCode']) assert.ok(!prose.includes(word), word);
  });

  it('does not join comment fences across intervening source code', () => {
    const content = '// ```\nconst value = true;\n// Closing prose';
    assert.ok(extractSourceProse(content, 'src/example.ts').includes('Closing prose'));
  });

  it('keeps separate documentation blocks and comment paragraphs independent', () => {
    for (const content of [
      '/**\n * ```\n */\n/** Closing prose */',
      '// ```\n\n// Closing prose',
    ]) {
      assert.ok(extractSourceProse(content, 'src/example.ts').includes('Closing prose'));
    }
    assert.ok(extractCssProse('/* ``` */\n/* Closing prose */').includes('Closing prose'));
  });

  for (const filename of ['src/lang/translations.ts', 'landing/script.js']) {
    it(`extracts quoted and interpolated English text from ${filename}`, () => {
      const values = '{ first: "First prose", second: `Second prose ${hiddenIdentifier} final prose`, third: ("Third " + "prose") }';
      const content = filename.endsWith('.ts')
        ? 'const translations = { first: { en: "First prose", ru: "otherLocale" }, second: { en: `Second prose ${hiddenIdentifier} final prose` }, third: { en: ("Third " + "prose") } };'
        : `var i18n = { ru: { hiddenKey: 'otherLocale' }, "en": ${values} };`;
      const prose = extractSourceProse(content, filename);

      for (const word of ['First prose', 'Second prose', 'final prose', 'Third ', 'prose']) assert.ok(prose.includes(word), word);
      for (const word of ['hiddenIdentifier', 'otherLocale', 'hiddenKey']) assert.ok(!prose.includes(word), word);
      assert.equal(prose.length, content.length);
    });
  }

  it('checks literal template text containing backticks and skips expressions between multiple spans', () => {
    const content = 'const translations = { demo: { en: `First \\`code\\` ${firstValue} middle ${secondValue} end` } };';
    const prose = extractSourceProse(content, 'src/lang/translations.ts');
    for (const text of ['First', 'code', 'middle', 'end']) assert.ok(prose.includes(text), text);
    assert.ok(!prose.includes('firstValue'));
    assert.ok(!prose.includes('secondValue'));
  });

  it('does not select English-looking properties outside the translation files', () => {
    assert.ok(!extractSourceProse("const fixture = { en: 'fixtureValue' };", 'tests/example.ts').includes('fixtureValue'));
  });

  it('checks computed locale keys, conditional strings, and TypeScript expression wrappers', () => {
    const content = 'const translations = { first: { ["en"]: condition ? "First prose" : ("Second prose" as const) }, second: { en: <string>"Third prose" }, third: { en: "Fourth prose" satisfies string } };';
    const prose = extractSourceProse(content, 'src/lang/translations.ts');
    for (const text of ['First prose', 'Second prose', 'Third prose', 'Fourth prose']) assert.ok(prose.includes(text), text);
    assert.ok(!prose.includes('condition'));
  });

  it('keeps source positions with CRLF newlines and characters outside the basic multilingual plane', () => {
    const content = 'const icon = "😀";\r\n// finalNote\r\n';
    const prose = extractSourceProse(content, 'src/example.ts');
    assert.equal(prose.length, content.length);
    assert.equal(prose.indexOf('finalNote'), content.indexOf('finalNote'));
    assert.equal(prose.split('\r\n').length, content.split('\r\n').length);
  });

  it('checks CSS comments inside declarations while ignoring comment-like strings', () => {
    const content = '.example { content: "/* fixtureValue */"; color: /* actualNote */ red; }';
    const prose = extractCssProse(content);
    assert.ok(prose.includes('actualNote'));
    assert.ok(!prose.includes('fixtureValue'));
    assert.equal(prose.indexOf('actualNote'), content.indexOf('actualNote'));
  });

  it('excludes both Markdown fence styles, indented examples, and inline code', () => {
    const content = 'Opening prose `inlineCode`.\n\n~~~ts\ntildeCode\n~~~\n\n````\n```nestedCode```\n````\n\n    indentedCode\n\nClosing prose.';
    const prose = extractMarkdownProse(content);
    assert.ok(prose.includes('Opening prose'));
    assert.ok(prose.includes('Closing prose'));
    for (const word of ['inlineCode', 'tildeCode', 'nestedCode', 'indentedCode']) assert.ok(!prose.includes(word), word);
    assert.equal(prose.length, content.length);
    assert.equal(prose.indexOf('Closing prose'), content.indexOf('Closing prose'));
  });

  it('ignores an unclosed Markdown fence through the end of the document', () => {
    assert.ok(!extractMarkdownProse('Opening prose\n\n~~~js\nhiddenCode').includes('hiddenCode'));
  });
});
