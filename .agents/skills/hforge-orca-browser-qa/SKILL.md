---
name: hforge-orca-browser-qa
description: "Trigger: Orca Browser tests, pruebas con Orca, UI/UX, responsive, mobile QA, visual review. Run bounded Hforge QA with visible tabs and an Orca-only evidence ladder."
license: Apache-2.0
metadata:
  author: "hforge"
  version: "1.9"
---

## Activation Contract

Load for every Orca Browser test, inspection, UI/UX review, responsive check, or mobile QA request for Hforge, including “haz pruebas con Orca”.

## Hard Rules

- Use Orca exclusively for browser control and visual evidence. Never substitute Playwright, CDP, or the Computer Use skill. Orca's documented `computer get-app-state` screenshot is an allowed Orca-native fallback.
- Resolve one `ORCA`, run `status --json`, retrieve `skills get orca-cli` plus the version-matched browser reference, and use bounded `--help` only for omitted options. Never infer flags.
- Start one controller/global deadline before any process. Every command is killable and charged to it; terminate timed-out child trees and record receipts. Never leave an unowned or hung process.
- Create a `runId` before startup and resolve the canonical worktree root plus Orca worktree ID. Every service gets a run-owned lease, selected port, target URL, supervisor identity, listener-owner proof, and cleanup receipt in one manifest. Never assume 5173, 8080, 3000, 8888, or any other conventional port.
- Do not use `start-local.bat` for concurrent QA: its fixed ports and global mutex are not worktree-safe. Start only the minimum services required by the selected journey; anonymous Home needs only the frontend. Any additional service must use the same worktree-scoped lease and ownership contract.
- Prefer a process-assigned ephemeral port only when the launch API returns the actual bound port reliably. Vite CLI `--port 0` is not the default path because its machine-readable port recovery is not contractual. For Vite, use `scripts/supervised-vite.mjs`: bounded worktree/run hash candidates, exclusive leases, preflight probes, `--strictPort`, HTTP readiness, listener-PID verification, and a foreground supervisor.
- Preflight capabilities independently. `snapshot` is optional accessibility structure; its failure disables snapshot for the run and is never a run blocker. Probe known-hanging operations once only, then record `not_run_known_unavailable` in every lane.
- Required control plane: status, exact-page tab create/show/switch, eval, and viewport verification. Required evidence plane per lane: one usable Orca-native visual artifact plus DOM/viewport/basic-accessibility measurements. Browser screenshot is preferred; an Orca app/window screenshot is valid only with the page-to-capture binding procedure in the rubric.
- A screenshot failure selects the documented Orca window-capture fallback; it does not stop target creation when control, eval, and fallback capture are healthy. Block only when no usable Orca visual route exists or the visual artifact cannot be bound to the exact lane.
- Reuse an external target only when canonical worktree, command, selected ports, and live listener ownership all match and policy explicitly permits reuse; an HTTP response alone is insufficient. Otherwise start exactly one supervised stack. Create exactly two fresh visible tabs labeled `HFORGE QA M` and `HFORGE QA L`, each with one `runId`; preserve immutable page/profile IDs and emit the manifest before lanes.
- Bind every action to its stored page ID. After navigation/reload and after final viewport application, immediately eval identity plus the full viewport probe. CLI `ok` is not evidence.
- Run exactly two isolated M/L lanes at 390x844 and 430x932 with identical deterministic `gym_state_v1` bytes and identical steps. Retain ready tabs for human observation on every terminal outcome.
- In `finally`, close only disposable/partial tabs, stop only controller-owned process trees, and remove run-owned leases/temp data except profiles and a supervised frontend intentionally retained for observable tabs. Never kill by port or touch another worktree's process. Report exact retained IDs, supervisor handle/PID, lease manifest, and an ID-scoped cleanup command; return without a live wait, watcher, or promise.

## Decision Gates

| Observed capability/evidence | Result |
| --- | --- |
| Per lane: browser screenshot **or** bound Orca window screenshot, plus complete DOM/viewport/basic-a11y probe and required functional/parity checks | `PASS` eligible; snapshot may be unavailable |
| Enough bounded evidence to report some lanes/checks, but any required lane lacks visual+DOM completeness or a required interaction/parity check is incomplete | `partial_audit`; never `PASS` |
| Snapshot fails while a required visual route and DOM probes work | Continue; record optional capability degradation |
| Browser screenshot fails and bound Orca window screenshots work | Continue through the fallback; `PASS` remains eligible |
| No usable Orca-native visual route, unprovable page-to-window binding, broken control/eval, viewport mismatch after one documented recovery, timeout, or uncertain process cleanup | `blocked_*`; never an application `FAIL` |
| Complete evidence proves an application defect | `FAIL` with severity and receipts |

Explicit scope wins. Without it, test only clear changed targets plus basic smoke; ask when ambiguous. “Home” remains Home-only.

## Execution Steps

1. Start the controller; resolve runtime/guide; emit `preflight`; classify control, snapshot, browser screenshot, and Orca window screenshot independently.
2. Select scope/exclusions; create the run manifest; inspect target readiness; prove an allowed equivalent owner or start only the required worktree-scoped services with readiness <=60s. For Vite use the supervised helper and read its emitted target URL rather than predicting a port.
3. Create, label, show, verify, and report exactly two visible client-hosted tabs; emit `tabs-ready` and retain them from this point.
4. Generate the fixture outside the repository. Run M/L through navigation, identity eval, fixture verification, one consuming reload, final viewport, and full probe; emit `lanes-started`.
5. Collect evidence using the selected ladder. For Orca window capture, switch/show the exact page, prove its lane marker by eval, capture the identified Orca window immediately, and record page ID → window ID → artifact receipt; emit `evidence`.
6. Reconcile all settled work and cancel on deadline breach. In `finally`, clean only run-owned processes/leases/temp data; if ready tabs must remain useful, retain their foreground-supervised frontend and report its exact Orca terminal handle plus `orca terminal close --terminal <handle> --json` as cleanup. Emit `cleanup/retained` and return immediately.

## Output Contract

Return `PASS`, `FAIL`, `partial_audit`, `blocked`, `blocked_visible_tabs`, `blocked_timeout`, `blocked_viewport_unapplied`, `blocked_evidence_transport`, or `needs_user_scope`. Include scope/exclusions, runtime/version, capability matrix, run/deadline timestamps, exact M/L manifest, fixture hash/verification, per-lane visual and DOM receipts, findings, command outcomes, and separate `process_cleanup`, `target_tabs`, and `target_profiles` statuses. Distinguish optional `snapshot=unavailable` from required evidence failures. `PASS` requires usable visual evidence in both lanes, complete DOM/viewport/basic-a11y and selected functional/parity checks in both lanes, no blocker, removed temporary data, and confirmed cleanup of every controller-owned process. Retained tabs/profiles are compatible with `PASS` when exact IDs and the cleanup command are reported.

## References

- `references/visual-rubric.md`
- `assets/viewport-matrix.json`
- `assets/generate-six-month-fixture.mjs`
- `references/port-and-process-contract.md`
- `scripts/supervised-vite.mjs`
