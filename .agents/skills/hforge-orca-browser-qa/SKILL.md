---
name: hforge-orca-browser-qa
description: "Trigger: Orca Browser tests, pruebas con Orca, UI/UX, responsive, mobile QA, visual review. Run bounded Hforge QA with visible tabs and an Orca-only evidence ladder."
license: Apache-2.0
metadata:
  author: "hforge"
  version: "1.17"
---

## Activation Contract

Load for every Orca Browser test, inspection, UI/UX review, responsive check, or mobile QA request for Hforge, including “haz pruebas con Orca”.

## Hard Rules

- Use Orca only for browser control/evidence: never Playwright, CDP, or Computer Use. Resolve one `ORCA`, run `status --json`, retrieve `skills get orca-cli` plus version-matched guide; bounded `--help` only for omitted options, never inferred flags. `computer get-app-state` is the documented fallback.
- Before any process set `controller_started_at` plus one global deadline. Charge every killable command to it; terminate timed-out trees, record receipts; leave no unowned/hung process, watcher, wait, or promise.
- Create `runId`, canonical root, and Orca worktree ID first. Manifest each service: lease, nonconventional port, URL, supervisor handle/PID, listener PID/ownership, readiness, cleanup. Never assume ports, kill by port, or touch another worktree. Never use `start-local.bat` (fixed ports/global mutex); minimum services (anon Home: frontend only). Reuse external targets only with policy permission plus worktree/command/ports/live ownership; HTTP alone insufficient. Ephemeral ports only when the launch API reliably returns the actual port; Vite `--port 0` is not ephemeral. For Vite use `scripts/supervised-vite.mjs` per contract (hashed candidates, leases, preflight, `--strictPort`, readiness <=60s, listener-PID proof, foreground supervision).
- After resolving Orca version/platform/architecture, read capability cache TTL `86400000`: `node .agents/skills/hforge-orca-browser-qa/scripts/capability-cache.mjs read --orca-version <version> --platform <platform> --arch <arch> --ttl-ms 86400000`; `capability-cache.mjs write` only optional `snapshot|browser_screenshot` `timeout|error` with `--capability`/`--outcome`/`--failure-domain capability`. Only `capabilities.<name>.status=negative` skips its one probe; `unknown` probes. Missing/expired/invalid/corrupt/IO failures fail open; never cache success/control failures. After setup, run both optional probes serially on win32 (concurrent snapshot/screenshot/eval prohibited: hangs `clientHost.automation` ~90s), each with own watchdog/receipt; record fresh failures as `not_run_known_unavailable` per lane (cached skips as `not_run_cached_known_unavailable`).
- Read separate exact-key `reload_resets_viewport` cache (version/platform/architecture, TTL `86400000`) with `viewport-reset-cache.mjs read`. `observed`: apply viewport once after reload, then prove. `unknown`: prove first; write only after observed reset with `--behavior reload_resets_viewport --evidence <opaque-id>`. Cache failures fail open; final viewport proof is mandatory; mismatch permits one bounded reapply/reprobe.
- Required control: status, exact-page tab create/show/switch, eval, viewport verification. Each lane needs usable Orca visual plus DOM/viewport/basic-a11y. Browser screenshot preferred; failure selects the rubric's bound Orca-window fallback and never blocks target creation when control/eval/fallback work. Block only for no usable route or unbound visual. Details: `references/visual-rubric.md`.
- Reuse first: after `terminal create`, issue one uncached read-only `tab list --json` with supervisor readiness/status; await both before adoption/creation; never cache inventory or wait first. Reuse usable prior-run `HFORGE QA M/L` tabs only for same worktree/purpose; reapply isolated profiles, M=`390x844`/`hforge-mobile-m`, L=`430x932`/`hforge-mobile-l`, relabel `HFORGE QA M · run=<runId>` / `HFORGE QA L · run=<runId>`, reverify, and reseed. Create only missing lanes, keep at most two, adopt/close orphans with receipts, and emit the immutable page/profile manifest before lanes.
- Default two isolated M/L lanes, identical steps/fixture bytes; single M lane only for latency-debug goals with recorded justification (dual M/L default for responsive audits). Bind every command to its stored immutable page ID; never infer IDs or use active-tab order. Issue page commands serially on win32 in ascending page-ID order, no orchestration idle, preserving within-lane dependencies. Record each command's `commandElapsedMs` separately from diagnostic `orchestrationIdleMs`; idle is never product latency.
- Read fixture raw bytes once, record byte count/SHA-256/metadata once, decode UTF-8 once to one immutable string, write once per profile to raw `gym_state_v1`. Verify exact string equality/length/UTF-8 byte length; no parse/serialize/normalize/generate, re-transfer, per-field loops, or regex probes. E1/E2 combined multipurpose evals are the norm. Do exactly one consuming reload, combined lifecycle/viewport/fixture/Home proofs, then one final combined viewport/Home readiness probe. Use <=6 page evals per lane (excluding `tab show`/`viewport`). Prove viewport by eval, not CLI `ok`; unsupported viewport => `blocked_viewport_unapplied` with values, page ID, stage, output, elapsed, guide fallback. Hold `tabs-ready` until setup gates pass; `Home-ready` only after final readiness/parity; retain ready tabs always.
- In `finally`, close only disposable/partial tabs; stop only controller-owned trees; remove run leases/temp data except retained profiles/supervised frontend. Cross-run supervisor/frontend reuse allowed only with policy permission plus manifest worktree-hash match; stale hash forces fresh boot. Report retained IDs, supervisor handle/PID, lease manifest, ID-scoped cleanup (`orca terminal close --terminal <handle> --json`); never terminate by port.

