"""Static inventory of interactive controls in the dashboards. Reads only.

Usage: python inventory.py <repo> <out.tsv>
Columns: file, line, kind, label, wiring, verdict
"""
import os
import re
import sys

repo, out = sys.argv[1], sys.argv[2]
ROOTS = ["src/pages", "src/components"]
TAG = re.compile(r"<(Button|button|Link|NavLink|a|Switch|Checkbox|form|input|audio|video|DropdownMenuItem|SidebarMenuButton|TabsTrigger|Select|Textarea|Input)\b")
TRIGGERS = ("DialogTrigger", "PopoverTrigger", "DropdownMenuTrigger", "AlertDialogTrigger", "TooltipTrigger",
            "SheetTrigger", "CollapsibleTrigger", "AlertDialogAction", "AlertDialogCancel", "DialogClose", "SidebarTrigger")
rows = []


def element(text, start):
    """The opening tag starting at `start`, honouring braces and quotes."""
    depth, quote, i = 0, None, start
    while i < len(text):
        c = text[i]
        if quote:
            if c == quote:
                quote = None
        elif c in "\"'`":
            quote = c
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        elif c == ">" and depth == 0 and text[i - 1] != "=":
            return text[start:i + 1]
        i += 1
    return text[start:start + 400]


def label_after(text, end, tag):
    close = text.find(f"</{tag}>", end)
    inner = text[end:close if 0 <= close - end < 600 else end + 200]
    inner = re.sub(r"<[^>]*>", " ", inner)
    inner = re.sub(r"\s+", " ", inner).strip()
    return inner[:70]


for root in ROOTS:
    for folder, _, files in os.walk(os.path.join(repo, root)):
        if os.sep + "ui" in folder:
            continue
        for name in files:
            if not name.endswith(".tsx") or ".test." in name:
                continue
            path = os.path.join(folder, name)
            text = open(path, encoding="utf-8").read()
            rel = os.path.relpath(path, repo).replace(os.sep, "/")
            for m in TAG.finditer(text):
                tag = m.group(1)
                el = element(text, m.start())
                line = text.count("\n", 0, m.start()) + 1
                before = text[max(0, m.start() - 160):m.start()]
                wiring = []
                for key in ("onClick", "onSubmit", "onCheckedChange", "onChange", "onValueChange", "onSelect", "href", "to=",
                            "asChild", 'type="submit"', "disabled", "src=", "onPress"):
                    if key in el:
                        wiring.append('submit' if 'submit' in key else key.strip('="'))
                in_trigger = any(t in before.split("\n")[-2:][0] + before.split("\n")[-1] for t in TRIGGERS) or \
                    any(f"<{t}" in before[-120:] for t in TRIGGERS)
                verdict = "wired"
                if tag in ("Button", "button", "DropdownMenuItem", "SidebarMenuButton"):
                    live = any(k in wiring for k in ("onClick", "asChild", "submit", "onSelect")) or in_trigger
                    if not live:
                        verdict = "CHECK-no-handler"
                    if "disabled" in wiring and re.search(r"\bdisabled(\s|/|>)", el) and "disabled=" not in el:
                        verdict = "CHECK-always-disabled"
                elif tag == "a" and ("href" not in wiring or 'href="#"' in el):
                    verdict = "CHECK-no-target"
                elif tag in ("Switch", "Checkbox") and "onCheckedChange" not in wiring and "onChange" not in wiring:
                    verdict = "CHECK-no-handler"
                elif tag in ("Input", "Textarea", "Select", "input", "TabsTrigger", "form", "Link", "NavLink", "audio", "video"):
                    if tag in ("Input", "Textarea", "input") and 'type="file"' not in el:
                        continue  # plain text fields are not listed one by one
                rows.append((rel, line, tag, label_after(text, m.start() + len(el), tag), ",".join(wiring) or "-", verdict))

with open(out, "w", encoding="utf-8", newline="\n") as f:
    f.write("file\tline\tkind\tlabel\twiring\tverdict\n")
    for r in rows:
        f.write("\t".join(str(x) for x in r) + "\n")

flagged = [r for r in rows if r[5] != "wired"]
print("controls:", len(rows), "| flagged:", len(flagged))
for r in flagged:
    print(f"{r[0]}:{r[1]}\t{r[2]}\t{r[5]}\t{r[3]}")
