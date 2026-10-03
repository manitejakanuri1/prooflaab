"""Tests for the English-only gate. Run: python transcriber/test_language_gate.py
These test the DECISION RULE with model outputs as inputs. They do not measure how well the
model hears Indian English - that needs real recordings (docs: Whisper benchmark)."""
from language_gate import decide, meta

# English is accepted whatever the confidence - an accent lowers confidence, never validity.
assert decide("en", 0.99, 0.99, 40) == "english"
assert decide("en", 0.41, 0.41, 40) == "english"

# Clearly another language: rejected.
assert decide("te", 0.97, 0.01, 40) == "non_english"
assert decide("hi", 0.85, 0.05, 30) == "non_english"

# The lenient middle: accepted.
assert decide("te", 0.60, 0.30, 40) == "uncertain"      # code-switching / unsure
assert decide("hi", 0.79, 0.02, 40) == "uncertain"      # not confident enough
assert decide("te", 0.90, 0.11, 40) == "uncertain"      # English still plausible
assert decide("cy", 0.95, 0.01, 1.5) == "uncertain"     # two seconds of speech: the detector is guessing
assert decide("ta", None, None, 40) == "uncertain"      # no probabilities reported
assert decide(None, None, None, 0) == "uncertain"       # silence: the transcript check handles it

m = meta("te", 0.971234, 0.0123, 41.26, "base", {"compute_type": "int8"})
assert m["gate"] == "non_english" and m["language"] == "te" and m["language_probability"] == 0.9712
assert m["model"] == "base" and m["gate_rule"]["reject_probability"] == 0.80
print("language_gate: all checks passed")
