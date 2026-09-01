# Workout Session Scrollable Layout: Orca Evidence Runbook

This is a post-implementation operator checklist. **Every result is `PENDING` until the
native `sdd-verify` phase runs it in Orca's embedded browser.** Do not infer geometry,
occlusion, or accessibility-tree results from source or Vitest tests.

## Capture protocol

1. Open the web build in Orca and use its browser resolution controls; do not use the
   native mobile runtime. Record the source revision, URL, viewport, locale, theme, session
   state, and test date for every scenario.
2. Run the matrix at **320px, 360px, 390px, and desktop**. Capture a screenshot and the
   accessibility tree for each distinct failure or representative passing state.
3. Label each row `PASS`, `FAIL`, or `PENDING`; include screenshot/tree filenames and notes.

## Matrix

- [ ] `PENDING` English, Spanish, and long strings; light and dark themes; zero, one, and
  many exercises; weighted, bodyweight, timed, and cardio sessions.
- [ ] `PENDING` Values `105.25` and `105,25`, reps `12`, RPE/RIR, empty effort, and
  unilateral L/R rows remain editable, aligned, and unclipped.
- [ ] `PENDING` Plain exercises plus two- and three-member supersets reorder as whole units;
  complete a unit, reorder it, and confirm values, completion, rest, index, and resume state.
- [ ] `PENDING` Exercise index, add, move, back, resume, finish, and discard flows restore
  focus and visibility without hijacking ordinary scrolling.
- [ ] `PENDING` Timers, overlays, safe-area clearance, keyboard appearance, invalid input,
  persistence failure, retry, undo/cancel, and recovery preserve visible work.
- [ ] `PENDING` `main`, headings, landmarks, localized names, visible focus, polite live
  status, practical targets, DOM order, and reduced-motion behavior are usable.

## Evidence record

| Scenario / viewport | Locale/theme/state | Result | Screenshot | A11y tree | Revision / notes |
|---|---|---|---|---|---|
| Matrix above | Record before each run | PENDING | — | — | — |

## Approved exclusions

Source checks and this runbook intentionally do not claim runtime proof for a native mobile
runtime, Heavy-specific behavior, drag-only reorder, or saved routine/day-plan mutation.
Verify that each remains out of scope; report any observed violation separately rather than
expanding the feature.
