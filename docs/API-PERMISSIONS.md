# API permission contract

Public `SECURITY DEFINER` dispatch functions are intentional gateways. Being allowed to execute a dispatcher is not permission to execute every action. Each branch checks identity, role, order ownership/token and state; private `tlb` tables and implementation helpers are not browser APIs. `search_path` is fixed. Do not suppress a security advisory by granting private tables to the browser or revoking a gateway needed by checkout.

| Entry point | Anonymous / ordinary account | Staff | Owner | Internal service |
| --- | --- | --- | --- | --- |
| `shop_api`: catalog, quote | Public; server calculates price/date/stock | Same rules | Same rules | — |
| `shop_api`: create/get/cancel order | Customer action and exact order token/ownership checks; promo redemption requires a verified account | Staff order branches separately authorize | Staff branches plus owner actions | — |
| `shop_api`: admin bootstrap, inventory and order review | Denied | Permitted staff branches | Permitted | — |
| `shop_api`: products, settings, promos, team, event/payment setup | Denied | Denied for owner branches | Permitted owner branches | — |
| `shop_api`: POS sales, cash drawer, direct-order editing | Denied | Permitted selling branches; owner-only overrides remain checked | Permitted | — |
| `shop_api`: calendar list/sync request | Denied | Verified staff | Verified owner | Worker uses separate gateway |
| `shop_api`: my vouchers | Verified account's own vouchers only | Own account | Own account | — |
| `shop_api`: voucher campaigns | Denied | Denied | Owner only | Issuance runs inside service logic |
| `homepage_api`, `gallery_api`, party/dessert package/item/photo APIs | Published browse only | Owner mutations denied | Draft/edit/publish/reorder/delete branches | — |
| `academy_api` | Published content only | Owner editing denied | Draft management and publish | — |
| `academy_media_readable` / Storage policy | Only referenced published media; signing does not widen access | Same published rules | Draft media under owner policy | — |
| `newsletter_offer` | Public offer only | Same | Same | — |
| `newsletter_admin` | Denied | Denied | Owner operations | — |
| `shop_service`, `newsletter_service`, `newsletter_broadcast_service`, `shop_calendar_service`, `tlb_calendar_worker_authorized` | SQL execute denied | SQL execute denied | Browser SQL execute denied | Service role only; worker credential and per-action checks |
| proof upload/read Edge functions | Exact order access plus payment-stage/state for uploads; private proof reads denied | Authorized proof reads | Product image uploads and authorized proof reads | Edge validates before Storage API use |
| `tlb.check_operation_alerts`, incidents table | Denied | Direct access denied | Direct access denied | Database owner scheduler; authenticated admin bootstrap returns bounded summaries |

Edge email worker accepts only its dedicated worker secret. Calendar worker uses its dedicated credential; interactive connection changes require verified owner identity. Neither accepts a browser owner session as a worker secret. Service keys never belong in browser code. Operational alert emails contain counts and dashboard links, not customer details or private order links.

Run `npm run test:full`. Existing backend suites cover token/ownership checks, foreign-user refusal, verified promo rules, staff/owner split, inventory allocation, accounting, POS, campaign ownership, Academy published/draft media and calendar permissions. Edge suites cover worker authorization, proof authorization before storage, wrong-origin refusal and forged/oversized uploads. `operation-alerts.mjs` (`--operations`) adds actual-role refusal tests for the monitor/table and internal gateways plus staff/owner summary access. The test runner applies all migrations before these checks; helper security is checked by executing the calls, not by scanning source text alone.

This map describes current boundaries. It is not authorization to broaden roles, change production settings or erase advisory findings. A new gateway/action must declare its role and gain both an allowed-role test and a denied-role test.
