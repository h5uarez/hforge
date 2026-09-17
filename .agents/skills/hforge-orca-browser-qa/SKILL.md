---
name: hforge-orca-browser-qa
description: "Trigger: Orca Browser tests, pruebas con Orca, UI/UX, responsive, mobile QA, visual review. Run bounded Hforge QA with visible tabs and an Orca-only evidence ladder."
license: Apache-2.0
metadata:
  author: "hforge"
  version: "1.16"
---

## Activation Contract

Load for every Orca Browser test, inspection, UI/UX review, responsive check, or mobile QA request for Hforge, including “haz pruebas con Orca”.

## Hard Rules

- Use Orca only for browser control/evidence: never Playwright, CDP, or Computer Use. Resolve one `ORCA`, run `status --json`, retrieve `skills get orca-cli` and its version-matched browser guide, and use bounded `--help` only for omitted options; never infer flags. `computer get-app-state` is the documented fallback.
- Before any process set `controller_started_at` and one global deadline. Charge every killable command to it; terminate timed-out child trees, record receipts, and leave no unowned/hung process, watcher, live wait, or promise.
- Create `runId`, canonical root, and Orca worktree ID first. Manifest each service: run lease, selected nonconventional port, URL, supervisor handle/exact PID, listener exact PID/ownership, readiness, cleanup. Never assume conventional ports, kill by port, or touch another worktree. Never use `start-local.bat` (fixed ports/global mutex); run minimum services (anonymous Home needs only frontend). Reuse external targets only with policy permission plus exact worktree, command, ports, and live ownership; HTTP alone is insufficient. Use process-assigned ephemeral ports only when the launch API reliably returns the actual port; Vite `--port 0` is not default. For Vite use `scripts/supervised-vite.mjs` with hashed candidates, leases, preflight, `--strictPort`, readiness, listener-PID proof, and foreground supervision; readiness <=60s.
- After resolving Orca version/platform/architecture, read capability cache TTL `86400000`: `node .agents/skills/hforge-orca-browser-qa/scripts/capability-cache.mjs read --orca-version <version> --platform <platform> --arch <arch> --ttl-ms 86400000`; `capability-cache.mjs write` only optional `snapshot|browser_screenshot` `timeout|error` with `--capability`/`--outcome` and `--failure-domain capability`. Only `capabilities.<name>.status=negative` skips its one probe; `unknown` probes. Missing/expired/invalid/corrupt/read/write failures fail open; never cache success/control failures. After setup, launch both optional probes concurrently with separate watchdogs/receipts, await both, and record fresh failures as `not_run_known_unavailable` per lane (cached skips as `not_run_cached_known_unavailable`).
- Read separate exact-key `reload_resets_viewport` cache (version/platform/architecture, TTL `86400000`) with `viewport-reset-cache.mjs read`. `observed`: apply each viewport once after reload, then prove. `unknown`: prove first; write only after an observed reset with `--behavior reload_resets_viewport --evidence <opaque-id>`. Cache failures fail open; final viewport proof is mandatory; mismatch permits one bounded reapply/reprobe.
- Required control is status, exact-page tab create/show/switch, eval, and viewport verification. Each lane needs usable Orca visual plus DOM/viewport/basic-a11y evidence. Browser screenshot is preferred; failure selects the rubric's bound Orca-window fallback and does not block target creation if control/eval/fallback work. Block only for no usable route or unbound visual. Use `references/visual-rubric.md` for detailed field probes, fixture metadata, binding, evidence, timeouts, and cleanup.
- Reuse first: immediately after `terminal create`, issue exactly one uncached read-only `tab list --json` concurrently with supervisor readiness/status; await both before adoption/creation, never cache inventory or wait first. Reuse usable prior-run `HFORGE QA M/L` tabs only for the same worktree/purpose; reapply isolated profiles and M=`390x844`/`hforge-mobile-m`, L=`430x932`/`hforge-mobile-l`, relabel `HFORGE QA M · run=<runId>` / `HFORGE QA L · run=<runId>`, reverify, and reseed. Create only missing lanes, keep at most two, adopt/close orphans with receipts, and emit the immutable page/profile manifest before lanes.
- Exactly two isolated M/L lanes use identical steps/fixture bytes. Bind every command to its stored immutable page ID; never infer IDs or use active-tab order. Batch independent M/L setup/eval/reload/probe commands in ascending page-ID order without orchestration idle, preserving within-lane dependencies. Record each command's `commandElapsedMs` separately from diagnostic `orchestrationIdleMs`; idle is never product latency.
- Read committed fixture raw bytes once, record byte count/SHA-256 and known metadata once, decode UTF-8 once to one immutable string, and write it once per isolated profile to raw `gym_state_v1`. Verify exact stored-string equality/length/UTF-8 byte length without parse/serialize/normalize/generate, repeated transfer, per-field loops, or regex probes. Do exactly one consuming reload, combined lifecycle/viewport/fixture/Home proofs, then one final combined viewport/Home readiness probe. Use <=6 page evals per lane (excluding `tab show`/`viewport`). Prove viewport by eval, not CLI `ok`; unsupported viewport => `blocked_viewport_unapplied` with requested/observed values, page ID, stage, exact output, elapsed time, and guide fallback. Keep `tabs-ready` until setup gates pass; emit `Home-ready` only after final readiness/parity; retain ready tabs on every outcome.
- In `finally`, close only disposable/partial tabs; stop only controller-owned trees; remove run leases/temp data except retained profiles and intentionally retained supervised frontend. Report exact retained IDs, supervisor handle/PID, lease manifest, and an ID-scoped cleanup command (`orca terminal close --terminal <handle> --json`); never terminate by port.

