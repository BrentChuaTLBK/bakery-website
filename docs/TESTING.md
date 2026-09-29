# Repeatable local regression

Use Node 24 or newer. From a fresh checkout:

```sh
npm install
npm ci --prefix tests/backend
npx playwright install chromium
npm run test:full
```

The pinned development dependencies provide Playwright, image decoding and ExcelJS. The backend lockfile pins PGlite. Tests use local fixtures and mocked external services; this command does not create live customers, orders, promo codes, emails or calendar events.

`test:full` probes the browser and required dependencies, starts its own loopback Academy preview on an available port, applies every migration to a fresh PGlite database, seeds the Academy scenario, then runs unit, backend, voucher, Edge and all tracked browser suites with at most two suites concurrently. It stops its preview and removes that run's temporary database/images on completion. Each suite has a five-minute timeout and a log in `test-results/full-regression/run-*`. `latest.json` records the run directory and actual pass count. Any failed suite, startup error or interruption returns a nonzero exit code. Tests can use internet downloads of the existing HEIC decoder; provider API calls remain mocked.

Existing provisioned dependencies can be selected through `PLAYWRIGHT_PACKAGE_ROOT` (directory containing Playwright and Sharp), `PGLITE_PACKAGE_ROOT`, and `EXCELJS_TEST_PATH`. Set `BROWSER_EXECUTABLE_PATH` to use an installed Chromium/Chrome executable instead of a Playwright download. The repository's HEIC image is the default conversion fixture; `HEIC_TEST_FILE` can override it.

`npm test` remains the quicker unit/backend/Edge run. `npm run build` checks the publishable static artifact. A local pass does not establish provider delivery, real-device installation, production capacity or that every possible behavior is tested. Live testing requires its own bounded scope and fixture cleanup.
