# Hforge Mobile Browser QA Visual Rubric (v1.17)

Use this rubric for bounded, human-observable Hforge QA through Orca only. Snapshot is useful accessible-structure evidence, but it is optional. A snapshot failure must never prevent target-tab creation when control, eval, and at least one usable Orca-native visual route remain healthy.

## Scope

- Explicit scope wins. For explicit Home work, include launch smoke, Home, and requested Home behavior only; list excluded routes, states, and suites.
- Without explicit scope, use only clear diff targets plus basic smoke. Return `needs_user_scope` when the target is ambiguous.
- Never expand a quick Home request into the full product.

## Controller and bounded capability preflight

Set `controller_started_at` and one global deadline before starting a child process. Resolve one Orca executable, run `status --json`, fetch `skills get orca-cli`, and fetch the version-matched browser reference. After resolving Orca version/platform/architecture, run this literal capability-cache read shape with the default 24-hour TTL: `node .agents/skills/hforge-orca-browser-qa/scripts/capability-cache.mjs read --orca-version <version> --platform <platform> --arch <arch> --ttl-ms 86400000`. Also consult the separate version/platform/architecture-keyed viewport behavior cache with `node .agents/skills/hforge-orca-browser-qa/scripts/viewport-reset-cache.mjs read --orca-version <version> --platform <platform> --arch <arch> --ttl-ms 86400000`. For a fresh optional failure, use this literal capability-cache write shape: `node .agents/skills/hforge-orca-browser-qa/scripts/capability-cache.mjs write --orca-version <version> --platform <platform> --arch <arch> --ttl-ms 86400000 --capability <snapshot|browser_screenshot> --outcome <timeout|error> --failure-domain capability`. Inspect `capabilities.<name>.status`: only `negative` suppresses that probe; `unknown` proceeds. Inspect the viewport cache's top-level `status`: only `observed` selects its verified optimization; `unknown` uses probe-first behavior. Both caches fail open on storage errors. If a required option is absent, run only that command's bounded `--help`; do not infer flags from an older guide.

Classify capabilities independently under killable watchdogs. A failure short-circuits only that capability:

1. **Control plane (required):** runtime status, target-tab create/show/switch, page-specific eval, and page-specific viewport.
2. **Snapshot (optional/preferred):** when the cache says `status=negative`, do not probe and record `not_run_cached_known_unavailable`; otherwise probe once on a disposable page. On timeout/error, terminate that child tree, set `snapshot=unavailable`, record `not_run_known_unavailable`, and run `scripts/capability-cache.mjs write --capability snapshot --outcome <timeout|error> --failure-domain capability`.
3. **Browser screenshot (preferred visual):** apply the same cache/probe rule independently with `browser_screenshot`. A cached negative records `not_run_cached_known_unavailable`; a timeout/error terminates only its child tree, sets `browser_screenshot=unavailable`, records `not_run_known_unavailable`, and writes only that negative result. A successful probe is never cached.
4. **Orca app/window screenshot (required fallback when browser screenshot is unavailable):** use the version-documented `computer capabilities`, `list-apps`, `list-windows`, and `get-app-state` surface. Require `observation.screenshot=true`, an identified Orca process/window, a usable screenshot receipt/path, and the binding proof below.

Keep each browser capture watchdog at 5–15s and reserve cleanup time. After disposable page/profile and control setup, run the two uncached capability probes strictly serially on win32, each with its own watchdog and receipt; await both settled results before closing the disposable page/profile in `finally`. One failure must not cancel or classify the other. An optional snapshot failure is recorded, not promoted to `blocked_evidence_transport`. Continue only if the control plane and at least one visual route are healthy.

### Serial page commands on win32 (measured run qa-boot-20260917-1901-a1)

