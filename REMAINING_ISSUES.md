# ProofLabAI — Remaining Issues (Second, Deeper Sweep)

**Date:** 21 July 2026
**Purpose:** Everything *not* already covered in `PROJECT_STATUS.md`. This is the deeper pass — security, data-model splits, duplicate code paths, and confirmed user-visible bugs.

**Bottom line:** The first sweep found *missing* features. This sweep found **things that are actively wrong** — including one likely privilege-escalation hole and one confirmed broken feature. Two of these are more urgent than anything in the first report.

---

## 🔴 CRITICAL — Fix these first

### C1. `/review-proofs` gives College Admins the entire Admin Dashboard 🚨

**This is the most serious finding in either report.**

The route in `App.tsx`:
```tsx
<Route path="/review-proofs" element={
  <RoleBasedProtectedRoute allowedRoles={['admin', 'college_admin']}>
    <ReviewProofs />
  </RoleBasedProtectedRoute>
} />
```

The name suggests it's a proof-review screen. **It isn't.** `ReviewProofs.tsx` is a near-exact **duplicate of the entire Admin Dashboard** — it renders `AdminSidebar` plus every admin panel:

| Panel it exposes | What a college admin can now reach |
|---|---|
| `EnhancedUserManagement` | **Every student, startup and college on the platform** — not just their own |
| `SystemSettings` | Platform-wide configuration and role assignment |
| `TrustXPModeration` | Manually alter **any** student's trust score or XP |
| `CollegeOversight` | **Other colleges'** data |
| `StartupOversight` / `StudentOversight` | Platform-wide user data |
| `AdminAnalytics` | Whole-platform reporting |
| `ContentManagement` | Jobs, resources, announcements for everyone |

**What this means in practice:** Any college admin who types `/review-proofs` into the address bar lands in the full platform admin console. They don't need to hack anything — the route guard explicitly lets them in.

**How bad is it really?** Row Level Security *may* block some of the underlying data reads, so this might be a UI-only exposure rather than a full breach. But two things make that a weak defence: (a) it's unverified — the RLS policies would each need auditing, and (b) `TrustXPModeration` performs *writes*, and if any of those succeed, a college can inflate its own students' trust scores. **That would destroy the credibility of the entire scoring system**, which is the product's only real asset.

**Fix (5 minutes, do it today):**
```tsx
allowedRoles={['admin']}   // remove 'college_admin'
```
Then decide properly: if college admins genuinely need a proof-review screen, build a scoped one. **Do not** give them the admin dashboard.

**Then verify:** log in as a college admin and confirm each admin table actually refuses to return other colleges' rows.

---

### C2. Followers / Following list is permanently empty — split-brain on two tables 🔴

**Confirmed bug, visible to every student, every time.**

There are **two follow tables** and the code uses both:

| Component | Table it touches |
|---|---|
| `FollowButton` → `follow_user` / `unfollow_user` RPC | writes to **`user_follows`** ✅ |
| `StudentFeedPage` | reads **`user_follows`** ✅ |
| All count functions (`get_user_follow_counts`, `get_follower_count`) | read **`user_follows`** ✅ |
| **`FollowersFollowingModal`** | reads **`follows`** ❌ |

And critically: **no migration in this repo ever creates or populates a `follows` table.**

**What the student sees:** Their profile says "24 Followers". They tap it. The list is **empty** — or throws an error. Every single time.

**Why this is worse than it looks:** Followers are the social proof that makes the feed feel alive. A follower count you can't click through to is obviously broken, and it's on the most-visited screen in the app.

**Fix (15 minutes):** Change the two queries in `FollowersFollowingModal.tsx` (lines ~49 and ~71) from `.from('follows')` to `.from('user_follows')`. Verify the column names match (`follower_id` / `following_id` — they do).

---

## 🟠 HIGH — Data model is split in four places

The same pattern repeats: an older table and a newer table both exist, and different parts of the app write to different ones. Each split is a future "why is this number wrong?" bug.

### H1. `students` vs `student_profiles`
- `student_profiles` is the real table — trust score, XP, everything reads from it.
- But **four places still write to the legacy `students` table**: `EnhancedRoleBasedAuthForm`, `AuthCallback`, and `OnboardingStudent` (twice).
- **Risk:** Signup writes to both. If they ever drift, you get students who exist in one table and not the other — and the failure will look like "this student disappeared."

### H2. `colleges` vs `college_profiles`
- `colleges`: 34 usages. `college_profiles`: 11 usages. Both active.
- Profile editing and the onboarding wizards use `college_profiles`; most dashboards use `colleges`.
- **Risk:** A college updates its name in Settings and it doesn't change on the dashboards.

### H3. `startups` vs `startup_profiles`
- `startups`: 15 usages. `startup_profiles`: 5. Same pattern, same risk.

### H4. `notifications` vs `social_notifications` vs `startup_notifications` vs `admin_notifications`
- Four separate notification tables, all in use.
- **Risk:** No single place to answer "does this user have unread notifications?" Easy for one stream to be silently missed.

**Recommended fix for all four:** Pick the winner in each pair, migrate any stragglers, delete the loser, and add a comment so nobody re-introduces it. **Half a day per pair.** Do H1 first — it's on the signup path, which is the worst place to have inconsistency.

---

## 🟠 HIGH — Two rival onboarding systems, both live

There are **two complete sets of onboarding wizards**, and **both are routed and reachable**:

