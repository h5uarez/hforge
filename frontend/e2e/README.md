# Browser regression suite

Playwright protects Hforge's primary browser journeys, responsive layout, and Windows Chromium visual reference.

## Run the suite

```sh
npx playwright install chromium firefox webkit
npm run test:browser:functional
npm run test:browser:visual
npm run test:browser:webauthn
```

Only refresh reviewed baselines on Windows:

```sh
npm run test:browser:visual:update
npm run test:browser:visual
```

The second command is mandatory: it proves the new files compare cleanly before review.

## Coverage boundaries

| Lane | Coverage |
|---|---|
| Visual | Chromium at 320×568, 375×667, 414×896, and 1440×1000; 40 viewport snapshots across primary views and overlays |
| Compatibility | Focused navigation and interaction journeys in Chromium, Firefox, and WebKit |
| Passkeys | Real local API plus a Chromium CDP virtual authenticator; registration, sign-out, and sign-in |
| Runtime isolation | Temporary API data directory, synthetic local state, fixed page time, reduced motion, blocked service workers, and deterministic media |

Snapshots are intentionally Windows-only because platform fonts and rasterization are not pixel-compatible with Linux. CI compares them on the pinned `windows-2025` image and uploads reports and diffs after failures.

## External lanes

The browser suite does not claim to simulate OS push delivery or native Capacitor notification scheduling. Browser service-worker and push contracts remain unit-testable, while delivery permissions, background suspension, notification presentation, and native scheduling require real-device or platform-managed validation.

Playwright freezes browser time, not the Node API scheduler clock. Scheduler assertions that depend on wall time need a separately injectable server clock rather than browser-side mocking.
