# Current and target architecture — 3 Oct 2026

## 1. CURRENT (from live config read now + source)

```mermaid
flowchart TD
  U[Students · Colleges · Companies · Admins<br/>browser] --> H[Firebase Hosting<br/>prooflab.co.in · index-DOGmJNPd.js]
  U -->|Google/email login| IDP[Identity Platform]
  U -->|ID token| AB[auth-bridge<br/>RS256 verify → HS256 ticket<br/>rt-authbridge]
  AB -->|resolve_account| API
  U -->|ticket| API[prooflab-api PostgREST 16.3<br/>pool 4 × max 4 · rt-api]
  U -->|ticket| FN[prooflab-functions<br/>40 Deno fns incl. 9 legacy · rt-functions]
  U -->|ticket| FS[prooflab-files<br/>owner-folder rule · rt-files]
  U -->|ticket · mock interview| TR[prooflab-transcriber<br/>Whisper base, English · rt-transcriber]
  API --> DB[(Cloud SQL prooflab-db<br/>Postgres 17 · db-g1-small · ZONAL<br/>50 connections)]
  FN -->|service_role token minted from shared secret| API
  FN --> CR[prooflab-code-runner<br/>public, secret header · no roles SA<br/>egress open]
  FN -.fallback.-> PUB[Wandbox / Godbolt / Glot]
  FN --> AI[DeepSeek]
  FN --> RS[Resend email]
  FN -->|enqueue| Q[Cloud Tasks prooflab-transcription]
  Q -->|OIDC tasks-invoker| W[transcription-worker<br/>private · transc-wk]
  W --> TR
  W --> API
  W --> FN
  FS --> GCS[(Storage: private books/ proofs/ resumes/ voice/ · public photos)]
  FN --> GCS
  ACC[prooflab-accounts · rt-accounts] --> IDP
  ACC --> API
  SCH[Cloud Scheduler 12 prod jobs<br/>Asia/Kolkata · webhook secret / OIDC] --> FN
  SCH --> ACC
  SCH --> JOBS[Jobs: bug-finder · crawler]
  MON[27 alerts · 8 uptime · budget] -.-> FN
  classDef legacy fill:#fde2e2,stroke:#c33;
  class PUB legacy;
```

Legacy still wired in (not drawn): proof_uploads/trust/cosign/conceptual tables, 9 functions, and the
Proof Review / Trust & XP / Cosigns / portfolio screens (see the legacy map).

Key properties of the current state:
- One HS256 secret is shared by the signer and every verifier (F1).
- Every function talks to the database as `service_role` (F2).
- Rate limits and AI usage logging are not running (F3).
- Infrastructure lives in the console only (F18).

## 2. TARGET production architecture (changes still required are marked ▲)

```mermaid
flowchart TD
  U[Users] --> H[Hosting · deploys the tested CI artifact ▲]
  U --> IDP[Identity Platform · verified email enforced server-side ▲]
  U --> AB[auth-bridge · ONLY signer, asymmetric keys ▲]
  U --> API[PostgREST · verifies public key only ▲]
  U --> FN[functions · caller token by default, service_role only for narrow RPCs ▲<br/>31 current functions, legacy removed ▲]
  U --> FS[files · write-once scored evidence ▲ · separate grant key ▲]
  API --> DB[(Cloud SQL · one migration folder + applied table ▲ · pooler ▲ · HA when scale needs ▲)]
  FN -->|Cloud Run identity ▲| CR[code-runner · INTERNAL ingress ▲ · per-run cleanup ▲ · memory limit ▲ · egress denied ▲]
  FN --> AI[DeepSeek · system/user separation, timeouts, PII minimisation ▲]
  FN --> LOG[(rate_limits · llm_usage · audit — working, awaited ▲)]
  FN --> Q[Cloud Tasks] --> W[worker private] --> TR[transcriber · larger model / language detect ▲]
  SCH[Scheduler · OIDC instead of shared secret ▲] --> FN
  ACC[accounts · delete threshold + alert ▲]
  IAC[Infrastructure as code ▲] -.-> ALL[all of the above]
```
