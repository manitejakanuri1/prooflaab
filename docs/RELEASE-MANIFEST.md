# Release manifest

Generated for **remediation/1000-student-readiness** targeting production launch (~1,000 students).
Production must receive exactly these artifacts - deploy by digest, never by tag, and do not rebuild.

| | |
|---|---|
| Target release commit | `8fbee637b862eabb623698b3887bc06ecccf02ed` |
| Remediation branch | `remediation/1000-student-readiness` |
| Active frontend bundle | `index-8bvOj619.js` |
| Database migration state | Migrations 1 through 127 cataloged |
| Status | Remediation implemented, regression verified |

## Backend images (proven on staging / production baseline)

| Service | Staging Revision | Image | Digest | Concurrency / Scale |
|---|---|---|---|---|
| api | `prooflab-staging-api-00006-6x4` | `postgrest:v16.3` | `sha256:63b567a462c4fd81ede0bdff0b38a150f732ad5fe4f4b01cebeb6a1aa8dbe0d6` | Pool: 4, Scale: 6 |
| auth-bridge | `prooflab-staging-auth-bridge-00022-zat` | `prooflab-auth-bridge:sg487fb05` | `sha256:fa15be7311f7f63a72d48d7db6303dae3f97456f1c55ad0578902957e5696752` | Concurrency: 80, Scale: 3 |
| functions | `prooflab-staging-functions-00101-lov` | `prooflab-functions:sgc318ce3` | `sha256:ab3f784dfd4f92bdfe5e6adda29ffd1b627e9826051a6259be149720bcb9d7e4` | Concurrency: 80, Scale: 5 |
| files | `prooflab-staging-files-00015-nip` | `prooflab-files:rc41` | `sha256:956658b433bee8a554770495a0e397ff73b3911162d2681013c3a4480b238cd4` | Concurrency: 80, Scale: 3 |
| accounts | `prooflab-staging-accounts-00024-jep` | `prooflab-accounts:sgab2369c` | `sha256:7c1e20b005404372e03cb3ec004a9e1b16879ca34cdc9f89198db82e3534441a` | Concurrency: 80, Scale: 2 |
| transcriber | `prooflab-staging-transcriber-00012-qwe` | `prooflab-transcriber:prod-v1.2` | `sha256:357b139960429dca2537172dbfe11b52d11bc7079f03d357d21ebbcf0d87b49a` | Concurrency: 1, Scale: 10 (Target: 15) |
| transcription-worker | `prooflab-staging-transcription-worker-00025-h4b` | `prooflab-transcription-worker:sg487fb05` | `sha256:a148d99b66cd5f75d3abc7851e88f613a5a8e88ed9b6f611041691852eea8385` | Concurrency: 80, Scale: 10, Stale: 600s, MaxAttempts: 5 |
| code-runner | `prooflab-code-runner-00007-xop` | `code-runner:b2a079c181` | `sha256:f280b0bdedce2f2a71bf64f6974780ff12e52b2fdfb8b3d8d641ba480cb2b2b1` | Concurrency: 1, Scale: 12 (Target: 20) |
| web-bff | `prooflab-staging-web-bff-00017-wiw` | `prooflab-web-bff:sg487fb05` | `sha256:b8109d944fb0b719001b6067b5454b6045d9fa9b8cb7980e14d4850cbbd31265` | Concurrency: 80, Scale: 4 |

## Migrations (82 files under the ledger)

Apply through `python scripts/migrations.py wrap <file>`; the ledger refuses a file whose checksum differs.

