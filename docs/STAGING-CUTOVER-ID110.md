# Staging cutover: identity lifecycle (migration 110) + isolated staging logins

Release commit for every image: `ebca05738c1971b79a97e3f412a068ea1b7e04d3` (`stab-ebca057`). STAGING ONLY.
Production is not part of this procedure.

## State before cutover (13 Oct 2026)

| Service | Serving 100% now (rollback target) | Staged at 0% (tag `id110`) | Image digest |
|---|---|---|---|
| accounts | `prooflab-staging-accounts-00015-rpk` | `prooflab-staging-accounts-00019-nuk` | `sha256:89719ab47c85568175948e172b1064c660f004a7ffc0f8fac354fa2f1941b1ba` |
| files | `prooflab-staging-files-00012-gf4` | `prooflab-staging-files-00014-zif` | `sha256:2a00095bfc188ea6a2126c9b1a7b4648380d96bc4dab08e231bae8375ab9a335` |
| auth-bridge | `prooflab-staging-auth-bridge-00012-vsq` | `prooflab-staging-auth-bridge-00014-ter` (audience fix pending: CPU quota) | `sha256:a6404c64ad126bebd7fef42a8419cf48e56be59d74eb756a5b6fbbd454d9cac4` |
| web-bff | `prooflab-staging-web-bff-00004-9nn` | `prooflab-staging-web-bff-00011-bed` (calls the `id110` canaries) | `sha256:27eb2c53b586173a0bba15f8d0ab8e48d71353aeda7cb604e3fa24fa6d5a327c` |

* Database: migration 110 applied and recorded (checksum `fb626b010a2f73b0…`); backup before it: `1791838240847`.
* Identity: `prooflab-stg-identity-508214` holds 39 disposable fixture logins (test domains only, same login ids as
  their staging accounts; passwords in secret `prooflab-staging-iso-fixture-logins`). 3 Gmail-linked accounts on hold.
* Scheduler: `prooflab-staging-accounts-sync` PAUSED, yearly schedule, dry-run URL.

Tag URLs: `https://id110---prooflab-staging-<service>-ysn2mpe6sa-el.a.run.app`

## Variables

```
P=prooflab-508214; R=asia-south1; ID=prooflab-stg-identity-508214
SA=serviceAccount:prooflab-staging-accounts@prooflab-508214.iam.gserviceaccount.com
REPO=$R-docker.pkg.dev/$P/cloud-run-source-deploy
BRIDGE=https://prooflab-staging-auth-bridge-ysn2mpe6sa-el.a.run.app
```

## Steps (each needs the previous one green)

0. **Headroom.** Staging and production share 20 vCPU in asia-south1. Do not start while staging has idle canary
   instances; check production `/ready` before and after. Never during 05:30–06:00 IST.
1. **Owner: staging-project permission** (isolated project only).
   ```
   gcloud projects add-iam-policy-binding $ID --member=$SA --role=projects/$ID/roles/prooflabStagingIdentityOperator --condition=None
   gcloud projects add-iam-policy-binding $ID --member=$SA --role=roles/serviceusage.serviceUsageConsumer --condition=None
   ```
   Rollback: the same two lines with `remove-iam-policy-binding`.
2. **Verify isolation (read-only).** Dry-run sync on the accounts canary:
   `POST https://id110---prooflab-staging-accounts-…/sync?dry_run=1` with the staging webhook secret.
   Expect: 200, `logins` 39, `missing_now` 0, `unlinked_ignored` ≈ 15,021, `shared_identity` false.
3. **Canary bridge audience** (when CPU allows), then canary sign-in for the five fixture roles through the `id110` BFF.
   ```
   gcloud run deploy prooflab-staging-auth-bridge --project=$P --region=$R --image=$REPO/prooflab-auth-bridge@sha256:a6404c64… --no-traffic --tag=id110 \
     --update-env-vars=IDENTITY_PROJECT=$ID,SERVICE_TOKEN_AUDIENCE=https://id110---prooflab-staging-auth-bridge-ysn2mpe6sa-el.a.run.app
   ```
