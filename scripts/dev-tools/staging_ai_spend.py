"""STAGING ONLY. AI spend since a UTC time, from llm_usage tokens x DeepSeek list price (estimate).

    python scripts/dev-tools/staging_ai_spend.py 2026-10-06T00:26:08Z
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402

IN_RS_PER_M, OUT_RS_PER_M = 23.0, 92.0   # deepseek-chat: about $0.27 / $1.10 per million tokens at ~Rs 84/$
since = sys.argv[1]
rows = st.call("svc", "GET", f"llm_usage?select=feature,prompt_tokens,completion_tokens,provider&created_at=gte.{since}&limit=10000")[1]
by = {}
for r in rows:
    f = by.setdefault(r["feature"], [0, 0, 0])
    f[0] += 1; f[1] += r["prompt_tokens"] or 0; f[2] += r["completion_tokens"] or 0
total = 0.0
for k, (n, i, o) in sorted(by.items()):
    rs = i / 1e6 * IN_RS_PER_M + o / 1e6 * OUT_RS_PER_M
    total += rs
    print(f"{k:24} calls={n:4} in={i:8} out={o:7} ~Rs {rs:.2f}")
print(f"TOTAL calls={len(rows)} ~Rs {total:.2f}")
