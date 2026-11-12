"""Short credit line per course (owner 12 Nov 2026: one short line, not the full source list) and which
roadmap tracks each course belongs to. Hand-written courses have no credit line (None)."""

# course slug -> (short source, short licence); None = hand-written, no credit line.
CREDIT = {
    "backend-development": ("MDN Web Docs", "CC BY-SA 2.5"),
    "bash": None,
    "blockchain": ("ethereum.org docs", "MIT"),
    "cloud-computing": ("Microsoft Cloud Adoption Framework", "CC BY 4.0"),
    "computer-science": ("Wikibooks", "CC BY-SA 4.0"),
    "cpp": ("Microsoft C++ docs and Wikibooks", "CC BY 4.0 / CC BY-SA 4.0"),
    "cybersecurity": ("OWASP Cheat Sheets", "CC BY-SA 4.0"),
    "data-science": ("Microsoft Data Science for Beginners", "MIT"),
    "deep-learning": ("Dive into Deep Learning", "CC BY-SA 4.0"),
    "devops": ("GitHub Docs", "CC BY 4.0"),
    "django": ("the Django docs", "BSD"),
    "docker": ("the Docker docs", "Apache 2.0"),
    "dsa": ("TheAlgorithms", "MIT"),
    "game-development": ("the Godot docs", "CC BY 3.0"),
    "git": ("GitHub Docs", "CC BY 4.0"),
    "hr-behavioral": None,
    "html-css": None,
    "iot": ("Microsoft IoT for Beginners", "MIT"),
    "java": None,
    "javascript": ("MDN Web Docs", "CC BY-SA 2.5"),
    "kubernetes": ("kubernetes.io", "CC BY 4.0"),
    "linear-algebra": ("Wikibooks: Linear Algebra", "CC BY-SA 4.0"),
    "logical-reasoning": None,
    "machine-learning": ("Microsoft ML for Beginners and scikit-learn", "MIT / BSD"),
    "mobile-development": ("the React Native docs", "CC BY 4.0"),
    "networking": ("CNP3 (Olivier Bonaventure)", "CC BY-SA 3.0"),
    "numpy": ("the NumPy docs", "BSD"),
    "pandas": ("the pandas docs", "BSD"),
    "probability": ("Wikibooks", "CC BY-SA 4.0"),
    "prompt-engineering": ("DAIR.AI and Microsoft", "MIT"),
    "python": ("the Python docs", "PSF"),
    "quant-aptitude": ("Wikibooks: Arithmetic", "CC BY-SA 4.0"),
    "react": ("react.dev", "CC BY 4.0"),
    "rest-apis": ("Microsoft REST API Guidelines", "CC BY 4.0"),
    "robotics": ("the ROS 2 docs", "CC BY 4.0"),
    "sql": ("Wikibooks and the DuckDB docs", "CC BY-SA 4.0 / MIT"),
    "system-design": ("System Design Primer", "CC BY 4.0"),
    "terraform": ("the OpenTofu docs", "MPL 2.0"),
    "typescript": ("the TypeScript Handbook", "CC BY 4.0"),
    "ui-ux-design": ("MDN Web Docs", "CC BY-SA 2.5"),
    "verbal-ability": None,
    # 12 Nov 2026: written for ProofLab with AI (owner approved, write_chapters.py), no outside source.
    "aws": None,
}
SKIP: set[str] = set()  # aws was skipped until its rebuild (12 Nov 2026)

# course slug -> roadmap tracks (levels.track_slug). Same name where it exists.
EXTRA_TRACKS = {
    "backend-development": ["backend", "web-development"],
    "django": ["backend"],
    "typescript": ["javascript", "web-development"],
    "html-css": ["html-css", "web-development"],
    "javascript": ["javascript", "web-development"],
    "react": ["react", "web-development"],
    "bash": ["bash", "linux"],
}


def tracks_for(slug: str, track_slugs: set[str]) -> list[str]:
    if slug in EXTRA_TRACKS:
        return [t for t in EXTRA_TRACKS[slug] if t in track_slugs]
    return [slug] if slug in track_slugs else []


def credit_line(slug: str) -> str | None:
    c = CREDIT.get(slug)
    return f"From {c[0]} · {c[1]} licence" if c else None


if __name__ == "__main__":
    assert credit_line("python") == "From the Python docs · PSF licence"
    assert credit_line("java") is None
    assert tracks_for("typescript", {"javascript", "react"}) == ["javascript"]
    assert tracks_for("sql", {"sql"}) == ["sql"] and tracks_for("django", set()) == []
    print("ok")