Never issue `snapshot`, `browser_screenshot`/`computer get-app-state`, or page `eval` concurrently on win32 — always in series. Cause: two concurrent probes hang `clientHost.automation` (~90s lost, `runtime_unavailable`); the surface self-recovers once commands go serial. What to serialize: every command addressed to a `browserPageId` (snapshot, screenshot, eval, viewport, `tab show`/`tab switch` on a lane page), including the two capability probes and all M/L lane stages. Watchdogs and receipts stay separate per command (one watchdog/receipt per probe; `commandElapsedMs` per command); serial execution does not mean shared timeouts. Non-page commands (supervisor readiness/status reads, `tab list` inventory) may still batch with page work. Grouped M/L issuance in ascending page-ID order is allowed, but the page commands themselves execute one at a time with no overlap.

### Single-M latency lane (exception to dual M/L default)

Dual M/L stays the default for responsive audits. A single M lane is valid only when the run goal is debugging time/latency rather than responsive parity: record the justification (goal, why parity is out of scope, which lane was dropped) in the run receipt. Saves roughly half the lane time (~15–20s) plus eval pressure. Classification: a justified single-M run with complete M evidence is `PASS`/`FAIL` eligible for its stated latency scope; it must never claim responsive parity. Without recorded justification, a missing lane is incomplete evidence (`partial_audit`).

### Combined multipurpose evals (norm)

E1/E2 combined multipurpose evals are the norm, not the exception: each lane stage returns lifecycle identity, full viewport fields, fixture proof, and Home state in one eval (typical usage 3 of the 6-eval budget). Per-field probes (~10–15 round-trips at ~2.3s each) are prohibited when a combined probe suffices. The 6-eval budget counts only page evals; `tab show`/`viewport` commands are excluded.

Record a known snapshot or browser-screenshot timeout once in the run capability matrix. Every lane records `not_run_cached_known_unavailable` when the fresh capability cache skipped the probe, or `not_run_known_unavailable` when this run's probe failed; never repeat a known-hanging command in either lane. Invalid or corrupt cache state is `unknown` and never suppresses a probe. A `cache_write_unavailable` result is also `unknown`, so the probe result still governs this run and the next run probes again. Do not cache control-plane failures, successful capabilities, or tab inventory. For an unknown viewport-cache result, write `reload_resets_viewport` only after a post-reload probe actually observes the reset, using the literal shape `node .agents/skills/hforge-orca-browser-qa/scripts/viewport-reset-cache.mjs write --orca-version <version> --platform <platform> --arch <arch> --ttl-ms 86400000 --behavior reload_resets_viewport --evidence <opaque-id>`. The evidence identifier must be opaque and bounded; never put fixture/source contents, credentials, or absolute project paths in it.

### Capability/evidence matrix

| Browser screenshot | Bound Orca window screenshot | DOM + viewport + basic a11y per lane | Snapshot | Classification |
| --- | --- | --- | --- | --- |
| usable | any | complete | usable or unavailable | Full evidence; `PASS`/`FAIL` eligible |
| unavailable | usable | complete | usable or unavailable | Full fallback evidence; `PASS`/`FAIL` eligible |
| usable or fallback usable | complete only for some required lanes/checks | incomplete | any | `partial_audit`; never `PASS` |
| unavailable | unavailable or unbound | any | any | `blocked_evidence_transport` |
| any | any | missing/untrusted for all lanes | any | `blocked_evidence_transport` |

`PASS` therefore never requires snapshot. It always requires, for both M/L lanes, usable visual evidence plus DOM/viewport/basic-accessibility evidence and completed selected functional/parity checks. A complete evidence set that proves a defect is `FAIL`, not blocked.

## Human-observable tabs and immutable identity

After `terminal create`, immediately emit exactly one read-only, uncached `tab list --json` together with the supervisor readiness/status read as one grouped batch. Await both results before target-tab adoption or creation; never wait for readiness before launching the inventory, and never cache tab inventory. Then reuse two usable prior-run `HFORGE QA` tabs for the same worktree/purpose when present (adopt as M/L, reapply M = 390x844 and L = 430x932 viewports/profiles, relabel with the current `runId`, re-verify, reseed); create with `tab create` only the missing lanes. Never reuse default/unrelated tabs and never leave more than two QA tabs per run — explicitly adopt or close orphans with receipts. Use isolated profiles when available and label each page by setting and verifying its document title:

