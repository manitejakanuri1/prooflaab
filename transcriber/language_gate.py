"""The English-only gate for spoken explanations. Pure logic, no model import, so it is testable.

The rule the product wants: explanations are in English, and an Indian English accent is
fully valid. This gate therefore judges the LANGUAGE the model hears, never the accent, and
it is deliberately lenient:

  * the model says English                     -> accept
  * the model is confident it is another language AND gives English almost no chance
                                               -> reject (ask the student to record in English)
  * anything in between, or very little speech -> accept (an uncertain call must never fail
                                                  an Indian English speaker)

Forcing the transcription to English and hoping is not a check: it turns Telugu or Hindi
speech into English-looking nonsense. So the language is detected first, and only then is
the recording transcribed as English.
"""
import os

# Reject only when the other language is at least this likely...
REJECT_PROBABILITY = float(os.environ.get("LANG_REJECT_PROBABILITY", "0.80"))
# ...and English is at most this likely.
ENGLISH_FLOOR = float(os.environ.get("LANG_ENGLISH_FLOOR", "0.10"))
# Below this much detected speech the detector is guessing; let the transcript decide.
MIN_SPEECH_SECONDS = float(os.environ.get("LANG_MIN_SPEECH_SECONDS", "3"))


def decide(language, probability, english_probability, speech_seconds):
    """Returns 'english', 'uncertain' (accepted) or 'non_english' (rejected)."""
    if language == "en":
        return "english"
    if speech_seconds is not None and speech_seconds < MIN_SPEECH_SECONDS:
        return "uncertain"
    if probability is None or english_probability is None:
        return "uncertain"
    if probability >= REJECT_PROBABILITY and english_probability <= ENGLISH_FLOOR:
        return "non_english"
    return "uncertain"


def meta(language, probability, english_probability, speech_seconds, model, config):
    """What is stored with the recording so the decision can be audited later."""
    return {
        "language": language,
        "language_probability": None if probability is None else round(float(probability), 4),
        "english_probability": None if english_probability is None else round(float(english_probability), 4),
        "speech_seconds": None if speech_seconds is None else round(float(speech_seconds), 2),
        "gate": decide(language, probability, english_probability, speech_seconds),
        "gate_rule": {"reject_probability": REJECT_PROBABILITY, "english_floor": ENGLISH_FLOOR,
                      "min_speech_seconds": MIN_SPEECH_SECONDS},
        "model": model,
        "config": config,
    }