| File | SHA-256 |
|---|---|
| `50-resume-assessment-keys-server-only.sql` | `1bb0c16de81361b9259092ebd5915b3c893e5e3146ab5ea1915a6d2efd72aeaf` |
| `51-verified-linking-and-safe-sync.sql` | `68a70b002ebffb3f48443230ce1380e14ecfad89d722317e76063eff2c03b8bb` |
| `52-frozen-evaluators-and-resume-origin.sql` | `d0a3e3c953fd1bd6b614161af9105b046d7ada80f871f1aa7f3627a3d1d1e68c` |
| `53-lot-order-and-seed-wording.sql` | `36a04772451bb245e8daa4c5ae1c4275bc7d4f85e634316c975fa00d046e7bc2` |
| `54-company-submissions-on-task-submissions.sql` | `aa75a913a5151cd6dfe4854d7787a383bcb2466b40d159c459c32f383e1de874` |
| `55-sync-soft-disable-and-protected-accounts.sql` | `0c876df281933a4d676c52efd293352e5568ca07c79442686f889a248756696b` |
| `56-company-lots-with-evaluators.sql` | `45d717d6aac025495a3d13c4f397872b11b8ec8b415ed2b9e787ea0e406be128` |
| `57-freeze-resume-evaluators.sql` | `4c7adaca99def6896eaaaefd86201b472d441a43a78296fceb28715a1ab5ede1` |
| `57b-company-lot-next-free-day.sql` | `4db72d81ead9d1d621b84ab78cea2fa842a2bd4fa55477fb4406fa5a4e1e6d44` |
| `58-college-source-privacy.sql` | `86d459161d20ef8634eb35a466798804af536641298e1e8fa3f786b69bc8bf2b` |
| `59-tpo-squads-without-trust.sql` | `135adad563ed25802f8db273f0e09fe0cec891d112e1edf3647621ac25c03dd0` |
| `60-squad-teammate-names.sql` | `2d6c989f4155c1ec9519ac4dd6f0af0a052e4632bcc9f6121b27636ede1b8bb5` |
| `61-voice-bound-to-submission.sql` | `c6a5131ccac711cd08891fa632e85bab4c9c35d62a12d18db495abc33d062093` |
| `62-import-student-in-one-transaction.sql` | `ebe1fde062061022a3cdfec89d2274a934f8000cb6910dcbbf459585e8e2794d` |
| `63-portfolio-from-current-evidence.sql` | `306ff273c8315a3c066e277d2b170d35abb516fb1b052e82641f9abdc6ecfee8` |
| `64-company-functions-on-current-evidence.sql` | `444cc6a40eb641891a6eefac829edd1bbb5fcb74bc9bc69c2541feafacecf76a` |
| `65-last-live-proof-readers.sql` | `62d3dbb79af86abe71a201d1f47958ca0bfb79fcd9da12aec98262d3da71d15e` |
| `66-retire-proof-era-objects.sql` | `4ea992f518a0663691672d363dd8de3cf64ca33a643d4d58f23966c26adb459f` |
| `67-schema-migrations-ledger.sql` | `bf762b2cab0dd89affdb610d95451a724be6ac743bdebc63e48f1bfc86e85312` |
| `68-daily-lots-isolate-failures.sql` | `5b9f07a0ea6162080e469b612bb2bfedf1f655e9d7662a785258bfb7835ee80b` |
| `69-voice-english-only.sql` | `378ec40c10b7149ed06fd64cf343cd9203937724defc5e5c77078a4eb4bb0621` |
| `70-my-rubric-labels.sql` | `07a3d284f6fd348fa56ee88ce254cbf598eda351d71e28ce59ef3d23e7cadb5c` |
| `71-drop-unused-proof-columns.sql` | `e4708d7235d2b1d8d76eb35e5e2814076082e068a0dbb88265b7f7d7951117e6` |
| `72-drop-task-applications.sql` | `55fc5ee23678a931133a2600ba3a694ce264b7be01d1c3bc2c7540859cea5197` |
| `73-suspended-accounts-are-refused.sql` | `63daaaf022fee47b99b000804a63eb358d38e769430992d269e32535950057e8` |
| `74-evaluator-type-integrity.sql` | `f93f830a415d1d7e1457a7c2d6e04c7a97768e21f638b407e26d3832e66b049e` |
| `75-daily-lots-status.sql` | `82c9e09251d4da8d492edd88cb22e0de859287eab78d5e91693de983914ffeb9` |
| `76-daily-lots-in-batches.sql` | `48d3991c08d43b6b585741064c8d4e03506da572ef5092782bc704ae873f552b` |
| `77-lot-template-checker.sql` | `0ac18dcc8757a45690aeee6e7d43db45b11852372e3d5ce02c69e0cec30c4aa4` |
| `79-skill-aliases-read-only.sql` | `48a2b30a1c6bc767b6cd3c44714d7cf2cdb703012f4e6cc59e3d39f49dbccb4c` |
| `80-server-only-functions-revoked.sql` | `f3773e325b99cfca048891d899aa28a4386a1c51825ebb6e405711f8e15464ef` |
| `81-sql-internal-functions-revoked.sql` | `7c06b03c7f40d0bdf641b9443c5d6d690ecd30136bd0924c9f2f95a282ef380d` |
| `82-topic-priorities-and-admin-notify-locked.sql` | `556e493926d798376414bc42b6c4da8fddf934c9607e7624c211e4e1467bd10d` |
| `82b-service-role-default-privileges.sql` | `3e2fe04cfc28894c4570e9bcc14e0c72619d2ca98ac0a93aa434608bd6a358fc` |
| `83-fail-closed-default-privileges.sql` | `af28ffd7455cf553e891f70e2bebc17ca180161dcbaaa5fd10cab6a2674467f5` |
| `84-no-self-approval-and-d3-d4-locks.sql` | `00344c71bbc88e4a809a006affa7bdde32a46e555befdb602d09f7437256d5f9` |
| `84a-null-safe-legacy-proof-functions.sql` | `01034a5a7628ac9c00bdfb9e044b1b8695877f19a98b9758696f03a788d48083` |
| `85-null-safe-ownership-checks.sql` | `d8c3b249b6119ca64ae6e6bb9e63aef171352b8cd82cc738da84261265fa2316` |
| `86-close-remaining-db-findings.sql` | `dd28f1eb2f7eba3d11a63023532da2d54c808d1401789c931581a3a8f3011df1` |
| `86b-service-role-reads-account-identities.sql` | `c352d4ed8bdfcab661621a464a1e604b19d39194a36d816645f1c303d8273910` |
| `86c-service-role-runs-student-is-discoverable.sql` | `754d388d1505b7319c844cc00f8944f8ca7d40c777b8e75c3229a7674016a2e8` |
| `87-remove-browser-maintain.sql` | `a23efd954891e2aaa1ed21105efb721600ba99821b541ed9114273997d47f6a9` |
| `88-daily-lots-v2-evidence-selection.sql` | `411f962a65d524e6356707e76c8f829cefb6b488d8614e6309648e0137b2f7e2` |
| `89-skill-vocab-ml-precision.sql` | `b329aced2202c6f6098d142728119182150cc2d7d73ecc09a6c80b2fa7006ef5` |
| `90-lot-fallback-reason-matches-evidence.sql` | `d0dbaec0bd72585ae9cb5eb18b13c66fd884733982a0b83266ec29bffbf83003` |
| `91-coding-pass-needs-every-test.sql` | `19a383b6d854b1e40ddbe23675e6369064f4368e5a6794aba790ea43b6b295f3` |
| `92-function-mode-foundation.sql` | `f171b6d346cdd2809285739a8973ab42949e8b695f83fa375678f8f6c08591ec` |
| `93-coding-pass-counts-hidden-summary.sql` | `e032705812cf8fd6bae4b3f52413446d5fcdcb812f39fb64deb663b178166143` |
| `94-drop-unused-verification-and-adjustment-tables.sql` | `abd1ad005c1d7199ff678cb208e79262e26838d568080501c112d56d1ef65746` |
| `95-web-sessions.sql` | `d49080ac2f528988868b4f15ee3cd9e418069ebb50de3b7cf08757f81f1572c6` |
| `96-managed-login-sessions.sql` | `090bc9d15a95064c9096c9e623b1759a883c9ea15ecc890580b89dc4ab87b60b` |
| `97-managed-account-provisioning.sql` | `bed7ade3e594848cb9d9c2b3117fe687a8a049f0255aa93bfb2ff31920c8d9c7` |
| `98-managed-college-provisioning.sql` | `39220768d10fafc7eb0e97ac5b7f21f961e8a3a30320e13a981bee5fe536dc9e` |
| `100-managed-accounts-only-policies.sql` | `7cb42c0864e0df559310eb30d79e264a0dc17157266336a502237e7630479581` |
| `101-revoke-sessions-when-access-ends.sql` | `aac471290ef2733623e67d03506bbd531fb1c4e872e620acbd9e7f6ef71507a3` |
| `102-student-access-enforcement.sql` | `9d3a1075353754405439f7e19fa0576a551841bbebdad85e114a660267b3611a` |
| `103-task-provenance-and-authz-repair.sql` | `80a25b29dc675e11f84026a893bdf46c3ef414b2e8b4d5b8a0d7d22498588d6a` |
| `104-ai-first-review-and-safe-resolution.sql` | `bb70712bb8dc61acbf0a3bcf827afc474c6d6d5a4840ed5a0ca1049c1190791f` |
| `105-live-controls.sql` | `e3b53f356f8cfdcda246eaf293931603ae9a1263980ba512450f8e673c50965f` |
| `106-remove-students-restore-submissions-backup.sql` | `1d4a823a444a6e1e227bd4a045fb7b42e36b072312f79e17d9f6322869b77780` |
| `106a-private-removed-students-access.sql` | `15ea7dafe756970695ec5821a3494e69ebd24e0949fe2b5cd096bb629e283b21` |
| `107-consent-guard-and-login-tracking.sql` | `e7b6b046a748bf1e66975f86683ee1d9262825766a1b068ee3a3316e5c950d1b` |
| `108-squad-vacancies-fill-safely.sql` | `3aa976e00bd9a3253c635ddd1f4ab36b3afa792068c981c85af513794f934070` |
| `109-default-squad-name-themes.sql` | `f4c1f2b89d9c0677bcf598daf7a4c35c60661f00c03ef5eb64b59ff4ff50e0a6` |
| `110-identity-lifecycle-all-roles.sql` | `fb626b010a2f73b0bc99c2a5c04e1ecea306e4f8bf2c010e1f8a601aa1a61b7d` |
| `111-capture-live-only-functions.sql` | `c01bf2ed967f83611df99e957d01acf8cae49179d5bee6a707aab3bb7106a6a1` |
| `112-empty-squads-keep-history.sql` | `b04c7f70d1bc5ee27caf6c09750d20d88468706691759f6d7ca16f46a803d9a0` |
| `113-squad-settings-validation.sql` | `7aa41ad153d06ce2c4a15008827a0f1922c542d269a978fe0e9838def6d5d4e5` |
| `114-suspension-and-profile-insert-locks.sql` | `09f01d600a94cabe66f14190bb2c32ed537ba6a45b065cf86aa1654ca6706f9a` |
| `115-college-approval-gates-login.sql` | `ea635d036aade958f18f65d3f5a67124d7a0b7954b12d38a0f22bb2132cf4733` |
| `116-interview-sources.sql` | `54e7948f04d6500d4f5cf46ab9762d09612cef8040af7486ac3c2e28cab54b57` |
| `117-season-champion-from-final.sql` | `510ed027ef8d11bf99463eff22a7d659503ee0fbc46d88a6b123bf90360b2ec9` |
| `118-active-day-points.sql` | `5e3ec00d65a6a52f1b08cde9dfb5038af8386af7316b873453248ecbc3e7867b` |
| `119-lot-submitted-activity.sql` | `96e424bae8338d0d1a93bcea32534f1cfb26400b3398f8ec3c686f79f0dfcdcc` |
| `120-scoring-rules-signed-in-only.sql` | `d10834cdb3383d5c60b25c578190579bf2b9fcfd47818ce8dea96d6959161566` |
| `121-onboarding-steps-for-college-and-admin.sql` | `fe6298aec27a4bb06b68bce07f9edf15ee140dc6ef21de5073ab6506f5095104` |
| `122-profile-attempts-streak-squad-mock.sql` | `08e76640a40d4bddb744126390277ade17c44ea1e3a85c8f495f00215199c66d` |
| `123-squad-member-contribution.sql` | `55c609225549997afcd317040ef522020dcdab6274c495498fafc43d93515caa` |
| `124-leaderboard-after-season.sql` | `9d214997ec7d940d34b909d07448f393d443ed69491bcae2c9ca8f9f972123a3` |
| `125-season-report-card.sql` | `6456200fbbfcaba35a42f9398a060a480cec82318ddd2b9819b6610e743ed781` |
| `126-lot-source-label.sql` | `2cf95f65a93408bd05c6a489eb67900e7fd6446f19326b20d11f1a1d09e40b32` |
| `127-voice-gated-task-completion.sql` | `df205670588c8f592b47076149f10f708091caa3a16cac3d16282d3e331f90c9` |

Order and grouping for production: see `PRODUCTION-ROLLOUT-CHECKLIST.md` stage 2 (66, 71, 72 are permanent drops and belong to stage 7).