## Decision Gates

| Evidence | Result |
| --- | --- |
| Both lanes: usable browser/bound visual + complete DOM/viewport/a11y + selected checks | `PASS`/`FAIL`; snapshot optional |
| Required visual/DOM/interaction/parity evidence incomplete | `partial_audit`, never `PASS` |
| Snapshot fails, or browser fails with bound-window fallback | Continue; record degradation |
| No usable/bound route, broken control/eval, unrecovered viewport, timeout, or uncertain cleanup | `blocked_*`, never application `FAIL` |
| Complete evidence proves a defect | `FAIL` with severity/receipts |

Explicit scope wins. Without it, test clear changed targets plus basic smoke; ambiguity => `needs_user_scope`. “Home” remains Home-only.

## Execution Steps

1. Preflight: start controller/deadline; resolve ORCA/guide; read caches; classify capabilities; emit `preflight`.
2. Select scope; create manifest; prove reuse/start and read URL; batch the post-`terminal create` tab list/readiness; settle probes; prove immutable M/L setup and `tabs-ready`; run raw fixture/identical lane batches through one reload/recovery and `Home-ready`; capture evidence; clean owned resources; emit `lanes-started`/`cleanup/retained`; return.

## Output Contract

Return one of `PASS`, `FAIL`, `partial_audit`, `blocked`, `blocked_visible_tabs`, `blocked_timeout`, `blocked_viewport_unapplied`, `blocked_evidence_transport`, or `needs_user_scope`. Include scope/exclusions, runtime/version, capability matrix, viewport-cache result/evidence, timestamps/deadline, exact M/L manifest, fixture raw hash/verification, `tabs-ready`, per-lane `Home-ready`, `lanes-started`, visual/DOM receipts, findings, and separate `process_cleanup`, `target_tabs`, and `target_profiles` statuses. Keep `commandElapsedMs` and `orchestrationIdleMs` separate; idle is never product latency. Report listener/supervisor/lease/ownership receipts. Each lane records `reused`/`created`, immutable `browserPageId`, profile, M/L viewport, and `applied_verified` or `blocked_viewport_unapplied` evidence. Distinguish `snapshot=unavailable` from required evidence failure. `PASS` requires complete visual/DOM/viewport/basic-a11y/selected functional-parity evidence in both lanes, no blocker, temporary-data removal, and controller-tree cleanup; retained tabs/profiles require exact IDs and an ID-scoped cleanup command.

## Changelog

- v1.16: immediate tab inventory; batched immutable M/L; separate command/idle timing; verified bounded-TTL viewport-reset cache.

## References

- `references/visual-rubric.md` — detailed probes, metadata, binding, evidence, timeout, cleanup, findings.
- `assets/gym-state-v1-six-month-2026-09-07.json`
- `assets/generate-six-month-fixture.mjs` (provenance only; never invoke during QA)
- `scripts/supervised-vite.mjs`
- `scripts/capability-cache.mjs`
- `scripts/viewport-reset-cache.mjs`
