# Separate lift variants without mixing training history

Each execution has its own exercise ID. A two-second paused bench is not the same history as standard bench, and changing sets, reps or weight does not create another variant.

## Quick path

1. Find the base exercise in the library or add-exercise picker, open its routine settings and enable **Variant / specific execution**. Condition variants are grouped under their base, not shown as separate catalog rows; searching a variant name finds its base. The picker's **Chosen** filter includes bases used through variants.
2. Choose an existing execution or create one with an explicit condition. Selecting an equivalent condition reuses its ID, including curated variants.
3. Plans use `hforge_plan: 1` JSON with exact exercise IDs and personal variant definitions as described below. Import the plan normally.

Existing catalog IDs remain unchanged, including front/box/high-bar/low-bar/paused squat, close/wide/feet-up bench and sumo/Romanian deadlift. A generic paused squat does not imply a particular pause duration. Larsen press (unsupported extended legs) is deliberately distinct from feet-up bench.

## New curated executions

| Lift | Stable ID | Condition |
|---|---|---|
| Bench | `hf-bp-pause-1s`, `hf-bp-pause-2s`, `hf-bp-pause-3s` | Chest pause of 1, 2 or 3 seconds |
| Bench | `hf-bp-tempo-3100` | 3-second lowering, 1-second bottom pause, explosive lifting, no top pause |
| Bench | `hf-bp-spoto-2s` | 2-second pause above the chest |
| Bench | `hf-bp-pins-chest` | Start from pins at chest height |
| Bench | `hf-bp-larsen` | Legs extended without support |
| Squat | `hf-sq-pause-2s`, `hf-sq-pause-3s` | Bottom pause of 2 or 3 seconds |
| Squat | `hf-sq-tempo-3000` | 3-second lowering, no bottom pause, explosive lifting, no top pause |
| Squat | `hf-sq-pins-parallel` | Start from pins at parallel |
| Deadlift | `hf-dl-pause-1s`, `hf-dl-pause-2s` | Pause below knee of 1 or 2 seconds |
| Deadlift | `hf-dl-deficit-2cm` | Lifter elevated 2 cm relative to normal setup |
| Deadlift | `hf-dl-blocks-5cm` | Bar elevated 5 cm relative to normal setup |
| Deadlift | `hf-dl-tempo-3000` | 3-second lowering, no bottom pause, explosive lifting, no top pause |
| Sumo deadlift | `hf-dl-sumo-pause-2s` | 2-second pause below knee |

These are practical presets, not an exhaustive list or a ranking of training effectiveness. Pin positions are relative setup references; use a personal variant for a different position or measurement. Variants without their own media display the base exercise's media, labeled as a reference that does not demonstrate the specific condition. Custom bases without media still have no animation. This display fallback does not copy media into saved definitions or borrow the base's training history.

## Trainer JSON contract

Curated IDs work directly in `routines[].ex[].id`; do not duplicate them in `customEx`. Personal variants need definitions in `customEx`. Include their custom base definition too when the base is not a built-in exercise. Definitions can occur in any order. Inline `variant` or `baseId` fields on routine entries are rejected with instructions rather than silently discarded.

```json
{
  "hforge_plan": 1,
  "name": "Bench training",
  "week": { "1": "monday", "5": "friday" },
  "routines": [
    { "id": "monday", "name": "Monday", "ex": [
      { "id": "79D0BB3A", "sets": 3, "reps": 5, "weight": 80 }
    ] },
    { "id": "friday", "name": "Friday", "ex": [
      { "id": "hf-bp-pause-2s", "sets": 3, "reps": 5, "weight": 70 },
      { "id": "coach-pause-4s", "sets": 2, "reps": 3, "weight": 60 }
    ] }
  ],
  "customEx": [{
    "id": "coach-pause-4s",
    "n": "Bench press · 4-second chest pause",
    "bp": "chest",
    "baseId": "79D0BB3A",
    "variant": { "kind": "pause", "durationSec": 4, "position": "chest" }
  }]
}
```

| `variant.kind` | Required fields |
|---|---|
| `pause` | `durationSec` (number, 0.1–30), `position` (nonempty text) |
| `tempo` | `eccentricSec`, `bottomPauseSec`, `topPauseSec` (numbers, 0–30); `concentricSec` (number, 0–30, or `"X"`) |
| `pins` | `position` (nonempty reference text) |
| `deficit`, `blocks` | `heightCm` (number, 0.1–100) |
| `other` | `detail` (nonempty execution description) |

Condition text is limited to 120 characters. Extra condition keys, invalid numbers, unknown bases, variant-of-variant references and collisions with built-in IDs are rejected before importing anything. Use the original base and describe the full execution in one definition instead of chaining variants. Matching uses base ID and normalized conditions, not the display name; keep position wording consistent. A note alone never creates an independent execution.

## History and lifecycle

- Absent variant data keeps existing plans compatible. No historical sets or IDs are automatically rewritten.
- Previous sets, records, estimated 1RM, progression and statistics continue to use the exercise ID; a new variant never borrows the base's history.
- Rename a personal variant without changing its ID. Create another variant when its execution condition changes.
- Archive personal variants to hide them from selection without removing routines, records or history. Creating/importing the same condition restores its existing ID.
- You cannot delete a custom base while variants depend on it. Partial backups include custom base dependencies.
- An active exercise's identity cannot be changed through its settings after it has been added. Select the execution in the routine beforehand or add it as a separate active exercise; logged sets are never silently relabeled.
- Sharing a plan includes referenced personal definitions, not your training history.
