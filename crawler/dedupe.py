"""Pure content-hashing and near-duplicate helpers. No network, no DB.

Per Master Spec Section 07: exact hash for identical content, SimHash +
Hamming distance for near-duplicates (paraphrased/mirrored pages).
"""
import hashlib
import re
from urllib.parse import urlsplit, urlunsplit

_WORD = re.compile(r"[a-z0-9]+")


def content_hash(markdown: str) -> str:
    return hashlib.sha256(markdown.strip().encode("utf-8")).hexdigest()


def compute_simhash(markdown: str, bits: int = 64) -> int:
    """64-bit SimHash over word tokens, returned as a signed bigint
    (source_content.simhash is Postgres `bigint`, which is signed 64-bit —
    an unsigned hash over 2^63 overflows it with "bigint out of range").
    ponytail: hashlib-based feature hashing, no simhash pip package for
    one small function."""
    v = [0] * bits
    words = _WORD.findall(markdown.lower())
    if not words:
        return 0
    for w in words:
        h = int.from_bytes(hashlib.md5(w.encode("utf-8")).digest()[:8], "big")
        for i in range(bits):
            v[i] += 1 if (h >> i) & 1 else -1
    out = 0
    for i in range(bits):
        if v[i] > 0:
            out |= 1 << i
    if out >= 2 ** (bits - 1):
        out -= 2 ** bits
    return out


def hamming_distance(a: int, b: int, bits: int = 64) -> int:
    mask = (1 << bits) - 1
    return bin((a ^ b) & mask).count("1")


def is_near_duplicate(a: int, b: int, threshold: int = 6) -> bool:
    return hamming_distance(a, b) <= threshold


def canonicalize_url(url: str) -> str:
    """Strip query/fragment/trailing slash so the same page under a
    tracking param isn't stored twice."""
    parts = urlsplit(url)
    path = parts.path.rstrip("/") or "/"
    return urlunsplit((parts.scheme, parts.netloc.lower(), path, "", ""))


def demo() -> None:
    # Realistic case: same article mirrored on two domains, or re-fetched
    # after a minor CMS edit. SimHash is for catching THIS (near-identical
    # long-form text), not semantic paraphrase-detection.
    base = (
        "Two Sum: given an array of integers and a target, return the "
        "indices of the two numbers that add up to the target. The "
        "brute-force approach checks every pair in O(n^2) time. A hash "
        "map lets you check for the complement of each number as you "
        "scan once, giving O(n) time and O(n) space. Insert each number "
        "into the map after checking, so you never match an element "
        "with itself. This is one of the most common interview "
        "warm-up questions."
    )
    a = base
    b = base.replace("Two Sum:", "Two Sum -").replace("O(n^2)", "O(n squared)")
    c = (
        "Flexbox centers a div by setting display: flex on the parent, "
        "then justify-content: center for the horizontal axis and "
        "align-items: center for the vertical axis. Grid is an "
        "alternative: place-items: center on the parent does both in "
        "one line. Neither approach needs a fixed height on the child."
    )

    assert content_hash(a) == content_hash(a)
    assert content_hash(a) != content_hash(b)

    sa, sb, sc = compute_simhash(a), compute_simhash(b), compute_simhash(c)
    assert is_near_duplicate(sa, sb), "near-identical mirror should read as near-duplicate"
    assert not is_near_duplicate(sa, sc), "unrelated content should not"

    assert canonicalize_url("https://Example.com/Path/?utm=1#frag") == "https://example.com/Path"
    assert canonicalize_url("https://example.com/path/") == canonicalize_url("https://example.com/path")

    print("dedupe self-check OK")


if __name__ == "__main__":
    demo()
