# Risk Assessment

## S.U.P.E.R Architecture Health Summary

| Principle | Status | Key findings | Priority |
|:--|:--|:--|:--|
| Single Purpose | Yellow | Several 700-1500 line services and whole-app HTML/CSS files combine responsibilities | Medium |
| Unidirectional Flow | Yellow | Backend layering is mostly clear; UI playback state has cross-module coordination | Medium |
| Ports over Implementation | Yellow | Payloads are serializable but most boundaries lack standalone schemas | Low |
| Environment-Agnostic | Yellow | QuickJS and Xiaomi/provider behavior require host-specific adapters and fallbacks | Medium |
| Replaceable Parts | Red | Player, voice engine, lyric decoding, and auth changes can ripple across handlers and tests | High |

**Overall health:** 0/5 fully healthy; refactoring is warranted, but targeted changes are safer than line-count-driven rewriting.

### Violation Hotspots

1. `src/voicecmd/engine.ts`: parsing, policy, execution, formatting, and state in one module.
2. `src/player/manager.ts`: queue state, persistence, device control, and status projection.
3. `static/js/speaker_modules/player.js`: transport, playback target state, rendering, and controls.
4. `src/music/platforms/lyrics.ts`: several provider formats and crypto/decompression paths.
5. `static/index.html` and `static/css/style.css`: all UI surfaces share monolithic files.

## Risk Matrix

| Risk | Impact | Likelihood | Severity | Mitigation |
|:--|:--|:--|:--|:--|
| Dirty `dist` accumulates old hashes | Larger/non-reproducible local packages | High | High | Clean before every build; test two consecutive builds |
| Removing GBK table | Broken Kuwo/legacy lyrics on QuickJS | High | Accepted | User explicitly chose size reduction over the added fallback |
| Removing or replacing `pako` | LX, lyric, or MiIO protocol failures | High | High | Use bundle measurement and protocol tests first |
| Removing copied UI modules | Runtime asset lookup failure | Medium | High | Inspect builder contract and run browser/host smoke tests |
| Splitting stateful player code | Playback races/regressions | Medium | High | Preserve characterization tests and change incrementally |
| Helper consolidation changes coercion | Subtle API/data differences | Medium | Medium | Merge only identical semantics with focused tests |
| Deleting manual release tools | Lost undocumented workflow | Low | Medium | Keep `upload_plugin.py` pending owner confirmation |

## Technical Debt

- The build script ignores the repository's own clean step.
- One-shot HTML migration scripts remain in the active scripts directory.
- Scalar conversion and array helpers are duplicated with slightly different semantics.
- Large stateful modules reduce replacement safety, but splitting them does not materially shrink a minified bundle.
- Root and static icons are byte-identical but serve different manifest/browser paths; deduplication depends on builder path behavior.

## Testing Risks

- No automated assertion for ZIP entry uniqueness, stable consecutive builds, or maximum package size.
- No browser screenshot or host-level smoke test.
- No coverage threshold, lint gate, or dead-code analysis.
- Current unit baseline is strong: 622 tests and type checking pass.

## Project Governance Risks

- No canonical project instruction or durable memory surface exists.
- CI fresh checkouts hide dirty local build behavior.
- The validation workflow does not enforce dependency audit or artifact contents.

## Compatibility Concerns

- The project targets Songloft QuickJS, so Node/browser APIs cannot be assumed.
- Music providers have legacy encoding and protocol quirks encoded in apparently large data/crypto modules.
- New browser playback behavior is intentional functionality and must not be classified as redundant solely because it increased LOC.

## Recommended Boundary

The first slimming batch should include the user-approved GBK fallback removal, deterministic builds, artifact regression tests, removal of confirmed one-shot scripts, and only measured/behavior-preserving helper cleanup. Protocol crypto replacement, UI lazy loading, and aggressive CSS/DOM pruning remain out of scope unless separately approved with host-level tests.
