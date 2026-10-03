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

**Credentials.** None are stored anywhere.
- Staging and production share one Google Identity Platform pool, so a real staging login would also be a valid login on the live site. Staging fixtures therefore have **no Identity login**.
- Browser and API tests sign in with a staging ticket minted at run time from Secret Manager (`prooflab-staging-jwt-secret`), shaped exactly like the staging auth-bridge's:
  - API: `scripts/dev-tools/st.py user:<id> ...`
  - Browser: `scripts/dev-tools/staging_browser_e2e.mjs`
- The real Google sign-in step is covered by the production smoke test with protected production accounts, which needs owner approval.