```text
HFORGE QA M · run=<runId>
HFORGE QA L · run=<runId>
```

Persist each returned `browserPageId`; run `tab show --page <id>` and `tab profile show --page <id>`, then identity eval on that exact page. Prove worktree, URL, exact title/run ID, profile, client hosting, and visibility from Orca receipts. Do not rediscover by URL or active-tab order. Emit this manifest before lanes:

```text
M browserPageId=<id> label="HFORGE QA M · run=<runId>" worktree=<id/path> host=client visibility=visible profile=<id>
L browserPageId=<id> label="HFORGE QA L · run=<runId>" worktree=<id/path> host=client visibility=visible profile=<id>
```

If a tab is only partially created before `tabs-ready`, close that partial tab. Once `tabs-ready` is emitted, retain all ready target tabs and required profiles for human observation, including on `FAIL`, `partial_audit`, or blocked lane outcomes.

## Orca window-screenshot binding

Use this only when browser screenshot is unavailable or as corroboration. It is valid visual evidence only when every step is bounded and recorded:

1. Resolve Orca's exact app PID with `computer list-apps` and exact window ID with `computer list-windows`.
2. Ensure the exact worktree is visibly selected in Orca before capture. `tab switch --focus` may change browser-page affinity without changing a desktop window that is displaying another worktree. Use Orca's own computer state/action surface when necessary, then verify that the selected worktree exposes this run's supervisor and both exact M/L tab labels.
3. Switch to the lane tab using `tab switch --page <lanePageId> --focus`, then immediately run `tab show --page <lanePageId>`.
4. Eval the immutable page ID, URL, exact document title, viewport, and a run/lane marker on that page. The exact lane title must be visible in Orca's selected-tab UI or accessibility state. Do not alter application content merely to fake binding.
5. Immediately call `computer get-app-state` against that exact app/window with screenshot enabled and restoration/focus when documented. Accept only a usable image path/receipt whose same response identifies the window and selected lane label. `get-app-state` captures the OS foreground window: never use it as fallback visual evidence when the user is working in another app (the capture may show their window, not Orca).
6. Record an atomic association: `lane → browserPageId → title/runId → Orca PID/windowId → screenshot artifact → timestamp`. If another tab becomes active or the selected title is absent, repeat the bounded binding sequence once; otherwise classify the artifact as unbound.

A generic desktop image, an image of another lane, or an image without selected-tab identity is not evidence.

In PowerShell always quote element refs (e.g. `--element "@e6"`): unquoted `@e6` is misparsed by pwsh. This applies to every `tab`/`eval` command taking `--element`.

## Viewport and lifecycle integrity

Every command targets the stored page ID. Apply the lane viewport once during tab setup and immediately prove it with the full probe below. Independent M/L setup, eval, reload, and probe commands are emitted as one grouped batch in ascending stored page-ID order, with no serial reasoning or orchestration idle between them (page commands still execute serially on win32); preserve only the necessary within-lane dependencies. After navigation, run the combined lifecycle/viewport probe. After the consuming reload, if the viewport cache is `observed`, immediately apply the lane viewport once and then run the combined post-reload lifecycle/viewport proof; if it is `unknown`, run that proof first. If the proof still mismatches, allow only the existing one bounded viewport reapply/reprobe. On the unknown path, write the behavior cache only after the proof actually observes a reset and use only a bounded opaque evidence ID. The final viewport/Home probe remains mandatory in all paths; CLI `ok` is not evidence and a cache entry never substitutes for verification.

| Lane | Expected width | Expected height |
| --- | ---: | ---: |
| M | 390 | 844 |
| L | 430 | 932 |

Required probe: `innerWidth`, `innerHeight`, `visualViewport.width/height`, `outerWidth`, `outerHeight`, `devicePixelRatio`, `documentElement.clientWidth/clientHeight/scrollWidth/scrollHeight`, body dimensions, URL, title/run ID, visibility state, and focused element. Record finite DPR rather than assuming `1`; `assets/viewport-matrix.json` defines dimensions only.

