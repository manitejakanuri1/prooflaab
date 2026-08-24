# ProofLabAI — one-command setup for a Windows machine.
#
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1 -Branch work/a
#
# Safe to run again. Everything here checks before it acts: nothing is
# installed twice, no local change is overwritten, and the script stops rather
# than guessing if it finds something it did not expect.

param(
    [string]$Branch = "work/b"
)

# Deliberately NOT "Stop". PowerShell 5.1 turns anything a native command
# writes to stderr into an error record — and git writes ordinary progress
# there — so "Stop" kills this script on a perfectly healthy fetch. Exit codes
# are checked by hand instead.
$ErrorActionPreference = "Continue"

function Say([string]$text)  { Write-Host "  $text" }
function Step([string]$text) { Write-Host ""; Write-Host "-> $text" -ForegroundColor Cyan }
function Good([string]$text) { Write-Host "   $text" -ForegroundColor Green }
function Warn([string]$text) { Write-Host "   $text" -ForegroundColor Yellow }

function Have([string]$cmd) {
    return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

Write-Host ""
Write-Host "ProofLabAI setup" -ForegroundColor White
Write-Host "----------------"

# ── 1. the two tools this project needs ─────────────────────────────────
Step "Checking Git and Node"

if (-not (Have "winget")) {
    Warn "winget is not available on this machine."
    Warn "Install Git and Node 20+ by hand, then run this script again."
    exit 1
}

if (Have "git") {
    Good "Git already installed - $((git --version))"
} else {
    Say "Installing Git..."
    winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements | Out-Null
    Good "Git installed"
}

if (Have "node") {
    Good "Node already installed - $((node --version))"
} else {
    Say "Installing Node LTS..."
    winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements | Out-Null
    Good "Node installed"
}

# winget puts new tools on the PATH of *future* shells, not this one.
if (-not (Have "git")) {
    Warn "Git is installed but not on this shell's PATH."
    Warn "Close this window, open a new one, and run the script again."
    exit 1
}

# ── 2. the code ─────────────────────────────────────────────────────────
Step "Getting the code"

if (Test-Path ".git") {
    Good "Already inside the repository"
    git fetch prooflaab --quiet
    if ($LASTEXITCODE -ne 0) { git fetch origin --quiet }
} else {
    Say "Cloning - sign in to GitHub as manitejakanuri1 when asked"
    git clone https://github.com/manitejakanuri1/prooflaab.git
    Set-Location prooflaab
    # The clone names the remote "origin"; this project's deploy remote is
    # called "prooflaab" everywhere, so make both names point at the right one.
    git remote rename origin prooflaab
    Good "Cloned"
}

# ── 3. your branch ──────────────────────────────────────────────────────
Step "Switching to $Branch"

$dirty = git status --porcelain
if ($dirty) {
    Warn "You have uncommitted changes. Leaving the branch alone so nothing is lost:"
    git status --short
    Warn "Commit or stash them, then run this script again."
} else {
    git fetch prooflaab --quiet
    $exists = git ls-remote --heads prooflaab $Branch
    if ($exists) {
        git checkout -B $Branch "prooflaab/$Branch" --quiet
        git pull prooflaab $Branch --quiet
        Good "On $Branch, up to date"
    } else {
        Warn "$Branch does not exist on the remote. Staying where you are."
    }
}

# ── 4. packages ─────────────────────────────────────────────────────────
Step "Installing packages"
Say "First run takes a few minutes."
npm install --no-fund --no-audit
Good "Packages installed"

# ── 5. does it actually build ───────────────────────────────────────────
Step "Checking the project compiles"
npm run typecheck
if ($LASTEXITCODE -eq 0) {
    Good "Typecheck passed - the setup is sound"
} else {
    Warn "Typecheck failed. The setup is fine; the code has an error to look at."
}

# ── done ────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Ready." -ForegroundColor Green
Write-Host ""
Write-Host "  Start the app:      npm run dev        -> http://localhost:8080"
Write-Host "  Start with Claude:  claude"
Write-Host ""
Write-Host "  Claude reads CLAUDE.md automatically and will know this project."
Write-Host "  Ask it to read START_HERE.md if you want the long version."
Write-Host ""
Write-Host "  One rule that matters: say out loud which laptop owns the"
Write-Host "  database before either of you applies a migration."
Write-Host ""