4. **Owner: remove staging's delete power over PRODUCTION logins.**
   ```
   gcloud projects remove-iam-policy-binding $P --member=$SA --role=projects/$P/roles/prooflabStagingAccountsOperator --condition=None
   ```
   Rollback: `add-iam-policy-binding` with the same arguments.
5. **Owner says "switch staging traffic". Order: accounts, files, then bridge and BFF back to back.**
   ```
   gcloud run services update-traffic prooflab-staging-accounts --project=$P --region=$R --to-revisions=prooflab-staging-accounts-00019-nuk=100
   gcloud run services update-traffic prooflab-staging-files    --project=$P --region=$R --to-revisions=prooflab-staging-files-00014-zif=100
   # bridge: final revision = same digest, normal audience (the id110 one names its tag URL)
   gcloud run deploy prooflab-staging-auth-bridge --project=$P --region=$R --image=$REPO/prooflab-auth-bridge@sha256:a6404c64… --no-traffic --tag=id110f \
     --update-env-vars=IDENTITY_PROJECT=$ID,SERVICE_TOKEN_AUDIENCE=$BRIDGE
   # BFF: final revision = same digest, normal service URLs, isolated browser key
   gcloud run deploy prooflab-staging-web-bff --project=$P --region=$R --image=$REPO/prooflab-web-bff@sha256:27eb2c53… --no-traffic --tag=id110f \
     --update-env-vars="AUTH_BRIDGE_URL=$BRIDGE,ACCOUNTS_URL=https://prooflab-staging-accounts-ysn2mpe6sa-el.a.run.app,FILES_URL=https://prooflab-staging-files-ysn2mpe6sa-el.a.run.app"
   gcloud run services update-traffic prooflab-staging-auth-bridge --project=$P --region=$R --to-tags=id110f=100
   gcloud run services update-traffic prooflab-staging-web-bff    --project=$P --region=$R --to-tags=id110f=100
   ```
   Between the bridge and BFF switches, sign-in fails for seconds (old BFF key vs new bridge project). Staging only.
6. **Smoke.** BFF `/ready` 200; sign in as each fixture role; `sync?dry_run=1` as in step 2; signed-out baseline
   `node scripts/dev-tools/sidhu_s40_anon_api.mjs --confirm-staging`; production `/ready` unchanged.
7. **GitHub `staging-e2e` secrets** (owner): `E2E_*_PASSWORD` from secret `prooflab-staging-iso-fixture-logins`
   (same e-mails and user ids). Then Sidhu's live suite: `.github/workflows/staging-live-e2e.yml` with `EXPECTED_SHA=ebca057…`.
8. **Activate the sync** only after a reviewed dry run:
   ```
   gcloud scheduler jobs update http prooflab-staging-accounts-sync --location=$R --project=$P --schedule="*/10 * * * *" \
     --uri=https://prooflab-staging-accounts-ysn2mpe6sa-el.a.run.app/sync
   gcloud scheduler jobs resume prooflab-staging-accounts-sync --location=$R --project=$P
   ```
9. **Owner: last production-project grant** (staging imports now create logins in the isolated project):
   ```
   gcloud projects remove-iam-policy-binding $P --member=$SA --role=projects/$P/roles/prooflabStagingImportCreator --condition=None
   ```

## Rollback (any step)

1. `gcloud scheduler jobs pause prooflab-staging-accounts-sync --location=$R --project=$P`
2. Traffic back, one line per service:
   `gcloud run services update-traffic prooflab-staging-<svc> --project=$P --region=$R --to-revisions=<serving revision above>=100`
3. IAM: re-add whatever step 4/9 removed (same arguments, `add-iam-policy-binding`).
4. Database, only if 110 itself must go: services first (step 2), then `migration/110-rollback-identity-lifecycle-all-roles.sql`
   through `scripts/dev-tools/staging_sql.sh`. Last resort: restore backup `1791838240847`.