Allow one guide-documented same-page viewport reapply. On a second mismatch return `blocked_viewport_unapplied` with requested/observed values, page ID, stage, command, elapsed time, and deadline. Do not replace the page or relabel desktop dimensions as mobile.

## Fixture and Home sequence

Host-side, read `assets/gym-state-v1-six-month-2026-09-07.json` as raw bytes once. Record the observed raw checkout byte count and SHA-256 used by QA, plus the already-known metadata once: fixture ID `hforge-six-month-2026-09-07-v1`, schema `1`, `26` weeks, `26` workouts, `3` routines, `52` bodyweight rows, date range `2026-03-16` through `2026-09-07`, bodyweight end `2026-09-10`, and `active:null`. Decode the bytes once as UTF-8 to one immutable `fixtureString`. The known metadata and whole-string equality prove the payload; do not invoke `assets/generate-six-month-fixture.mjs` or parse, serialize, normalize, or repeatedly hash the JSON during a QA run. The maintenance/CI command `node .agents/skills/hforge-orca-browser-qa/scripts/verify-six-month-fixture.mjs` is separate and not a per-lane QA step.

Run exactly two isolated lane transactions (one for a justified single-M latency run) with immutable page IDs; on win32 their page commands execute serially (grouped issuance in ascending page-ID order, no orchestration idle between groups). Keep `tabs-ready` as the completed-tab/setup gate and emit distinct `Home-ready` only after the final readiness/parity gate. For each lane:

1. Use its manifested page ID, profile, and lane viewport. The viewport was applied once during tab setup and already proved; do not reapply it here.
2. Navigate Home and run one initial combined lifecycle identity/full-viewport eval.
3. Run one seed-and-pre-reload eval that writes `fixtureString` to the raw `gym_state_v1` localStorage key, reads it back, and returns exact string equality, string length, and UTF-8 byte length. Do not parse, serialize, normalize, or inspect one field at a time; equality against the immutable host string plus byte length equal to the recorded raw byte count is the exact-byte proof.
4. Perform exactly one consuming reload. If the exact-runtime viewport behavior cache is `status=observed`, immediately apply the lane viewport once; then run one combined post-reload eval returning lifecycle identity, every full viewport field above, exact stored-string/length/UTF-8 byte proof, `location.hash`/stable Home state, and the known fixture metadata receipt. If the cache is `unknown`, run that combined proof before any viewport reapply. Do not use regex when direct property/text/selector checks suffice.
5. If the combined proof still shows a viewport mismatch, reapply the requested viewport once and immediately run the full viewport recovery probe. On the unknown-cache path, write `reload_resets_viewport` only after the proof observed the reset, with a bounded opaque evidence ID. A matching post-reload proof is final, but never skips the mandatory final readiness probe.
6. Use one final combined viewport/Home readiness probe after the bounded readiness wait, returning the full viewport, stable Home readiness selector/text, visibility, route, and required DOM/basic-a11y measurements. Do not poll individual assertions with eval loops.
7. Capture visual evidence through the classified route. Record snapshot as available, `not_run_cached_known_unavailable`, or `not_run_known_unavailable` according to the preflight result.

The fixture/Home setup target is no more than 6 page eval commands per lane (excluding required `tab show`/`viewport` commands): setup identity/viewport, post-navigation identity/viewport, seed/pre-reload proof, post-reload combined proof, one conditional viewport-recovery probe, and final combined readiness. Emit each independent M/L stage as one group in ascending stored page-ID order (page commands run serially on win32) and do not insert serial reasoning or orchestration idle between its commands. The recovery probe is the only optional command. Compare the single returned M/L receipts host-side for exact fixture ID, metadata, raw byte/string equality, Home state, and parity; never transfer the fixture again. One lane timeout cancels pending expensive work but does not close ready retained tabs.

### Optional parallel tab pre-create (risky, never default)

Pre-creating QA tabs in parallel with Vite boot can overlap ~5s, but it is explicitly optional and risky: a tab that navigates before the supervisor reports ready must be retried after readiness (re-navigate, re-verify URL/ownership, re-run the setup proof). Never treat a pre-ready navigation as evidence. Default remains strictly ordered: readiness first, then tabs.

