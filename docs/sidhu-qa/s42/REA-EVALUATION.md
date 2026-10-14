# REA (Reverse Engineer Anything) — evaluation before any install (S42, 13 Oct 2026)

**Not installed. Nothing executed.** Reviewed from the npm registry metadata and the published tarball, unpacked into
an isolated scratch folder with `npm pack` (which runs no package code).

## The package

| Item | Value |
|---|---|
| Package / version | `rea-agents@6.4.0` (= `latest`), MIT, repository github.com/morluto/rea |
| Published / maintainers | last modified **2026-10-11** (2 days before review); **one** maintainer |
| Node | `^22.19.0 \|\| ^24.11.0 \|\| >=26.0.0` — this machine has 22.23.3: compatible |
| Integrity | `sha512-Vj1zWfSlna5bphGoaoI/TcVBuYvze9u+OyPC3Shz8YkBqaCTqB4COnnRoX7XDwMpwI24ZlFEel2yEj0k8LTWEQ==`, npm registry signatures present; `npm pack` verified it |
| Install hooks | **none** (`install` / `preinstall` / `postinstall` absent; `prepare` only runs for git or local installs) |
| Size | 1,161 files, 7.8 MB unpacked |
| Notable dependencies | `playwright-core 1.58.2` (browser control), `@lydell/node-pty` (terminal emulator: can run commands), `isomorphic-git`, `@modelcontextprotocol/server` (MCP server), `@electron/asar`, `evmole` |
| Scope | a whole reverse-engineering suite: Android (adb, jadx, apktool), Ghidra, IDA, Hopper, JEB, .NET, firmware, EVM, browser, JavaScript. We would use only the JavaScript and browser parts |

## What `rea-agents setup --client claude_code` changes

From `dist/application/SupportedClients.js` and `SetupPlan.js`:
- adds an MCP server entry to **`~/.claude.json` (user scope)**: REA's tools become available to **every** Claude
  Code session on this machine, not only this QA worktree. A backup of the file is written first.
- installs a skill into `~/.claude/skills`.
- options: `--dry-run`, `--yes`, `--client`, `--skill`, `--skill-client`. **There is no project-only scope.**

## Risk for this repository

- The MCP server exposes browser control and a terminal emulator to the agent. On this machine `gcloud` is signed in
  with project-owner rights on `prooflab-508214` (production). Any tool that can run commands inherits that.
- User-scope registration means other sessions (including ones working on production) would see REA's tools.
- Very fresh release, single maintainer: supply-chain risk is not negligible.

## Recommendation (needs the owner's yes)

1. **Do not run `setup`** (no user-wide MCP, no skill).
2. If REA's JavaScript analysis is wanted, run its **CLI only**, pinned, from an isolated folder, against a copy of the
   **built staging bundle** (`index-Ju1L-FZy.js`, no credentials involved), e.g.
   `npx --yes rea-agents@6.4.0 <javascript reconstruction command> <copied dist folder>` — after first reading that
   command's code path in the unpacked tarball.
3. No REA browser observation against staging with signed-in sessions: the existing Playwright suite already records
   API method, path and status without headers or bodies; REA captures would add a second place where cookies could
   leak.
4. Treat any REA output as investigation evidence only; it never sets a PASS.

What REA would add today: a second, independent list of route and API strings found in the built bundle, to compare
with `sidhu_s41_contract_drift.mjs` (which reads the source). Useful, but not release-blocking.
