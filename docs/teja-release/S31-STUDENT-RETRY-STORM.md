# S31 — Student profile retry storm

Date: 9 October 2026. Laptop: TEJA. Worktree: `prooflabai-claude-s31`.
Branch: `fix/teja-claude-s31-student-retry-2026-10-09`. Base commit: `851cf7ecca4ff92be2e1507cca9476a33c057728`.

**Nothing was committed, pushed, deployed or migrated. No cloud, database or Identity access. S30 and the other worktrees were not changed.**

## 1. The answer first

| Question | Answer |
|---|---|
| Is the storm fixed? | Yes, in code, with tests. Not seen in a real browser yet. |
| What was the cause? | A failed profile was fetched again every time a screen mounted, and the dashboard's own spinner kept unmounting and remounting the screens. |
| Is `retryOnMount: false` the right fix? | Yes. It is one line and removes the loop at its source. |
| Was anything else changed? | One small failure screen with a "Try again" button on the student dashboard. See section 4; it needs your yes. |
| Did the four dashboards change? | No menu, tab, route or backend call changed. |

## 2. Root cause

```
profile fetch fails  ->  dashboard stops its spinner  ->  Floor / Squad screens mount
        ^                                                          |
        |                                                          v
dashboard shows spinner,   <-  query goes back to "loading"  <-  each mount retries
which unmounts the screens                                        the failed query
```

1. `StudentDashboard` shows a full-page spinner while the profile is loading. The spinner replaces every screen under it.
2. When the fetch fails, loading ends. The screens mount. Several of them read the same profile (`useStudentProfile`).
3. The query library retries a failed query whenever a new reader mounts (`retryOnMount`, on by default).
4. A query with no data goes back to "loading" when it refetches. The spinner returns, the screens unmount, and it goes round again.

Reproduced locally with the same query library and a mocked failing backend, no browser: **29 profile fetches in 15 seconds** with the app's real one-second retry delay. Sidhu measured 34 (Floor) and 33 (Squad).

## 3. The fix

| File | Change |
|---|---|
| `src/hooks/useStudentProfile.tsx` | `retryOnMount: false` on the profile query (1 line + comment). |
| `src/pages/StudentDashboard.tsx` | If the profile failed and there is none, show "We could not load your profile. Please try again." with a **Try again** button (12 lines). |
| `src/lib/profileRetryStorm.test.ts` | New. 9 tests. |

After the fix, during an outage: 1 request and its 1 configured retry, then nothing until one of these:

| Recovery path | Still works? |
|---|---|
| **Try again** button (`refreshProfile`) | Yes. Tested: one more attempt; loads the profile when the backend is back. |
| Returning to the browser tab (window focus) | Yes. App default, unchanged. Not tested here. |
| Network reconnect | Yes. Library default, unchanged. Not tested here. |
| Every minute while the tab is visible | Yes. App default, unchanged. About 2 requests a minute during an outage. Not tested here. |
| Page refresh | Yes. |

Not changed: the retry count (still 1), the one-minute refresh, the cache, the return shape of the hook, the other 12 components that use it.

## 4. The failure screen (needs your yes)

Before: once loading ended, the dashboard rendered Floor, Build-log, Squad or Profile with **no profile** and the name "Student". A server or permission failure then read as "no tasks" or "no squad".

Now: the failure is shown, for all four destinations, because all four render under the same page.

| Case | What the student sees |
|---|---|
| Profile loaded | The dashboard, as before. |
| No profile row yet (new student) | As before. This is not an error and does not show the failure screen. |
| 401, 403, 500, network failure | The failure message and **Try again**. No empty state, no success message. |

This is a failure state, not a feature, but it is new text on a student screen. If you do not want it, remove the 12 lines: the storm stays fixed by the one line in the hook, but the misleading empty screens come back.

## 5. Tests

| # | Check | Result |
|---|---|---|
| 1 | `node --experimental-strip-types --test src/lib/*.test.ts` | PASS 140/140 (131 base + 9 new) |
| 2 | `npm run typecheck` | PASS |
| 3 | `npm run build` (production settings) | PASS |
| 4 | `python scripts/browser_security_gate.py dist` | PASS |
| 5 | `git diff --check` (new files included) | PASS |
| 6 | `python scripts/secret_scan.py` (new files included) | PASS, 0 findings |
| 7 | `python scripts/legacy_guard.py` | PASS, 0 active occurrences |
| 8 | `python scripts/migrations.py check` | PASS, 104 migrations, 0 problems. None added. |
| 9 | `python scripts/test_release_guard.py` | PASS 17/17 |
| 10 | `python scripts/test_atomic_migration_guard.py` | PASS 6/6 |
| 11 | `npx eslint` on the three files | **FAIL: 2 errors, both old.** Lines 53 and 60 of `useStudentProfile.tsx` (`as any`), unchanged from the base. No error on a changed line. `eslint` is not part of CI. |

The 9 new tests:

| Test | Proves |
|---|---|
| Reproduction: no fix | More than 10 fetches in 250 ms of mocked outage (the loop) |
| 401 / 403 / 500 / network (4 tests) | Exactly 2 fetches, spinner ends, the error is reported, no profile is invented |
| Successful load | 1 fetch, profile shared |
| Try again after recovery | 1 more fetch, profile loads |
| Try again during the outage | 1 more attempt and its retry, then stops |
| Wiring | The hook has `retryOnMount: false`; the dashboard checks the failure before any destination renders and its button calls `refreshProfile` |

| Skipped | Why |
|---|---|
| Real browser run of Floor, Squad, Build-log, Profile during an outage | No browser harness was run and no test login exists (Identity 0/5). Sidhu should re-run the S28 measurement on this patch. |
| Gateway (Deno) tests, Docker | No gateway file changed. |
| Live or staging checks | Not allowed in S31. |

Limits, said plainly: the tests drive the real query library with the real option, but they model the dashboard (one page reader, three child readers) rather than rendering React. The four destinations were verified by reading the code: all four are rendered by `StudentDashboardContent` under the one check in `StudentDashboard`.

## 6. Risks and notes

| Item | Note |
|---|---|
| Once a minute during an outage the page flips to the spinner and back to the failure screen | Existing one-minute refresh. Two requests a minute. Acceptable; say so if not. |
| The message does not say why it failed | On purpose: one plain sentence for every cause. Sign-out handling is unchanged. |
| Other hooks may have the same pattern | Not searched in S31. Only the reported profile storm was fixed. |
| S30 | Not touched. S31 changes two files S30 does not change, so the two patches do not overlap. |

## 7. Rollback

Nothing is committed. Undo the two edits and delete the new test file and this report. Ask first; it deletes files.

## 8. Next steps, each needs a yes

1. Your decision on the failure screen (section 4).
2. Teja Bash review of the patch.
3. Sidhu re-runs the S28 outage measurement on Floor and Squad.
4. Only then: commit, and combine with S30.
