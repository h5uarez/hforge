# Hforge Mobile Browser QA Visual Rubric

Use this rubric for bounded, human-observable Hforge QA through Orca only. Snapshot is useful accessible-structure evidence, but it is optional. A snapshot failure must never prevent target-tab creation when control, eval, and at least one usable Orca-native visual route remain healthy.

## Scope

- Explicit scope wins. For explicit Home work, include launch smoke, Home, and requested Home behavior only; list excluded routes, states, and suites.
- Without explicit scope, use only clear diff targets plus basic smoke. Return `needs_user_scope` when the target is ambiguous.
- Never expand a quick Home request into the full product.

## Controller and bounded capability preflight

Set `controller_started_at` and one global deadline before starting a child process. Resolve one Orca executable, run `status --json`, fetch `skills get orca-cli`, and fetch the version-matched browser reference. If a required option is absent, run only that command's bounded `--help`; do not infer flags from an older guide.

Classify capabilities independently under killable watchdogs. A failure short-circuits only that capability:

1. **Control plane (required):** runtime status, target-tab create/show/switch, page-specific eval, and page-specific viewport.
2. **Snapshot (optional/preferred):** probe once on a disposable page when its status is unknown. On timeout/error, terminate the child tree, set `snapshot=unavailable`, and do not call snapshot again during that run.
3. **Browser screenshot (preferred visual):** probe once independently even if snapshot failed. On timeout/error, terminate the child tree, set `browser_screenshot=unavailable`, and do not call it again during that run.
4. **Orca app/window screenshot (required fallback when browser screenshot is unavailable):** use the version-documented `computer capabilities`, `list-apps`, `list-windows`, and `get-app-state` surface. Require `observation.screenshot=true`, an identified Orca process/window, a usable screenshot receipt/path, and the binding proof below.

Keep each browser capture watchdog at 5–15s and reserve cleanup time. Close the disposable page/profile in `finally`. An optional snapshot failure is recorded, not promoted to `blocked_evidence_transport`. Continue only if the control plane and at least one visual route are healthy.

Record a known snapshot or browser-screenshot timeout once in the run capability matrix. Every lane then records `not_run_known_unavailable` for that capability; never repeat a known-hanging command in either lane.

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

After target readiness, inventory open tabs with `tab list` and reuse two usable prior-run `HFORGE QA` tabs for the same worktree/purpose when present (adopt as M/L, reapply M = 390x844 and L = 430x932 viewports/profiles, relabel with the current `runId`, re-verify, reseed); create with `tab create` only the missing lanes. Never reuse default/unrelated tabs and never leave more than two QA tabs per run — explicitly adopt or close orphans with receipts. Use isolated profiles when available and label each page by setting and verifying its document title:

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
5. Immediately call `computer get-app-state` against that exact app/window with screenshot enabled and restoration/focus when documented. Accept only a usable image path/receipt whose same response identifies the window and selected lane label.
6. Record an atomic association: `lane → browserPageId → title/runId → Orca PID/windowId → screenshot artifact → timestamp`. If another tab becomes active or the selected title is absent, repeat the bounded binding sequence once; otherwise classify the artifact as unbound.

A generic desktop image, an image of another lane, or an image without selected-tab identity is not evidence.

## Viewport and lifecycle integrity

Every command targets the stored page ID. After navigation/reload and immediately after final viewport application, eval all fields below. The final gate must match exactly; CLI `ok` is not evidence.

| Lane | Expected width | Expected height |
| --- | ---: | ---: |
| M | 390 | 844 |
| L | 430 | 932 |

Required probe: `innerWidth`, `innerHeight`, `visualViewport.width/height`, `outerWidth`, `outerHeight`, `devicePixelRatio`, `documentElement.clientWidth/clientHeight/scrollWidth/scrollHeight`, body dimensions, URL, title/run ID, visibility state, and focused element. Record finite DPR rather than assuming `1`; `assets/viewport-matrix.json` defines dimensions only.

Allow one guide-documented same-page viewport reapply. On a second mismatch return `blocked_viewport_unapplied` with requested/observed values, page ID, stage, command, elapsed time, and deadline. Do not replace the page or relabel desktop dimensions as mobile.

## Fixture and Home sequence

Use identical bytes from `assets/generate-six-month-fixture.mjs` in exactly two isolated profiles. Record a fixture hash and verify `gym_state_v1`, fixture ID, 26 weeks, counts, and byte equality in both lanes.

For each lane:

1. Use its manifested page ID and navigate Home.
2. Immediately eval lifecycle identity/viewport.
3. Seed and verify the fixture, then perform exactly one consuming reload.
4. Immediately eval lifecycle identity/viewport again.
5. Apply the lane viewport as final setup; immediately run the complete final probe. Perform no later viewport-affecting navigation.
6. Wait for the bounded Home readiness selector/text and collect DOM/UX/basic-a11y data.
7. Capture visual evidence through the classified route. Record snapshot only when available; otherwise `not_run_known_unavailable`.

Run lanes concurrently when the available Orca surface safely supports immutable page targeting; use an equivalent bounded settled execution otherwise. One lane timeout cancels pending expensive work but does not close ready retained tabs.

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

Defaults: Orca command 15s, target/stack readiness 60s, lane 90s, global run 180s, cleanup 15s. Pass remaining global time to nested work. No unbounded sleep, polling, retry, live watcher, or unresolved promise.

Emit one record for every reached state: `preflight`, `tabs-ready`, `lanes-started`, `evidence`, and `cleanup/retained`, each with timestamp/deadline. In `finally`, stop controller-owned process trees, remove temporary fixture data, close disposable/partial pages, and retain ready target tabs/profiles. Uncertain process/temp cleanup prohibits `PASS`. Report an exact ID-scoped cleanup command but do not execute it automatically.

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
