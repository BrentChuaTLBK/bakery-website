# Reproduce the mocked Edge test suite

Requires **Node.js 24** and the repository's development dependencies (`npm install`). ZIP recovery tests use `jszip` as an independent archive reader. Alternatively, set `ZIP_PACKAGE_ROOT` to an existing directory containing the `jszip` package. No Deno installation, provider account, API key, or network access is required to run the tests.

From the repository root:

```sh
node tests/edge/run.mjs
```

The runner starts Node's built-in test runner with TypeScript transformation enabled and loads the real Edge source. It supplies mocked Deno environment/serve APIs and intercepted fetch responses. The suite has expanded beyond the original eight checks below. The runner prints the current test count; all tests must pass. These original areas remain covered:

1. Image contents/type/size rejection.
2. Required email event content, private access links, and HTML escaping.
3. Unlisted origin and unauthenticated catalog upload denial.
4. Guest proof authorization, private storage, and atomic commit sequence.
5. Cleanup after a proof-upload race fails.
6. Verified staff identity and five-minute signed proof URL.
7. Worker secret protection and invalidated-reminder skip.
8. Stable email idempotency key and acceptance recording after provider success.

These are mocked checks, not evidence that hosted Supabase, Storage, SMTP, DNS, Resend, or cron has been configured. No email is sent. Follow `docs/SETUP.md` and the owner acceptance checklist to verify actual receipt after setup. The TypeScript-transform experimental warning is expected on Node 24.
