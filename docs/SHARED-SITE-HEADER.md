# Shared website header

All 27 website pages use the same TLB Kitchen navigation: Home, Specialties, FAQ, TLB Academy, Order Online, account, and basket. Staff and Academy workspace controls remain below this global header.

Edit `assets/partials/site-header.html` for navigation content, `assets/ordering/site-header.css` for appearance, and `assets/ordering/site-header.js` for menu behavior. Run `node scripts/site-header.mjs` to refresh the committed pages; `node scripts/site-header.mjs --check` verifies that they match. The static build also refreshes every output page from this template.

The navigation is rendered in the HTML and its links remain available without JavaScript. Mobile menu controls, native Specialties disclosure, keyboard focus, Escape handling, current-page indicators, and nested Academy paths are supported. Header styling uses the existing local Chelsea Market font and does not depend on Bootstrap.

Validated all 27 pages at desktop and mobile widths, including the menu at 320 pixels, keyboard operation, relative links, no-JavaScript navigation, and Academy sidebar spacing. Existing Academy and recipe browser acceptance suites also pass. This change requires no database migration.
