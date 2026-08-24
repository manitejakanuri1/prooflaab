#!/usr/bin/env bash
# ProofLabAI — one-command setup for a Mac or Linux machine.
#
#   bash setup.sh
#   bash setup.sh work/a
#
# Safe to run again. Everything checks before it acts: nothing is installed
# twice, no local change is overwritten, and it stops rather than guessing.

set -euo pipefail

BRANCH="${1:-work/b}"

say()  { printf '   %s\n' "$1"; }
step() { printf '\n\033[36m-> %s\033[0m\n' "$1"; }
good() { printf '\033[32m   %s\033[0m\n' "$1"; }
warn() { printf '\033[33m   %s\033[0m\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

printf '\nProofLabAI setup\n----------------\n'

# ── 1. the two tools this project needs ─────────────────────────────────
step "Checking Git and Node"

if have git; then
  good "Git already installed — $(git --version)"
else
  if have brew; then
    say "Installing Git..."; brew install git >/dev/null; good "Git installed"
  else
    warn "Git is missing and Homebrew is not installed."
    warn "Install Git from https://git-scm.com, then run this again."
    exit 1
  fi
fi

if have node; then
  good "Node already installed — $(node --version)"
else
  if have brew; then
    say "Installing Node..."; brew install node >/dev/null; good "Node installed"
  else
    warn "Node is missing and Homebrew is not installed."
    warn "Install Node 20+ from https://nodejs.org, then run this again."
    exit 1
  fi
fi

# ── 2. the code ─────────────────────────────────────────────────────────
step "Getting the code"

if [ -d .git ]; then
  good "Already inside the repository"
else
  say "Cloning — sign in to GitHub as manitejakanuri1 when asked"
  git clone https://github.com/manitejakanuri1/prooflaab.git
  cd prooflaab
  # The clone names the remote "origin"; this project's deploy remote is called
  # "prooflaab" everywhere, so make both names point at the right one.
  git remote rename origin prooflaab 2>/dev/null || true
  good "Cloned"
fi

# ── 3. your branch ──────────────────────────────────────────────────────
step "Switching to $BRANCH"

if [ -n "$(git status --porcelain)" ]; then
  warn "You have uncommitted changes. Leaving the branch alone so nothing is lost:"
  git status --short
  warn "Commit or stash them, then run this script again."
else
  git fetch prooflaab >/dev/null 2>&1 || true
  if git ls-remote --heads prooflaab "$BRANCH" | grep -q .; then
    git checkout -B "$BRANCH" "prooflaab/$BRANCH" >/dev/null 2>&1
    git pull prooflaab "$BRANCH" >/dev/null 2>&1
    good "On $BRANCH, up to date"
  else
    warn "$BRANCH does not exist on the remote. Staying where you are."
  fi
fi

# ── 4. packages ─────────────────────────────────────────────────────────
step "Installing packages"
say "First run takes a few minutes."
npm install --no-fund --no-audit
good "Packages installed"

# ── 5. does it actually build ───────────────────────────────────────────
step "Checking the project compiles"
if npm run typecheck; then
  good "Typecheck passed — the setup is sound"
else
  warn "Typecheck failed. The setup is fine; the code has an error to look at."
fi

cat <<'DONE'

Ready.

  Start the app:      npm run dev        -> http://localhost:8080
  Start with Claude:  claude

  Claude reads CLAUDE.md automatically and will know this project.
  Ask it to read START_HERE.md if you want the long version.

  One rule that matters: say out loud which laptop owns the database
  before either of you applies a migration.

DONE
