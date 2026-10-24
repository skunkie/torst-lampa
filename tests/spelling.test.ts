// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const CSPELL_PATH = fileURLToPath(import.meta.resolve('cspell/bin'));
const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));

function checkSpelling(text: string, filename: string) {
  const result = spawnSync(process.execPath, [
    CSPELL_PATH, 'lint', '--config', 'cspell.config.mjs', '--no-progress', '--no-summary', `stdin://${filename}`,
  ], { cwd: PROJECT_ROOT, encoding: 'utf8', input: text, timeout: 30_000 });
  assert.ifError(result.error);
  return { output: result.stdout + result.stderr, status: result.status };
}

describe('American English spelling checks', () => {
  it('accepts American English in documentation and code comments', () => {
    for (const filename of ['spelling-example.md', 'src/spelling-example.ts']) {
      const result = checkSpelling('// The player recognizes the normalized color and summarizes its behavior.', filename);
      assert.equal(result.status, 0, result.output);
    }
  });

  it('reports British spelling and ordinary typos', () => {
    const text = 'The player recognises and summmarizes the result.';
    const result = checkSpelling(text, 'spelling-example.md');
    assert.equal(result.status, 1, result.output);
    for (const word of ['recognises', 'summmarizes']) assert.ok(result.output.includes(word), result.output);
    const quoted = checkSpelling('<!-- cspell:disable-next-line -->\n> ' + text, 'spelling-example.md');
    assert.equal(quoted.status, 0, quoted.output);
  });

  it('preserves project names, code references, Russian text, and encoded fixture data', () => {
    const result = checkSpelling(
      '// TorrPlay uses `Lampa.Reguest` and `Lampa.Noty` with Jackett and Prowlarr.\n'
      + '// Русский текст остается без проверки.\n'
      + 'const encoded = "xt%3Durn%3Abtih%3A123";',
      'src/spelling-example.ts'
    );
    assert.equal(result.status, 0, result.output);
  });

  it('skips code and fixture data while checking comments and documentation', () => {
    const fixture = 'Sintl';
    const allowed = checkSpelling(`const resultKey = '${fixture}'; const comment = '/* ${fixture} */';`, 'tests/spelling-example.ts');
    assert.equal(allowed.status, 0, allowed.output);
    const comment = checkSpelling(`// ${fixture}`, 'tests/spelling-example.ts');
    assert.equal(comment.status, 1, comment.output);
    const rejected = checkSpelling(fixture, 'spelling-example.md');
    assert.equal(rejected.status, 1, rejected.output);
    assert.ok(rejected.output.includes(fixture), rejected.output);
  });

  it('checks English UI strings while leaving other locale strings alone', () => {
    for (const filename of ['src/lang/translations.ts', 'landing/script.js']) {
      const translation = filename.endsWith('.ts')
        ? (english: string) => `const translations = {\n demo: {\n en: '${english}',\n ru: 'recognises',\n },\n};`
        : (english: string) => `var i18n = {\n en: {\n demo: '${english}',\n },\n ru: {\n demo: 'recognises',\n },\n};`;
      const accepted = checkSpelling(translation('The player recognizes the result.'), filename);
      assert.equal(accepted.status, 0, accepted.output);
      const rejected = checkSpelling(translation('The player recognises the result.'), filename);
      assert.equal(rejected.status, 1, rejected.output);
      assert.ok(rejected.output.includes('recognises'), rejected.output);
    }
  });

  it('checks template-literal translations and reports their original source positions', () => {
    const text = 'const translations = {\n  demo: {\n    en: `The player recognises the result.`,\n  },\n};';
    const result = checkSpelling(text, 'src/lang/translations.ts');
    assert.equal(result.status, 1, result.output);
    assert.ok(result.output.includes('src/lang/translations.ts:3:21'), result.output);
    assert.ok(result.output.includes('recognises'), result.output);
  });

  it('excludes tilde-fenced Markdown code while still checking the following prose', () => {
    const code = '~~~ts\nconst recognises = true;\n~~~\n';
    const accepted = checkSpelling(code + '\nThe player recognizes the result.', 'spelling-example.md');
    assert.equal(accepted.status, 0, accepted.output);
    const rejected = checkSpelling(code + '\nThe player recognises the result.', 'spelling-example.md');
    assert.equal(rejected.status, 1, rejected.output);
    assert.ok(rejected.output.includes('spelling-example.md:5:12'), rejected.output);
  });
});
