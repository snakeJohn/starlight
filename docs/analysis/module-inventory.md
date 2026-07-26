# Module Inventory

Ratings use the project workflow's definitions: Single Purpose, Unidirectional Flow, Ports over Implementation, Environment-Agnostic, and Replaceable Parts.

| Module | Responsibility | Approx. size | Complexity | S.U.P.E.R score |
|:--|:--|--:|:--|:--|
| `src/music` | Provider adapters, lyrics, source runtimes | 266 KB | High | S yellow, U yellow, P yellow, E yellow, R yellow |
| `src/handlers` | HTTP route adapters and validation | 125 KB | Medium | S green, U green, P yellow, E green, R green |
| `src/lx_sync` | LX protocol, crypto, mapping, synchronization | 112 KB | High | S yellow, U green, P green, E yellow, R yellow |
| `src/voicecmd` | Voice parsing, AI analysis, online search | 82 KB | Critical | S red, U yellow, P yellow, E yellow, R red |
| `src/mina` | Xiaomi authentication and device clients | 79 KB | High | S yellow, U green, P yellow, E red, R yellow |
| `src/utils` / `src/system` | Shared transport, parsing, crypto, fields | 52 KB | Medium | S green, U green, P yellow, E green, R green |
| `src/player` | Queue, playback state, URL construction | 42 KB | High | S red, U yellow, P yellow, E yellow, R red |
| `src/custom_playlists` | Playlist persistence and business rules | 36 KB | High | S yellow, U green, P yellow, E green, R yellow |
| `src/auth` | Login and session lifecycle | 36 KB | High | S yellow, U green, P yellow, E red, R yellow |
| `src/bridge` | Songloft library and playback bridge | 33 KB | High | S yellow, U yellow, P yellow, E yellow, R yellow |
| `src/indexing` | Search/index lifecycle | 22 KB | Medium | S red, U green, P yellow, E green, R yellow |
| `src/schedule` | Schedule persistence and execution | 22 KB | Medium | S green, U green, P yellow, E green, R green |
| Other backend domains | Config, download, conversation, QR, services | 104 KB | Medium | S green, U green, P yellow, E yellow, R yellow |
| UI music modules | Music browsing and library workflows | 103 KB | High | S yellow, U green, P yellow, E green, R yellow |
| UI speaker modules | Device and playback workflows | 102 KB | High | S red, U yellow, P yellow, E green, R red |
| UI automation modules | AI, command, indexing, schedule UI | 28 KB | Medium | S green, U green, P yellow, E green, R green |
| UI shared/root modules | State, API, orchestration, shared helpers | 52 KB | Medium | S yellow, U yellow, P yellow, E green, R yellow |
| `static/css/style.css` | Whole-application styling | 73 KB | High | S red, U green, P red, E green, R red |
| `static/index.html` | Whole-application DOM | 70 KB | High | S red, U green, P red, E green, R red |
| `scripts` | Release utilities and historical UI migrations | 41 KB | Low | S yellow, U green, P yellow, E yellow, R yellow |

## Module Details

### Backend core and adapters

- Public contracts are mostly TypeScript records and Songloft handler payloads. They are serializable, but schemas are generally implicit rather than independently defined.
- Dependency flow is broadly `main -> handlers -> services -> external clients`, with few obvious cycles.
- Replacement cost rises sharply in `voicecmd/engine.ts`, `player/manager.ts`, `music/platforms/lyrics.ts`, and Xiaomi authentication because each file combines state, transport, normalization, and policy.
- Environment coupling is intentional around the Songloft QuickJS host. The user chose to remove the recently added pure-JavaScript GBK table and accept loss of fallback decoding when the host lacks native GBK support.
- `pako` is used by LX sync, lyric decoding, and MiIO. It is not dead dependency weight.

### Browser application

- The browser bundle is only about 39 KB compressed, so large UI rewrites offer limited package-size return.
- The builder emits both `app.bundle.js` and hashed copies of source modules. The generated HTML references the bundle and CSS, but the builder's asset model may still expect module files; removal needs host/browser smoke tests before it can be classified as safe.
- Repeated helpers exist (`asArray`, `selectedPayload`, scalar normalization), but consolidating them mainly improves maintainability rather than package size.

### Build and scripts

- `scripts/clean-dist.mjs` has a single valid purpose and should become part of every build.
- `scripts/restructure_ui.mjs` and `scripts/fix_ui_html.mjs` are one-shot migration scripts with no package, CI, README, or source references. Removing them reduces repository clutter, not the release ZIP.
- `scripts/upload_plugin.py` may support a manual release workflow and is not safe to delete without confirmation.

## Highest-Value Candidates

1. Make builds clean and repeatable; add a duplicate-hash regression test.
2. Record the package impact of the approved GBK fallback removal, then measure remaining backend weight.
3. Remove confirmed one-shot scripts.
4. Consolidate only helpers whose semantics and tests prove equivalence.
5. Split monoliths for maintainability only, not under a false package-size claim.