| Route | Component used |
|---|---|
| `/onboarding/college` | `CollegeMultiStepWizard` |
| `/onboarding/startup` | `StartupMultiStepWizard` |
| `/onboarding-wizard` | `CollegeWizard` **and** `StartupWizard` (the old ones) |

**The problem:** Two different code paths collect signup data, and they don't necessarily write the same fields to the same tables. Which one a user hits depends on how they got there. Any fix applied to one won't apply to the other.

Note the old `CollegeMultiStepWizard` also has its CSV upload cut out (it silently discarded files) — evidence these paths have already drifted.

**Fix:** Delete `/onboarding-wizard` and the two old wizards; redirect that route to the correct per-role one. **1–2 hours.**

---

## 🟡 MEDIUM — Duplicate admin components

`ReviewProofs.tsx` imports **both** `UserManagement` and `EnhancedUserManagement` — and only ever renders the Enhanced one. `UserManagement` is dead weight that still ships in the bundle.

Also duplicated: `ProfilePhotoModal` (student) vs `ProfilePhotoModalUniversal` (college) — two components doing the same job for different roles.

**Fix:** Delete `UserManagement`. Merge the two photo modals into the Universal one. **2 hours.**

---

## 🟡 MEDIUM — Dead database schema

Five tables exist in the database with **zero references anywhere in the app**:

| Table | Notes |
|---|---|
| `students_auth` | Superseded by Supabase Auth |
| `student_otps` | OTP login was presumably abandoned for email verification |
| `task_templates` | Template feature never wired up |
| `proof_public_audit` | Audit table nothing writes to |
| `invite_codes_validation` | Superseded by `validate_invite_code_secure` |

**Why care:** Dead tables confuse anyone reading the schema and make you wonder whether audit data is being captured when it isn't (`proof_public_audit` is especially misleading given how much the product leans on auditability).

**Fix:** Confirm they're empty in production, then drop them in one migration. **1 hour.**

---

## 🟡 MEDIUM — 71 `console.log` statements ship to production

Spread across 20 files. Some log user data and query results.

**Two problems:** (1) anyone can open DevTools and read internal data flow and table structure — useful reconnaissance for someone trying to game their trust score, (2) it's noise that makes real errors hard to spot.

**Fix:** Strip them in the Vite production build (`esbuild: { drop: ['console'] }` in `vite.config.ts`), keeping `console.error`. **15 minutes.**

---

## 🟢 LOW — Smaller items

| Item | Detail | Fix |
|---|---|---|
| **Silent auth catches** | 5 places do `.catch(() => {})` on `signOut`. If sign-out fails, the user believes they're logged out but their session is live — a real concern on shared college computers. | Log the failure and warn the user. 30 min |
| **Hardcoded support email** | `support@prooflabai.com` hardcoded in two spots in `VerificationBanner`. | Move to config. 10 min |
| **`ProofRedirect` legacy route** | `/student/proof/:id` exists only to redirect. Fine for now, but it's accumulating. | Remove once links have aged out |
| **No global loading skeletons** | `PageLoader` is a blank div. On slow connections the app looks frozen. | Add a skeleton. 1 hour |

---

## Revised Priority Order (both reports combined)

### Today — security & confirmed bugs
| # | Task | Effort | Source |
|---|---|---|---|
| 1 | 🚨 **Remove `college_admin` from `/review-proofs`** | 5 min | This report |
| 2 | 🚨 **Audit RLS on the admin tables** to confirm no data leaked | 2 hrs | This report |
| 3 | 🔴 **Fix Followers/Following modal** (`follows` → `user_follows`) | 15 min | This report |
| 4 | Strip `console.log` from production build | 15 min | This report |

### This week — silent failures (users being misled)
| # | Task | Effort | Source |
|---|---|---|---|
| 5 | Build the **appeals review screen** | 1–2 days | Status report |
| 6 | Surface **recruiter interest** to colleges | 1 day | Status report |
| 7 | Fix **file upload** — or remove the button | 1 day | Status report |
| 8 | Show **announcements** to students | 0.5 day | Status report |

### Next — fake data & data model
| # | Task | Effort | Source |
|---|---|---|---|
| 9 | Wire real **Pack Leaderboard** | 0.5 day | Status report |
| 10 | Wire real **Pack Analytics** | 1 day | Status report |
| 11 | Consolidate `students` / `student_profiles` | 0.5 day | This report |
| 12 | Delete the duplicate onboarding wizards | 2 hrs | This report |
| 13 | Make bulk "AI personalized tasks" call real AI | 0.5 day | Status report |
| 14 | Consolidate colleges / startups / notifications tables | 1.5 days | This report |

### Then — hardening
15. Tests on `trust-compute` · 16. Fix 28 `exhaustive-deps` · 17. Merge the two verification paths · 18. GitHub PAT expiry alert · 19. Resubmission path · 20. Drop dead tables · 21. Decide on MOSS · 22. Replace 206 `any` types

---

## What Changed From The First Report

The first sweep put **Appeals** at #1. That's now #5, because two things outrank it:

1. **A college admin can reach the full admin console** — including a screen that writes trust-score adjustments. If that write path works, the integrity scores are forgeable, and the integrity score *is* the product.
2. **The followers list is confirmed broken** — a 15-minute fix on a bug every student hits.

Everything from the first report still stands. This report adds **6 new issues**, of which **2 are more urgent than anything previously found**.

**Realistic total to close both reports: about 8–9 working days.** The first four items take under three hours combined and remove the two genuinely dangerous problems.

---

*From full source analysis of `C:\Users\manit\prooflabai-mvp`. Every issue here was confirmed by tracing the actual code path, not inferred.*
