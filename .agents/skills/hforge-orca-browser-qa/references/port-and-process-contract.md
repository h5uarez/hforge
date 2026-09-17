# Worktree-Scoped Port and Process Contract

Use this contract for every local service started by Hforge Orca QA. It prevents one worktree from waiting on, reusing, or terminating another worktree's server.

## Run identity and manifest

Before startup, create a filesystem-safe `runId`, resolve the canonical worktree root with Git plus realpath, and obtain the full Orca worktree ID. Store one run manifest outside the repository containing:

- `runId`, canonical worktree root, worktree hash/ID, controller start/deadline;
- one lease path and selected port per service, plus the exact target URL used by both tabs;
- candidate attempts and rejection reasons;
- exact executable, argv, cwd, supervisor terminal handle/PID, child PID, listener PID, and ownership verdict;
- HTTP readiness status/timestamps; and
- retained/stopped state with the exact owner-scoped cleanup command.

The selected URL in this manifest is authoritative. Do not reconstruct it from a default port.

## Allocation algorithm

1. Prefer a process-assigned ephemeral port only when the launch API exposes the bound address directly and reliably. In the repository's Vite 8.1.5 CLI, an empirical `--port 0 --strictPort` launch selected 5173 rather than an OS-assigned ephemeral port. Vite's JavaScript API can expose `httpServer.address()`, but Vite CLI output is not a stable machine-readable contract; never use CLI `--port 0` or parse its console text for this workflow.
2. For Vite CLI, use `../scripts/supervised-vite.mjs`. It hashes the canonical worktree root, service, and run ID into a non-conventional local range, then probes at most eight deterministic candidates.
3. For each candidate, create an exclusive lease file first and then perform a local bind probe. A busy port or existing lease rejects only that candidate.
4. Launch local Vite from the current worktree with `--host 127.0.0.1 --port <selected> --strictPort`. If the launch loses the probe-to-listen race, release only that run's lease and try the next candidate.
5. Readiness requires both HTTP 200 and OS listener ownership. The listener PID must be the exact Vite child started from this worktree, and the manifest must record its executable/argv/cwd. A responsive URL without this proof is not reusable.

Default helper bounds are eight candidates, 60 seconds startup, and the remaining global deadline when shorter. There is no indefinite polling or retry.

## Service minimum and reuse

- Anonymous Home uses only `frontend`; do not run `start-local.bat`.
- If a journey needs API, media, or another service, allocate and verify each service independently under this same contract. Never fall back to fixed 3000/8080/8888 values.
- An already-running server may be reused only when policy allows it and live evidence proves the same canonical worktree, equivalent command/cwd, selected port, and listener owner. "It returns 200" is insufficient.

## Cross-run supervisor/frontend retention (measured run qa-boot-20260917-1901-a1)

Retaining the lease plus a live supervisor frontend across runs saves ~5s boot plus cold compilation when policy permits it. Reuse is allowed only when all hold:

1. Policy explicitly permits cross-run retention for this worktree/purpose.
2. The retained manifest's worktree hash/ID matches the current canonical worktree root exactly — verify before reuse, never assume. A stale or mismatched hash forces a fresh boot; never point tabs at a server from another worktree or an outdated checkout.
3. Live ownership still verifies: the listener PID is the retained supervisor's exact Vite child, the lease file is still exclusively held, and HTTP readiness plus OS listener proof both pass.
4. The retaining run reported the exact supervisor handle/PID, lease manifest, and ID-scoped cleanup command, and the reusing run re-manifests them under its own `runId` (linking the prior receipt) so ownership never goes untracked.

If any check fails, release the retained lease and boot fresh under the allocation algorithm above.

## Supervision and cleanup

Run the helper in a dedicated Orca terminal so it remains a foreground supervisor. The helper owns its Vite child and lease, handles termination, and removes only its run directory/lease. Record the returned terminal handle in the manifest receipt.

If ready M/L tabs must remain usable, retain that exact supervisor terminal and report:

```text
orca terminal close --terminal <exact-handle> --json
```

Otherwise close that exact terminal in `finally` and verify the owned listener disappeared and its lease was removed. Never kill by port, process name, broad worktree selector, or guessed PID. Never close pre-existing tabs or terminals.
