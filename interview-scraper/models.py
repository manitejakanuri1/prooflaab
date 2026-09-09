"""Unified shape every scraper outputs, regardless of source site."""
from typing import List, Optional

from pydantic import BaseModel


class InterviewQuestion(BaseModel):
    company: str
    role: Optional[str] = None
    round: Optional[str] = None
    question: str
    # topics/difficulty need real NLP or an LLM pass to fill honestly.
    # Left empty/None rather than guessed — a wrong topic tag is worse
    # than no topic tag.
    topics: List[str] = []
    difficulty: Optional[str] = None
    source_site: str
    url: str
    year: Optional[int] = None
