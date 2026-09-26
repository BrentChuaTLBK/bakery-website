# heic-to 1.5.2

Unmodified CSP ESM distribution from `heic-to@1.5.2`, bundling libheif 1.22.2.
Loaded on demand for browsers without native HEIC support. Conversion takes
place in a local worker; source photos are not sent to a conversion service.

- Upstream source and build instructions: https://github.com/hoppergee/heic-to
- Versioned source distribution: https://registry.npmjs.org/heic-to/-/heic-to-1.5.2.tgz
- Package SHA512: `8Fns+lZHAWmz5U5IUxDeXKwIf3foBoKNPLxxFY4B0MkLjNuomEIHCoDbDE+x/llFK3NCEO1cu4+n3iUKY+Svmw==`
- `heic-to.js` SHA256: `c189220a7a1e87559758a48ab4700e55629fb23a4cb57489e1e8970be1b9d018`
- License: `LGPL-3.0-or-later` (the upstream LICENSE permits version 3 or later).
  See `LICENSE`, the accompanying `GPL-3.0.txt`, and the notices retained in
  `heic-to.js`.
- GPLv3 text: https://www.gnu.org/licenses/gpl-3.0.html; the unchanged text is
  included from GNU GCC's source mirror at
  https://github.com/gcc-mirror/gcc/blob/master/COPYING3.

This is a separate, replaceable library module. To replace it, copy another
compatible ESM CSP build to `heic-to.js`, retain its notices/license, and run
`tests/ui/heic-gallery.mjs` with local HEIC fixtures. The surrounding application
does not modify the library. No package installation or build step is required.
