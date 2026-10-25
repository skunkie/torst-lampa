<!--
SPDX-FileCopyrightText: 2026 TorrPlay

SPDX-License-Identifier: MIT
-->

# Contributing

Thanks for helping with the Torst Lampa plugin. This page covers what a
change needs before it can be merged. Taking part is governed by the [code of
conduct](CODE_OF_CONDUCT.md).

The plugin is a standalone JavaScript bundle that runs inside Lampa on
Android TV, Tizen, webOS and desktop browsers. It talks to Torst through
`/api/v1/` resources and the `/readyz` readiness check. Changes must work
without external runtime dependencies or legacy TorrServer routes and stay
within the supported browser runtime floor.

## Before you start

For anything larger than a small fix, open an issue first so the approach can
be agreed before you write it. The issue forms ask for what a report needs:
the plugin version, the device and Lampa build, the settings involved, and
what happened.

A problem in the Torst server itself belongs in the
[Torst repository](https://github.com/torrplay/torst/issues) instead.

Report a security problem privately, as the [security policy](SECURITY.md)
describes, rather than in a public issue.

## Setting up

You need Node.js 24.18+ or 26.4+ and npm, plus [reuse](https://reuse.software/).
Install the dependencies with `npm install`. The checks a change has to pass
are:

```bash
npm test
npm run typecheck
npm run lint
npm run coverage
npm run build
reuse lint
```

`npm run build` writes `dist/torst.js`, `dist/torst.min.js` and the
landing page `dist/index.html`. To try a change on a device, serve `dist/`
and add the script's URL as a plugin in Lampa.

`npm run lint` includes American English spell checking with CSpell. Run
`npm run lint:spelling` to check spelling alone. It checks documentation,
source comments, and English UI translations. Code identifiers, fixture
data, code examples, and Cyrillic text are outside its scope. The small
vocabulary in `cspell.config.mjs` covers project names and technical terms.
Fix ordinary spelling errors instead of adding exceptions.
For an intentional quotation with different spelling, use a narrowly scoped
`cspell:disable-next-line` directive.

## Making a change

- **Keep it cohesive.** One change and the refactors and tests it needs make
  one commit, even across several modules. Split changes only when each part
  is meaningful alone and leaves the repository working.
- **Add tests.** Every bug fix, refactor and feature comes with tests under
  `tests/`, written with `node:test` and `node:assert/strict`, that cover its
  edge cases and error paths. For a bug fix, include a test that fails
  without the fix. `npm run coverage` fails below the thresholds set in
  `package.json`.
- **Stay within the runtime floor.** The bundle targets Chromium 79, the
  oldest engine among the supported TVs. The build down-levels syntax but
  does not polyfill missing methods, so check a newer runtime API against
  that version before using it.
- **Keep it remote-friendly.** Menus and inputs use `Lampa.Select` and
  `Lampa.Input` so every action works with a TV remote's D-pad.
- **Translate every string.** A user-facing string goes in
  `src/lang/translations.ts` with both English and Russian text, keys in
  alphabetical order.
- **Use safe sample data.** Use invented titles such as "Test Movie 2026"
  or Blender open movies such as Sintel and Big Buck Bunny. Avoid commercial
  film and series titles, real magnet links, info hashes, and tracker URLs.
- **Follow the surrounding code.** Standard TypeScript naming applies, files
  are `kebab-case`, interface members and object literal keys are sorted
  alphabetically (case-sensitively, enforced by the linter), and boolean
  names read as predicates. Field names defined by an external API or by
  Lampa keep their own spelling.
- **Comment sparingly.** Add a comment only for a reason the code cannot show.
  History of a bug belongs in the commit message, not the source.
- **Keep the docs true.** A change to behavior or a setting updates
  `README.md` in the same change. Documentation states current behavior,
  without contrasting it with an earlier design.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):
`type(scope): summary`, with a scope such as `api`, `auth`, `instances`,
`engine`, `ui` or `build`, and none for a change that genuinely spans
several. Keep the subject imperative, lowercase after the colon, and without
a trailing period.

A non-trivial commit adds a body after a blank line, written as `-` bullets
that are each a complete sentence ending in a period. Describe observable
behavior and important implementation decisions, not a file-by-file list of
edits.

```text
feat(instances): add parallel latency benchmark for auto-selection

- Ping all configured Torst instances concurrently using /readyz.
- Route playback and metadata requests to the lowest-latency instance.
- Notify the user when failover engages because an instance stopped responding.
```

The release notes are generated from commit subjects, so a subject is worth
writing for a reader who has not seen the change. Every commit should build
and pass the checks above on its own.

## Pull requests

- Describe what the change does and why, and link the issue it closes.
- Run the checks above before opening a pull request. CI runs type checks,
  lint, coverage, and the build on pull requests targeting `main`.
- Keep review comments and replies about the work, and push follow-up commits
  rather than rewriting history while a review is in progress. When history is
  rewritten before merging, keep each commit's author and committer dates
  identical.

## License

The plugin is MIT licensed. By contributing you agree that your contribution
is provided under the same license. Every file carries an SPDX copyright and
license header, or is covered by `REUSE.toml`, and `reuse lint` fails when one
does not, so a new file needs its header.
