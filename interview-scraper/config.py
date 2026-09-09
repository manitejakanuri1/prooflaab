"""Env-driven settings. No paid services, no proxy required."""
import os

from dotenv import load_dotenv

load_dotenv()

PROXY_URL = os.environ.get("PROXY_URL") or None
MAX_CONCURRENCY = int(os.environ.get("MAX_CONCURRENCY", "3"))
REQUEST_TIMEOUT = float(os.environ.get("REQUEST_TIMEOUT", "15"))
MAX_PAGES_PER_DOMAIN = int(os.environ.get("MAX_PAGES_PER_DOMAIN", "20"))
OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "output")
USER_AGENT = "ProofLabAI-InterviewScraper/1.0 (+https://prooflab.ai)"
