# Staging test fixtures (protected)

Synthetic accounts in the **staging** database only (`prooflab-staging-db`). Never production.
They are rows in `protected_test_accounts` (migration 55):
- account sync never suspends them;
- `auth.users` refuses to delete them unless the transaction sets `prooflab.allow_protected_delete = on`.

| Role | user id | Notes |
|---|---|---|
| Admin | `ffed80fc-08ee-4cce-ac54-9432ef2d81f9` | role `admin` |
| College / TPO | `99999999-0000-0000-0000-000000000001` | owner of "Staging Fake College" (`99999999-0000-0000-0000-000000000002`, approved), role `college_admin` |
| Company / Recruiter | `b19ab84b-2ebe-4dc8-8a51-470b2193168e` | "Probe Co", startups + recruiters rows, approved |
| Student (fresh: intake, resume) | `b3786001-a791-449a-bcd3-115f222a8bf1` | E2E Student, Staging Fake College, no intake yet |
| Student (established) | `99999999-0001-0000-0000-000000000001` | Fake Student 1 |

**Credentials.** None are stored in this repository, in any file, or in chat.

**Browser tests sign in for real.** The website keeps its session in the BFF's HttpOnly `__session` cookie and ignores browser storage, so a browser test can only sign in the way a person does:

1. `scripts/dev-tools/staging_browser_e2e.mjs` opens the site's own sign-in form (`scripts/dev-tools/bff_login.mjs`).
2. The form posts to `/api/auth/login`. The BFF checks the email and password with Google Identity Platform.
3. The BFF answers with the HttpOnly + Secure `__session` cookie. The test fails if that cookie is missing.

- Each role needs a dedicated **test Identity login** that already exists, passed in the environment and never printed: `E2E_<ROLE>_EMAIL` / `E2E_<ROLE>_PASSWORD`, with `ROLE` = `ADMIN`, `TPO`, `COMPANY`, `STUDENT`, `ESTABLISHED`.
- The test scripts never create, reset or change a login.
- The old way (a staging ticket minted from `prooflab-staging-jwt-secret` and planted in localStorage) **no longer signs a browser in**. Do not use it for browser tests.
- **Status (9 Oct 2026): these test Identity logins are not available yet, so the four-role staging browser E2E has not been run.** Creating them is an owner decision: staging and production share one Google Identity Platform pool, so a staging test login is also a valid login on the live site.

**API tests** that call the backend services directly (not through the browser) still use `scripts/dev-tools/st.py user:<id> ...`.