## Decision Gates

| Evidence | Result |
| --- | --- |
| Every executed lane: usable browser/bound visual + complete DOM/viewport/a11y + selected checks | `PASS`/`FAIL`; snapshot optional |
| Required visual/DOM/interaction/parity evidence incomplete | `partial_audit`, never `PASS` |
| Snapshot fails, or browser fails with bound-window fallback | Continue; record degradation |
| No usable/bound route, broken control/eval, unrecovered viewport, timeout, or uncertain cleanup | `blocked_*`, never application `FAIL` |
| Complete evidence proves a defect | `FAIL` with severity/receipts |

Explicit scope wins. Without it, test clear changed targets plus basic smoke; ambiguity => `needs_user_scope`. “Home” remains Home-only.

## Execution Steps

1. Preflight: start controller/deadline; resolve ORCA/guide; read caches; classify capabilities; emit `preflight`.
2. Select scope; create manifest; prove reuse/start, read URL; batch post-`terminal create` tab list/readiness; settle probes serially; prove immutable lane setup, `tabs-ready`; run fixture/lane batches through one reload/recovery, `Home-ready`; capture evidence; clean owned resources; emit `lanes-started`/`cleanup/retained`; return. Optional/risky, never default: pre-creating tabs during Vite boot may overlap ~5s; requires ready-retry if navigation precedes readiness.

## Output Contract

Return one of `PASS`, `FAIL`, `partial_audit`, `blocked`, `blocked_visible_tabs`, `blocked_timeout`, `blocked_viewport_unapplied`, `blocked_evidence_transport`, or `needs_user_scope`. Include scope/exclusions, runtime/version, capability matrix, viewport-cache result, timestamps/deadline, M/L manifest, fixture hash/verification, `tabs-ready`, per-lane `Home-ready`, `lanes-started`, visual/DOM receipts, findings, separate `process_cleanup`/`target_tabs`/`target_profiles`. Keep `commandElapsedMs` and `orchestrationIdleMs` separate; idle is never product latency. Report listener/supervisor/lease/ownership receipts. Each lane records `reused`/`created`, immutable `browserPageId`, profile, viewport, `applied_verified` or `blocked_viewport_unapplied`. Distinguish `snapshot=unavailable` from required evidence failure. `PASS` requires complete visual/DOM/viewport/basic-a11y/selected functional-parity evidence in every executed lane, no blocker, temporary-data removal, and controller-tree cleanup; retained tabs/profiles require exact IDs and an ID-scoped cleanup command.

## Changelog

- v1.17: serial win32 page commands; single-M latency lane; supervisor reuse with hash check; combined-eval norm; optional parallel pre-create.
- v1.16: immediate tab inventory; batched immutable M/L; separate command/idle timing; verified bounded-TTL viewport-reset cache.

## References

- `references/visual-rubric.md` — detailed probes, metadata, binding, evidence, timeout, cleanup, findings.
- `assets/gym-state-v1-six-month-2026-09-07.json`
- `assets/generate-six-month-fixture.mjs` (provenance only; never invoke during QA)
- `scripts/supervised-vite.mjs`
- `scripts/capability-cache.mjs`
- `scripts/viewport-reset-cache.mjs`
