<!--
SPDX-FileCopyrightText: 2026 TorrPlay

SPDX-License-Identifier: MIT
-->

# Repository Agent Instructions

## Repository Overview

This repository contains a [Torst](https://github.com/torrplay/torst) plugin for the [Lampa](https://github.com/yumata/lampa) media client. The plugin is authored in TypeScript, adheres to strict linting and typechecking rules, and compiles into a standalone JavaScript bundle (`dist/torst.js` and `dist/torst.min.js`) suitable for execution across web browsers, Android TV, Tizen, and WebOS.

## Repository Structure & Module Organization

The codebase is organized into domain-driven modules under `src/` and mirrored under `tests/`:

```text
src/
├── api/
│   ├── auth.ts              # AuthManager: Password sign-in and playback tokens
│   ├── http-client.ts       # Unified HTTP transport with Lampa.Reguest adapter and fetch fallback
│   └── torst.ts             # TorstApi: Torst resource client and wire adapters
├── engine/
│   ├── database-search.ts   # Saved-torrent search through the instance's search filter, for global search and the filtered database view
│   ├── engine-utils.ts      # Guarded modal close, viewed marking, and watch history recording
│   ├── episode-preview.ts   # TMDB season episode lookup for file list stills, names, and air dates
│   ├── external-progress.ts # External-player return fallback through per-file Torst viewings
│   ├── file-parser.ts       # Torrent file sorting, video detection, and season/episode/timeline resolution
│   ├── media-context.ts     # Movie card context and poster URL resolution
│   ├── playback-focus.ts    # Restores the originating view after internal or external playback
│   ├── playback-progress.ts # Profile-scoped timeline hydration and server progress writes
│   ├── playback-session.ts  # File list modal, single/multi-file playback, and player item construction
│   ├── player-playlist.ts   # Restores the handed-over playlist when Lampa empties it on episode switches
│   ├── saved-torrents.ts    # SavedTorrents: batched lookup cache of torrents stored in the database
│   ├── title-progress.ts    # Catalog identities shared by TMDB, CUB, and IMDb progress
│   └── torst-engine.ts      # Playback routing, parser integration, file resolution, and Lampa.Player hand-off
├── instances/
│   └── instance-manager.ts  # Multi-instance CRUD, latency benchmarking, auto selection, and failover
├── lang/
│   └── translations.ts      # TRANSLATIONS table and translate()/initTranslations() helpers
├── providers/
│   ├── parser-hook.ts       # Lampa native torrent parser interception and result injection
│   ├── provider-manager.ts  # ProviderManager: Jackett/Prowlarr provider CRUD and legacy key sync
│   └── provider-search.ts   # Aggregated multi-provider search, dedupe, and ranking
├── types/
│   ├── lampa.d.ts           # External Lampa ambient API interfaces (alphabetically sorted)
│   ├── provider.ts          # Search provider domain models and response types (alphabetically sorted)
│   └── torst.ts             # Torst domain models and response types (alphabetically sorted)
├── ui/
│   ├── about.ts             # AboutUi: Plugin version, build date, and commit
│   ├── card-watched.ts      # Watched progress overlay on movie cards
│   ├── catalog-choice.ts    # Movie card details button and parser context menu injection
│   ├── database-search.ts   # DatabaseSearch: Lampa global search source for saved Torst torrents
│   ├── file-list-item.ts    # Native-template file list rows with lazy episode stills
│   ├── instance-pool.ts     # InstancePoolUi: Instance pool manager and per-instance action menus
│   ├── play-dialog.ts       # Pre-playback options modal (storage type and database persistence)
│   ├── preload-modal.ts     # Preload progress polling, native fullscreen loading UI, and stats
│   ├── profile-header.ts    # Native Lampa top-bar access to the per-instance profile picker
│   ├── profiles.ts          # Per-instance profile selection, CRUD, and authenticated avatars
│   ├── provider-result-row.ts # Full-width torrent rows and media tags for the provider global search tab
│   ├── provider-settings.ts # ProviderSettingsUi: Search provider pool manager and action modals
│   ├── saved-torrent-card.ts # Saved torrent card, viewed action, and watched overlay, shared by the library and global search
│   ├── saved-torrent-files.ts # File list modal for saved torrents, shared by the library and global search
│   ├── settings.ts          # SettingsUi: Settings folder, parameters, and shared menu helpers
│   ├── settings-keys.ts     # Storage keys shared with modules that SettingsUi itself depends on
│   ├── sidebar.ts           # SidebarManager: Main menu button and native TorrServer visibility toggling
│   ├── torst-torrents.ts    # TorstTorrentsComponent: Database torrents browser and file manager
│   └── up-next.ts           # Profile Up Next view, exact file selection, and dismissal
├── utils/
│   ├── search-query.ts      # Lenient URI decoding of Lampa global search queries
│   ├── storage-obfuscation.ts # Storage credential obfuscation codec with reversible cipher
│   ├── template-text.ts     # Safe text for Lampa HTML template replacement
│   ├── trigger-setting.ts   # Reads and writes Lampa on/off settings in the string form Lampa stores
│   └── uuid.ts              # RFC 4122 v4 UUID generator with older TV runtime fallback
├── index.ts                 # Plugin lifecycle bootstrap and Lampa ready event listeners
└── version.ts               # PLUGIN_VERSION and build metadata injected at bundle time
```

## Core Architectural Rules & Constraints

1. **Torst API Surface**:
   - Match the contract in `~/projects/torrplay-rs/api/openapi.yaml`. Use `/api/v1/` resources and unauthenticated `/readyz` for readiness and latency checks.
   - Torrents and files have opaque IDs. Find a torrent by repeated `info_hash` filters; never place an info hash in a resource ID path.
   - Follow `items` and `links.next` for cursor pagination. Torst lists persisted torrents by default; `retention=any` includes temporary ones.
   - Use per-file `POST .../preloads`, then read or delete the returned preload resource. Stream through a file's `/content` resource.
   - Configuration changes use `/configuration`, `application/merge-patch+json`, and the resource's current ETag in `If-Match`. Settings patches need the same precondition.
   - Target the current Torst development contract. Do not add backward compatibility or migration paths for older API shapes or TorrPlay state.
   - Never call legacy TorrPlay, TorrServer, or qBittorrent endpoints on a Torst instance.

2. **Multi-Instance Pool with Latency Preference**:
   - Support arbitrary numbers of Torst instances, configured via Lampa settings and stored in `Lampa.Storage`.
   - Each instance tracks connectivity status and round-trip ping time.
   - In "Auto" mode, instances are pinged in parallel, and traffic routes to the reachable instance with the lowest latency.
   - If an active instance becomes unresponsive or encounters network failures, automatic failover selects the next best reachable instance with notification to the user.

3. **Storage and Persistence**:
   - Torst's wire storage modes are `memory` and `disk`; the plugin maps its internal `file` choice to `disk`.
   - Use `retention: persisted` to save and `retention: temporary` for temporary playback, in both JSON and multipart creation. Temporary torrents use memory storage and omit title, poster, and other library metadata. Torst handles their idle cleanup; never automatically delete after playback. A duplicate temporary torrent is promoted through an ETag-protected configuration patch when saving; temporary playback must never downgrade a persisted torrent.
   - Create with `magnet_uri` JSON or upload `metainfo` in multipart data. Download URL-only releases on the client before upload.

4. **Preload Before Player Hand-off**:
   - Before launching video playback in `Lampa.Player`, initiate preloading via `POST /api/v1/torrents/{torrent_id}/files/{file_id}/preloads`.
   - Display Lampa's native fullscreen media loading screen (`Lampa.Loading.start(..., { media })`), showing movie backdrop, buffer progress percentage, loaded bytes vs. target bytes, download speed (in Mbit/s), and peer stats.
   - Hand off to `Lampa.Player.play()` once the buffer reaches readiness or threshold (>= 95%).
   - Cancel preloading via `DELETE /api/v1/torrents/{torrent_id}/files/{file_id}/preloads/{preload_id}` if dismissed by the user.
   - The preload modal stops on inactivity rather than a fixed deadline. Byte movement resets its clock, and peer movement extends the opening window before any bytes arrive. Torst creates a per-file preload once metadata is ready and returns its resource ID immediately; poll that resource, renew it after TTL expiry while buffering continues, and use torrent statistics for speed and peer counts. Release owned preloads before starting another on the same instance; cancellation must name the preload it belongs to. A connection failure while creating a preload is ambiguous and must not automatically repeat the POST. Client errors other than `408` and `429`, and credential failures, stop at once with a notice.
   - Unconditionally set `continue_play: true` (and `torrent: true`) on the player item and every entry of the playlist handed to `Lampa.Player.playlist()`, and hand the playlist over before `Lampa.Player.play()`, with the played item being one of its entries. Lampa skips its VAST preroll ad for an item marked `continue_play` only while that exact item object is in the player's current playlist (`Lampa.PlayerPlaylist`). Its separate torrent exemption only applies to URLs on the configured TorrServer address, which a Torst stream URL normally isn't and can't be relied on to be, and it reads no `torrent` flag on the item, so `torrent: true` is only a descriptive marker. Torst playback is always genuinely torrent playback, so there is no configurable "prevent ads" setting.
   - Switching episodes inside Lampa's player tears the player down first, which empties its playlist, and Lampa restores it only after the next episode has passed the preroll check. `src/engine/player-playlist.ts` therefore listens for the player's `create` event, which Lampa sends before that check, and puts back the playlist Torst handed over whenever the item being played is one of its entries and Lampa's playlist is momentarily empty.

5. **Authentication & Token Management**:
   - Support no authentication or password sign-in. Torst has no username, Basic authentication, or OAuth endpoint.
   - Create an access token through `POST /api/v1/access-tokens` with `name` and `password`; use its `secret` as the bearer credential. Request a one-day lifetime, share concurrent sign-ins, respect `expires_at`, and retry once after a 401 without invalidating a newer token.
   - Issue streaming and poster tokens through `POST /api/v1/playback-tokens`, appending `?token=...` to media URLs.
   - Keep tokens in memory and passwords obfuscated in storage.

6. **Lampa Settings & Instance Configuration**:
   - All Torst instance nodes (URLs, authentication, and credentials) are configured exclusively through the Instance Pool, ensuring a single source of truth without redundant standalone instance inputs.
   - Action items (managing instance pool, latency tests) must use `type: 'button'` with `onChange` listeners (never `type: 'static'`, and without redundant click listeners in `onRender`).
   - Instance pool management and instance actions must be TV-control friendly, using `Lampa.Select` and `Lampa.Input` for full D-pad remote compatibility without modal stacking.
   - The Torst settings folder is registered with `before: 'tmdb'`, never `after: 'server'`/`after: 'parser'` — Lampa removes both the `server` and `parser` settings folders entirely when `torrents_use` is disabled (the exact condition Torst users are in), and inserting relative to a component id that doesn't exist in the DOM silently no-ops, dropping Torst's own settings folder too. Anchor only to a component that is never conditionally removed.

7. **Sidebar & Database Torrents (`torst_torrents`)**:
   - Add a dedicated "Torst" entry to Lampa's main sidebar menu, positioned as the second item (right after whichever item the menu list currently has first), since native items are always appended to the end and never displace it.
   - Register custom component `torst_torrents` (`Lampa.Component.add`) to list torrents retrieved via `GET /api/v1/torrents`, supporting direct playback, multi-file selection, dynamic mark/unmark viewed toggle (`torrents_view`), storage switching (`PATCH /api/v1/torrents/{torrent_id}/configuration`), and database deletion (`DELETE /api/v1/torrents/{torrent_id}`).
   - The library listing defaults to persisted torrents. Both temporary and persisted resources carry `created_at`; use `retention` to tell them apart. Storage changes use the `/configuration` resource.
   - Opened from a global search row ("More"), `torst_torrents` is filtered to that query, through the same matching as `DatabaseSearch`, and pinned to the row's instance. A pinned view never updates `SavedTorrents` with another database's contents, and once its instance stops answering it drops the pin and falls back to regular instance selection.
   - Do not hook or monkey-patch the legacy `Lampa.Torserver` API (`.my`, `.add`, `.remove`, `.ip`, etc.). Torst's own sidebar entry and `torst_torrents` component are the sole, self-contained surface for browsing and managing Torst's database — native TorrServer integration is intentionally left untouched.
   - In "Always Torst" mode (`torst_playback_mode: 'torst'`), hide native TorrServer entry points (sidebar item, settings folder, torrent-view button) via the `torst--hide-torrserver` body class instead of intercepting their handlers.

8. **Torrent Card Player Choice, Routing, & Context Menu Actions**:
   - Provide a clean context menu (`torrent` event on `onlong`) on torrent cards:
     - "Play via Torst" at the top for immediate streaming.
     - "Save to Torst" for persistent library database storage, replaced by an inactive "Already in Torst" row once the torrent is known to be stored. Lampa builds this menu synchronously, so `SavedTorrents` (`src/engine/saved-torrents.ts`) resolves that state ahead of time: card `render` events queue the info hash, and a debounced batch resolves them through the `info_hash` filter of `GET /api/v1/torrents`. An unresolved hash keeps the save action. The cache is per-database, so it is dropped whenever `InstanceManager` reroutes requests (selection mode, selected instance, pool membership, or an instance URL) — nothing else forces a re-lookup, since a hash that is already cached is never queued again.
     - Dynamic viewed toggle: present only "Mark as viewed" if unviewed, or "Remove mark" if already viewed.
     - Strip native TorrServer `tomy: true` in "Always Torst" mode (`torst_playback_mode: 'torst'`).
   - Intercept `Lampa.Torrent.start` to route playback according to configurable playback mode (`torst_playback_mode`: `ask`, `torst`, `context`) seamlessly through Lampa's native playback actions.

9. **Torrent Search Provider Pool (Jackett/Prowlarr)**:
   - Support arbitrary numbers of Jackett and Prowlarr search providers, configured and persisted independently from the Torst instance pool via `ProviderManager` (`src/providers/provider-manager.ts`), with a TV-friendly `Lampa.Select`-based pool manager (`src/ui/provider-settings.ts`, "Manage Search Providers").
   - Sync each provider's URL/API key into Lampa's own stock `jackett_url`/`jackett_key` and `prowlarr_url`/`prowlarr_key` storage keys, so third-party extensions relying on those keys keep working.
   - `ProviderSearch.search()` (`src/providers/provider-search.ts`) queries all enabled providers concurrently, tolerates individual provider failures/timeouts without aborting the aggregate search, deduplicates results using the same fingerprint strategy as Lampa's own `resultKey` (prefer magnet URI, else hash/size/tracker/title), and ranks the merged results by seeder count descending.
   - `ParserHook` (`src/providers/parser-hook.ts`) wraps `Lampa.Parser.get` to route torrent search through the provider pool only when Torst is enabled **and** at least one provider is enabled; otherwise it delegates to the original native parser (or reports an error if none exists, since Lampa deletes its own native parser UI when `torrents_use = false`, leaving no native path to fall back to). Unlike `Lampa.Torserver`, this is the one native Lampa entry point Torst intentionally overrides, because there is no non-hook alternative for restoring search under that condition.
   - While `ParserHook` replaces the native parser and the `torst_provider_search` toggle is on, it registers its own `Lampa.Search` source for provider results, titled "Jackett / Prowlarr" so its tab and cached results stay apart from Lampa's own "Parser" source. The source searches with every query rather than only once its tab is opened, so the tab shows how many torrents were found, and it has no "More" view: each result is a row of its own (`src/ui/provider-result-row.ts`), drawn with Lampa's `torrent` row template and its quality, audio and subtitle tags, and sends the same `torrent` render and long-press events as Lampa's own torrent list so Torst's context menu and saved-torrent lookup work there too. An unset toggle starts from the user's `parse_in_search` preference at the moment the takeover first begins, and the toggle lives in the "Manage Search Providers" menu rather than the settings folder, offered there only while a takeover is active and the global search integration was installed, since it has no effect otherwise. Lampa's own `parse_in_search` source stays off for the whole takeover, because it would reach the providers anyway through the hooked parser; the user's own `parse_in_search` preference is saved and restored once the takeover ends.
   - `DatabaseSearch` (`src/ui/database-search.ts`) adds a separate, opt-in (`torst_database_search`) global search source for torrents saved in the Torst database. It asks `GET /api/v1/torrents` for the saved torrents matching the query (`search`, `fuzzy=true`) and keeps the instance's best-first order; matching happens only on the instance. It fails over only on network errors or `5xx` responses. It searches with every query and hands its row every match, so the tab shows how many saved torrents match; the row's "More" view appears once the matches span more than one page. Each row remembers the instance that produced it: playback and the "More" view go back to that instance, and rows from instances no longer in the pool are dropped. Its matches use the same card as `torst_torrents` (`src/ui/saved-torrent-card.ts`), with only the viewed mark on long press, since storage switching and deletion stay in the library view, and a multi-file torrent opens the same file list (`src/ui/saved-torrent-files.ts`). Global search opened from `torst_torrents` starts on this source's tab: it notes its tab from the `create` events Lampa's tab list sends between the search's `sources` and `open` events, selects it on `open`, and gives it focus so moving down from the keyboard lands there.

10. **TypeScript & Bundling**:
    - Written cleanly in TypeScript under `src/`.
    - Bundled using `esbuild` into standalone IIFE JavaScript in `dist/`.
    - **JavaScript Compatibility Floor**: the build target (`build.mjs`, `target: ['chrome79']`) is pinned to LG webOS TV 6.x's bundled Chromium (79) — the oldest/most restrictive runtime this plugin supports among its stated platforms (Android TV, Tizen, WebOS).
      - `esbuild`'s `target` only down-levels **syntax** (optional chaining `?.`, nullish coalescing `??`, logical assignment `||=`/`&&=`/`??=`, class fields, etc.) to an older equivalent. It does **not** polyfill missing **runtime** methods/APIs — calling one that doesn't exist on the target engine throws at runtime regardless of the build target.
      - Do not use runtime APIs that postdate Chromium 79 (2019-era V8) without adding an explicit polyfill first: `Array.prototype.at`, `String.prototype.at`, `String.prototype.replaceAll`, `Promise.any`, `Object.hasOwn`, `structuredClone`, `Array.prototype.findLast`/`findLastIndex`, `Array.prototype.group`/`groupBy`. `Promise.allSettled`, `Array.prototype.flat`/`flatMap`, `globalThis`, and `Object.fromEntries` are all fine (Chromium ≤76).
      - When in doubt, check a candidate API's browser support against Chromium 79 (Chrome 79, released December 2019) before using it — this list of examples is illustrative, not exhaustive.

11. **Alphabetical Ordering of Interface & Struct Properties**:
    - All interface properties, type literal members, and struct property definitions should be sorted alphabetically by key name.
    - Keeps domain models and wire adapters consistent with the Torst OpenAPI specification.
    - Translation dictionaries are sorted alphabetically by key too: `TRANSLATIONS` in `src/lang/translations.ts` and each locale of the landing page's `i18n` dictionary in `landing/script.js`.

12. **Profiles, Progress, and External Player Returns**:
    - Select a Torst profile independently for each instance. Profile renames use the current ETag. Offer only `person` profiles for selection; the device profile cannot be selected, renamed, deleted, or written by clients. Avatars require authenticated requests; never put an API access token in an image URL.
    - Keep existing Lampa timeline records intact. A selected Torst profile uses a separate timeline key scoped by instance, URL, profile, and opaque file ID. Never implicitly import local records into a server profile.
    - Read and write seconds-based progress through the selected profile's file progress resources. Actual player reports take priority. For external players that report no position, create a per-file viewing before hand-off, include its `viewing_id` in the content URL, and read its seconds-based estimate after return. Save that fallback to the native timeline in local mode or the selected profile in profile mode; never overwrite an exact player report. Suppress writes while applying server data, preserve server timestamps, and serialize/coalesce writes. Never estimate progress on the client from bytes, elapsed time, or catalog runtime. For identified TMDB or IMDb movies and episodes, also read and save title progress, associating writes with the opaque torrent and file IDs. Resume from the newer exact title or file record; catalog progress survives torrent deletion.
    - Up Next uses the server's entry order and opaque file IDs. Dismiss entries without deleting torrents or their progress. Expose the view from the Torst library.
    - Lampa's external player path does not call its internal player's exit callback. Track Torst's own external launch and browser visibility/focus return, restore the originating view once, and discard stale returns after navigation or unrelated playback.
    - The native Lampa top bar exposes profile selection through `Head.addIcon`. With multiple instances, select the instance before opening its profile picker. Keep the native head controller's focus restoration and its separate Lampa account profile button intact. Cover this entry point in `tests/profile-header.test.ts`.
    - Cover these behaviors in `tests/title-progress.test.ts`, `tests/external-progress.test.ts`, `tests/playback-focus.test.ts`, `tests/playback-progress.test.ts`, `tests/torst-profiles-api.test.ts`, `tests/profile-ui.test.ts`, and `tests/up-next.test.ts`.

## Known Lampa Native API Quirks

- `Lampa.Modal.close()` throws when no modal is currently open. Call it only through a guarded wrapper (see `closeModalSafely` in `src/engine/engine-utils.ts`), except at a call site where a modal opened by that same code path is guaranteed to exist.
- `Lampa.Loading.start()` does not support being called a second time without an intervening `stop()` — doing so corrupts its internal state. Always stop an active loading screen before another one (e.g. the preload progress screen) starts.
- A player item handed to `Lampa.Player.play()` must never be self-referential (e.g. its own `.playlist` array containing that same item). Lampa persists watch history via `JSON.stringify`, which cannot serialize circular structures.
- `Lampa.Controller.enabled()?.name` is not a reliable signal for "has focus returned to my component" — in some environments it never reports a component's own controller name again after another overlay (e.g. Settings) has been focused, even once that overlay is closed. Do not gate recurring background work (e.g. polling) on this or on DOM-geometry heuristics for "is something else open" — components that need to protect against stealing focus during a genuine overlay should check controller state locally at the point of the focus-affecting call itself (see `TorstTorrentsComponent.renderTorrents`/`renderEmptyState`), not use it to skip the work entirely.
- Android's native HTTP bridge can send only GET and POST. Use the browser transport for PATCH, PUT, and DELETE; Torst does not support the old method-override header.
- `Lampa.Reguest` hides response headers. Preserve native transport for listings and revalidate only when an ETag is available. Configuration reads that require an ETag must use a transport that exposes headers. Do not synthesize Torst listing or configuration ETags from response fields.

## Naming & Code Style Conventions

- Use American English spelling and usage consistently in documentation, prose, and code comments (e.g., "behavior", "color", "normalize", and "serialize"). Preserve proper names, quoted text, external API identifiers, and intentionally non-English sample data.
- `npm run lint` includes CSpell's American English checks for documentation, source comments, and English UI translations; `npm run lint:spelling` runs them alone. Code identifiers, fixture data, and code examples are outside its scope. Keep the vocabulary in `cspell.config.mjs` limited to project names and technical terms, and fix ordinary spelling errors instead of adding exceptions.
- Follow standard TypeScript naming conventions consistently:
  - Use `PascalCase` for classes, interfaces, type aliases, and enums.
  - Use `camelCase` for functions, methods, variables, parameters, and internal object properties.
  - Use `UPPER_SNAKE_CASE` only for immutable module-level constants.
  - Use `kebab-case` for source and test filenames.
- Choose clear, descriptive names based on domain behavior. Avoid ambiguous abbreviations, single-letter identifiers outside small conventional scopes, Hungarian notation, and names that repeat obvious type information.
- Name booleans with predicates such as `is`, `has`, `can`, `should`, or `needs`. Name event handlers with `handle...` or `on...`, and name constructors or factories with verbs such as `create...` or `build...`.
- Treat acronyms as words in identifiers (`TorstApi`, `instanceUrl`, `httpClient`) while preserving their conventional uppercase spelling in user-facing prose (`API`, `URL`, `HTTP`).
- Include units when a numeric value would otherwise be ambiguous, such as `timeoutMs`, `sizeBytes`, or `speedMbps`.
- Order CSS declarations in stylesheets, embedded `<style>` blocks, and inline styles using RECESS (`stylelint-config-recess-order`). Place shorthands before their longhands; custom properties keep the order that reads best. The CSS ordering tests enforce the shared Stylelint configuration.
- Preserve field names defined by external APIs and wire formats, including required `snake_case` JSON properties. Use idiomatic TypeScript names for internal application state and map explicitly at the boundary when necessary.
- Do not copy vague, misspelled, or legacy names from Lampa internals into plugin-owned identifiers. Keep required Lampa names only at integration boundaries and wrap them with clearly named functions, types, or adapters where practical.
- Reuse established Torst and Lampa terminology instead of introducing synonyms for the same concept. Keep names consistent across implementation, tests, settings labels, notifications, and documentation.
- Keep terminology consistent across the plugin UI, landing page, and README in both English and Russian, using `src/lang/translations.ts` as the reference for user-facing terms. When editing terms, review all related headings, descriptions, setup instructions, accessibility labels, and dynamic or fallback messages. Use natural grammatical forms in prose and preserve product names, protocols, code, and URLs. Verify terminology through editorial review rather than tests that hardcode prose or ban words. Test UI behavior against translation keys or dictionary-derived values; fixed strings supplied by mocks remain appropriate for testing fallback, interpolation, and external data handling.
- Apply these conventions to all new code and improve nonconforming names in touched code when doing so is safe and does not create unrelated churn.

## Code Comments

- Default to no comments. Only add one when the *why* is genuinely non-obvious: a hidden constraint, a subtle invariant, or behavior that would otherwise surprise a reader.
- Do not narrate bug history in comments — no references to a specific error message, a prior regression, "this used to crash", or how an issue was found and fixed. That narrative belongs in the commit message, not the source; comments rot as the codebase evolves while commit history stays accurate.
- Rely on regression tests, not comments, to prevent a fixed bug from resurfacing. A test that reproduces the original failure is durable; a comment warning "don't do X, it broke before" is not enforced and will be forgotten or contradicted by the next edit.
- Make a comment's explanation self-contained rather than pointing to AGENTS.md or another external doc for the reason. Docs and code can be edited independently and drift out of sync, silently turning "(see AGENTS.md)" into a dead pointer; a reference to another function or type in the same file is fine, since it moves and changes together with the comment.
- This applies beyond source comments: other project documentation (README.md, etc.) should also explain things in its own words rather than citing "AGENTS.md" or a specific rule number by name, for the same reason — the two files are edited independently and a rule can be renumbered, reworded, or removed without the citing text being updated to match.

## Testing & Quality Standards


- **Mandatory Test Coverage**:
  - Every new feature, bugfix, refactor, or logic change **must be covered with tests** under the `tests/` directory.
  - Maintain comprehensive coverage for:
    - **Authentication**: Password sign-in, header resolution, and token refresh in `tests/auth.test.ts`.
    - **HTTP Transport**: `Lampa.Reguest` delegation, `fetch` fallback, status error mapping, `304 Not Modified` mapping for conditional requests, and network error handling and classification in `tests/http-client.test.ts`.
    - **API Interactions**: Health checks, torrent additions, metadata fetching, preload control, database listing (`getTorrents`) and its revalidation, torrent deletion (`deleteTorrent`), and stream URL generation in `tests/torst-api.test.ts`.
    - **Instance Management**: Instance CRUD, concurrent latency benchmarking, latency-based auto selection, reuse of recent benchmark results, and automatic failover in `tests/instance-manager.test.ts`.
    - **Search Providers**: Provider CRUD, legacy Lampa key sync, and health checks in `tests/provider-manager.test.ts`; aggregated multi-provider search, dedupe, and ranking in `tests/provider-search.test.ts`; provider pool settings UI in `tests/provider-ui.test.ts`.
    - **Native Parser Integration**: Lampa torrent parser interception, result injection, and the provider global search source in `tests/parser-hook.test.ts`; its torrent rows and media tags in `tests/provider-result-row.test.ts`.
    - **Engine & Playback**: Playback mode resolution, prompt dialogs, database persistence, and player routing in `tests/torst-engine.test.ts`; engine helpers in `tests/engine-utils.test.ts`; torrent file parsing in `tests/file-parser.test.ts`; episode switch playlist restoration in `tests/player-playlist.test.ts`; episode previews in `tests/episode-preview.test.ts`; global search over saved torrents in `tests/database-search.test.ts`; batched saved-torrent lookups and their per-instance cache in `tests/saved-torrents.test.ts`.
    - **Preload & Loading UI**: Progress percentage calculation, buffer threshold hand-off, peer and speed stats, start and status-read retries and rejections, and cancellation lifecycle in `tests/preload.test.ts`.
    - **Playback Dialog**: Pre-playback options dialog, TV remote button activation, and controller restoration on Back in `tests/play-dialog.test.ts`.
    - **UI & Settings**: Settings parameter registration, TV-friendly instance pool management, password masking, add/delete confirmation dialogs, URL validation, sidebar integration, Torst torrents component lifecycle, and card rendering in `tests/ui.test.ts`; file list rows in `tests/file-list-item.test.ts`; card watched overlay in `tests/card-watched.test.ts`; the shared saved torrent card in `tests/saved-torrent-card.test.ts`; the shared saved torrent file list through the library view tests in `tests/ui.test.ts` and the global search tests in `tests/database-search.test.ts`.
    - **CSS Ordering**: RECESS declaration order across the landing page, embedded `<style>` blocks, and inline styles in `tests/css-order.test.ts`.
    - **Localization**: Translation key completeness, matching placeholders across locales, alphabetical ordering, and fallback behavior in `tests/lang.test.ts`.
    - **Spelling**: American English checks, project vocabulary, English UI translations, and exclusions for non-English text, quotations, code and fixture data in `tests/spelling.test.ts`; syntax-aware prose extraction and preserved diagnostic positions in `tests/spelling-parser.test.ts`.
    - **Utilities**: Storage credential obfuscation in `tests/storage-obfuscation.test.ts`, search query decoding in `tests/search-query.test.ts`, on/off setting storage in `tests/trigger-setting.test.ts`, and identifier generation in `tests/uuid.test.ts`.
    - **Versioning & Build**: `PLUGIN_VERSION` and `package.json` version consistency in `tests/version.test.ts`; build metadata and repository resolution, landing page builds, published pages, and landing page generation and the alphabetical order of its translation keys in `tests/build-metadata.test.ts`, `tests/build.test.ts`, `tests/build-pages.test.ts`, and `tests/landing-page.test.ts`; landing page navbar layout across locales, release channels, and screen widths, checked with headless Chrome, in `tests/landing-layout.test.ts`, which is skipped when no Chrome executable is available.
- **Test Fixture Names**: Do not use real commercial movie or series titles, trademarks, or brand names in test fixtures, sample data, or examples. Use the Blender open movies (Sintel, Big Buck Bunny, Elephants Dream, Tears of Steel, Cosmos Laundromat, Spring, Caminandes) or invented names such as `Llamaland.Demo` or `Show.S01E02`; for non-Latin scripts, use ordinary words rather than real titles.
- **Test Runner**:
  - Tests are written with Node's native test runner (`node:test` and `node:assert/strict`) executed through `tsx`:
    ```bash
    npm test
    ```
  - All tests must pass cleanly before any code is committed.


## Commit Messages & History Hygiene

- **Conventional Commits**: Use `type(scope): concise imperative summary`.
  - Common types: `chore`, `ci`, `docs`, `feat`, `fix`, `refactor`, `style`, `test`.
  - Common scopes: `agents`, `api`, `auth`, `build`, `engine`, `instances`, `lang`, `pages`, `plugin`, `providers`, `search`, `skill`, `test`, `types`, `ui`, `utils`. The list is not exhaustive; pick the scope that best names the area a commit changes.
- **Subject Formatting**: Keep the subject concise, lowercase after the colon, and without a trailing period.
- **Body Requirements**: For non-trivial commits, add a blank line followed by `-` bullets. Write each bullet as a complete sentence ending with a period. Describe observable behavior and key technical decisions rather than listing files edited.
- **Atomic Commits**: Each commit should be self-contained, leaving the build, tests, type checks, and linters green.

Example:

```text
feat(instances): add parallel latency benchmark for auto-selection

- Ping all configured Torst instances concurrently using /readyz.
- Record millisecond round-trip response times and sort instances by latency.
- Automatically route playback and metadata requests to the lowest-latency node.
- Add toast notification when failover engages due to node downtime.
```

## Quality Verification & Commands

Before committing any changes, all checks must pass cleanly without warnings or errors:

- **Unit Testing**:
  ```bash
  npm test
  ```
- **Type Checking**:
  ```bash
  npm run typecheck
  ```
- **Linting**:
  ```bash
  npm run lint
  ```
  Auto-fix formatting and lint issues where possible:
  ```bash
  npm run lint:fix
  ```
- **Build Verification**:
  ```bash
  npm run build
  ```
  Ensure `dist/torst.js`, `dist/torst.min.js`, and `dist/index.html` build without errors.