## Evidence threshold per lane

Minimum full evidence:

- One usable Orca browser screenshot or correctly bound Orca app/window screenshot.
- Exact final viewport probe and document/body overflow measurements.
- Bounding rectangles and computed style for header, week card/strip, today's row, weight card/chart, visible Home calculator cards, streak card, and persistent navigation.
- Text/accessible names, roles where exposed, disabled state, focusability, and approximate contrast colors for visible controls/content.
- All visible interactive targets measured; report targets below roughly 44x44 CSS pixels and spacing risks.
- Basic navigation/control checks selected for Home, current route, console/network errors affecting Home, and M/L fixture/data parity.

If visual evidence exists only for some lanes, or required DOM/interaction/parity evidence is incomplete, return `partial_audit` with exact completed and missing checks. If no required lane has a usable visual route, return `blocked_evidence_transport`. Never infer a visual PASS from DOM alone.

## Audit checklist

1. **Overflow and clipping:** unexpected horizontal overflow, off-screen required elements, clipping, zero-sized content, unsafe fixed/sticky overlays, and unexplained vertical overflow.
2. **Overlap and hierarchy:** collisions, alignment, spacing, card boundaries, chart labels, prominent primary action, and intentional reflow.
3. **Legibility and apparent contrast:** complete readable text, intentional wrapping, practical size/line height, and apparent foreground/background distinction. Label visual contrast as apparent unless measured colors prove a ratio.
4. **Touch and basic accessibility:** meaningful names, roles/focusability where observable, visible focus when exercised, roughly 44x44 targets, adequate spacing, and no color-only meaning.
5. **Navigation and controls:** Home route, persistent navigation, previous/next week, settings/export entry points, and applicable Home actions without destructive state changes.
6. **Data parity:** same fixture identity, totals, body weight, workout/streak meaning, card presence, and text across M/L; record intentional responsive differences.

## Timeouts, cleanup, and state records

Defaults: Orca command 15s, target/stack readiness 60s, lane 90s, global run 180s, cleanup 15s. Pass remaining global time to nested work. Record `commandElapsedMs` from each Orca command's actual invocation through settlement, and record `orchestrationIdleMs` separately for agent/orchestrator gaps between independent commands or batches. Idle is diagnostic only and must never be reported as product latency. No unbounded sleep, polling, retry, live watcher, or unresolved promise.

Emit one record for every reached state: `preflight`, `tabs-ready`, `lanes-started`, per-lane `Home-ready`, `evidence`, and `cleanup/retained`, each with timestamp/deadline. In `finally`, stop controller-owned process trees, remove temporary fixture data, close disposable/partial pages, and retain ready target tabs/profiles. Uncertain process/temp cleanup prohibits `PASS`. Report an exact ID-scoped cleanup command but do not execute it automatically.

Target startup follows `port-and-process-contract.md`. The run manifest is part of the evidence receipt and must include the canonical worktree root/ID, `runId`, lease path, bounded candidate attempts, selected service ports, exact target URL, launch command/cwd, supervisor handle/PID, listener PID, ownership result, readiness result, and retention/cleanup state. Never infer ownership from HTTP readiness and never terminate by port.

## Finding format and severity

```text
[blocker|major|minor] viewport: M|L; step: <name>; selector/element: <stable target>
Expected: <observable expectation>
Observed: <actual behavior or measurement>
Evidence: visual=<path/receipt>; snapshot=<path/receipt|optional-unavailable>; dom=<measurement/text/style>
```

- **blocker:** prevents the journey, corrupts data, makes required content inaccessible, causes dangerous overlap/overflow, breaks navigation, or creates a critical accessibility failure.
- **major:** materially impairs a core task, hides meaningful content, breaks responsive reflow, makes a control unreliable, or creates significant parity drift.
- **minor:** non-blocking spacing, alignment, wrapping, apparent contrast, target-size, or semantic issue.

Do not call a screen good because it “looks fine”. Cite the per-lane visual receipt and measured evidence. Snapshot absence is a capability note, never a finding and never by itself a blocker.
