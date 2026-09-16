# Hforge website (hforge.duarte-santos.ch)

Source of the project website — plain hand-written HTML/CSS/JS, no build step,
served by nginx.

Tracked branding files in this folder include the favicon set, the wordmark, and the social preview.
Not in this folder (added at deploy time):

- `img/` — the five screenshots from `../assets/screenshots/` plus `banner.png`
- `banner.png` — copied into `img/` from `../assets/banner.png` when the project banner is deployed
- `hforge.apk` — the signed release build (see `../docs/MOBILE.md`)

`site.js` fetches the star/fork counts from the public GitHub API at view time.
