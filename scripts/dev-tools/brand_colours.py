"""Swap hard-coded Tailwind colours for the brand tokens in the given .tsx files.

Owner decision 25 Oct 2026: student screens use the brand kit only. Families map to
the brand roles: blue = primary, orange/amber/yellow/purple = compete (attention),
green = verified (done), red = alert, gray = muted. The tokens already switch for
light and dark, so dark: colour variants are dropped. Look only, never wording.

  python scripts/dev-tools/brand_colours.py FILE...
"""
import re, sys

ROLE = {**dict.fromkeys(["blue", "sky", "indigo"], "primary"),
        **dict.fromkeys(["orange", "amber", "yellow", "purple", "violet"], "compete"),
        **dict.fromkeys(["green", "emerald", "teal"], "verified"),
        **dict.fromkeys(["red", "rose"], "alert")}
FAM = "|".join(list(ROLE) + ["gray", "slate", "zinc"])
TOK = re.compile(rf"(?<![\w:-])((?:hover:|focus:|group-hover:)?)(dark:)?(bg|text|border|ring|from|to|via|fill|stroke)-({FAM})-(\d+)(?:/(\d+))?(?![\w-])")

def swap(m):
    state, dark, kind, fam, shade, alpha = m.groups()
    if dark:
        return "\0"  # tokens already follow the theme
    shade = int(shade)
    if fam in ("gray", "slate", "zinc"):
        if kind == "text":
            return state + ("text-foreground" if shade >= 800 else "text-muted-foreground")
        if kind in ("border", "ring"):
            return state + f"{kind}-border"
        if kind == "bg":
            return state + ("bg-muted" if shade <= 200 else "bg-muted-foreground" if alpha is None else f"bg-muted-foreground/{alpha}")
        return state + f"{kind}-muted"
    t = ROLE[fam]
    if kind in ("text", "fill", "stroke"):
        return state + f"{kind}-{t}"
    if kind in ("border", "ring"):
        return state + f"{kind}-{t}" + (f"/{alpha}" if alpha else "/40" if shade <= 300 else "")
    if kind == "bg":
        if alpha:
            return state + f"bg-{t}/{alpha}"
        return state + (f"bg-{t}/10" if shade <= 100 else f"bg-{t}/20" if shade <= 300 else f"bg-{t}")
    return state + f"{kind}-{t}" + (f"/{alpha}" if alpha else "/10" if shade <= 100 else "")

def run(path):
    s = open(path, encoding="utf-8").read()
    out = TOK.sub(swap, s)
    out = re.sub(r" \0|\0 ?", "", out)  # a dropped dark: variant takes one space with it
    # a token fill keeps readable text: text-white becomes the brand's dark ink
    out = re.sub(r"\b(bg-(?:primary|verified|alert|compete))((?:\s+hover:bg-\S+)?)\s+text-white\b", r"\1\2 text-primary-foreground", out)
    out = re.sub(r"\btext-white(\s+hover:bg-(?:primary|verified|alert|compete)\S*)", r"text-primary-foreground\1", out)
    if out != s:
        open(path, "w", encoding="utf-8", newline="").write(out)
    return len(TOK.findall(s))


if __name__ == "__main__":
    for p in sys.argv[1:]:
        print(p, run(p))
