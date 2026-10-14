from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / (sys.argv[1] if len(sys.argv) > 1 else "dist")

errors: list[str] = []

index = DIST / "index.html"
hosting = ROOT / "scripts" / "deploy-hosting.py"
monaco = ROOT / "src" / "lib" / "monaco.ts"
vite = ROOT / "vite.config.ts"

if not index.is_file():
    errors.append(f"missing production build: {index}")
else:
    html = index.read_text(encoding="utf-8", errors="replace").lower()

    forbidden = (
        "cdn.jsdelivr.net",
        "cdnjs.cloudflare.com",
        "unpkg.com",
    )

    for host in forbidden:
        if host in html and "monaco" in html:
            errors.append(
                f"production index directly references Monaco through {host}"
            )

if hosting.is_file():
    config = hosting.read_text(encoding="utf-8", errors="replace")

    required_csp = (
        "script-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'self'",
        "frame-src 'self' blob: https://www.youtube.com https://www.youtube-nocookie.com",
    )

    for directive in required_csp:
        if directive not in config:
            errors.append(
                f"hosting CSP missing required directive: {directive}"
            )
else:
    errors.append("scripts/deploy-hosting.py missing")

if monaco.is_file():
    source = monaco.read_text(encoding="utf-8", errors="replace")

    if 'from "monaco-editor"' not in source:
        errors.append("local Monaco npm import missing")

    if "loader.config({ monaco })" not in source:
        errors.append("local Monaco loader configuration missing")
else:
    errors.append("src/lib/monaco.ts missing")

if vite.is_file():
    source = vite.read_text(encoding="utf-8", errors="replace")

    if "sourcemap: mode === 'development'" not in source:
        errors.append(
            "production sourcemap policy changed; review vite.config.ts"
        )

map_files = list(DIST.rglob("*.map")) if DIST.exists() else []

if map_files:
    sample = ", ".join(str(p.relative_to(ROOT)) for p in map_files[:5])
    errors.append(
        f"production build contains source maps: {sample}"
    )

worker_names = (
    "json.worker",
    "html.worker",
    "css.worker",
    "ts.worker",
)

assets = DIST / "assets"

if assets.is_dir():
    names = [p.name for p in assets.iterdir() if p.is_file()]

    for worker in worker_names:
        if not any(worker in name for name in names):
            errors.append(
                f"local Monaco worker missing from build: {worker}"
            )

if errors:
    print("BROWSER SECURITY GATE: FAIL")
    for error in errors:
        print(f" - {error}")
    raise SystemExit(1)

print("BROWSER SECURITY GATE: PASS")
print(" - local Monaco configuration present")
print(" - required CSP directives present")
print(" - production sourcemaps absent")
print(" - local Monaco workers present")
print(" - no direct Monaco CDN dependency in index.html")
