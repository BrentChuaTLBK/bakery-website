# Short order references

New orders use a rider-friendly reference such as **TLB-A7K2M9**: `TLB-` plus six random uppercase letters and numbers. Both character types are always present, and confusing I/O/0/1 characters are excluded. References appear through the existing order, account, staff, print-slip and email views without a frontend format change.

The generator uses cryptographic random bytes, the existing order transaction lock, an indexed collision check and the existing unique constraint. A collision generates another candidate. After 64 unsuccessful candidates at a length, it tries one more character, up to 12; it never renumbers an existing order. The existing idempotency key returns the same order and reference on checkout retries.

References are public labels for identifying an order in rider notes. They are not authentication secrets. Viewing an order still requires its independent UUID plus the 256-bit private access token, or an authorized customer/staff session. No lookup or access endpoint based on the short reference is added. The generator is private and not executable by browser or service roles directly.

The customer order page has a **Copy order ID** button beside its reference. It copies only that reference, shows **Copied!** and an accessible confirmation, and supports old and new orders. If the browser denies clipboard access, it tries a text-selection fallback; if that also fails, it selects the reference for manual copying and shows an honest error. Private order links are never placed on the clipboard by this button.

Existing references, UUIDs, tokens and sent emails are preserved. Do not give a rider the full private order link; the reference and buyer name are sufficient for identification by staff.

Validation covers mixed-character formatting, uniqueness, idempotent checkout, reference use in queued email, token-only guest access, customer ownership, legacy references, forced collisions and automatic extension beyond six characters.

## Rollout · September 24, 2026 (Asia/Manila)

The backend migration is live (`short_order_references`, remote version `20260923165226`, source `20260923164954_short_order_references.sql`). A live transaction created a short-reference order, replayed checkout without changing its reference, rejected reference-only lookup and reference-as-token access, and successfully opened it with its independent 64-hex-character token. The queued email contained the short reference. The entire test transaction was rolled back, so it produced no order, reservation or email. All 12 pre-existing order references and access digests were unchanged.

Validation: 221 backend checks across 31 migrations, plus customer copy-button tests at 1440px, 390px and 320px. Browser tests cover the exact clipboard value, permission-denied fallback, truthful failure feedback, legacy references and longer references without horizontal overflow. Existing security-advisor findings were unchanged. Publish the accompanying shop HTML, JS, copy helper and stylesheet together to activate the button.
