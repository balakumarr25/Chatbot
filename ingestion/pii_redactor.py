"""
PII Redaction using Microsoft Presidio.
Falls back to regex-based redaction if Presidio is unavailable.
"""
import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Try to load Presidio; fall back gracefully
try:
    from presidio_analyzer import AnalyzerEngine
    from presidio_anonymizer import AnonymizerEngine
    from presidio_anonymizer.entities import OperatorConfig

    _analyzer = AnalyzerEngine()
    _anonymizer = AnonymizerEngine()
    PRESIDIO_AVAILABLE = True
    logger.info("Presidio PII redaction engine loaded")
except Exception as e:
    PRESIDIO_AVAILABLE = False
    logger.warning(f"Presidio not available ({e}), using regex fallback")


# Regex fallback patterns
_REGEX_PATTERNS = [
    (re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"), "[EMAIL]"),
    (re.compile(r"\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b"), "[PHONE]"),
    (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[SSN]"),
    (re.compile(r"\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b"), "[CREDIT_CARD]"),
    (re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"), "[IP_ADDRESS]"),
]

DEFAULT_ENTITIES = [
    "PERSON", "EMAIL_ADDRESS", "PHONE_NUMBER", "CREDIT_CARD",
    "US_SSN", "IP_ADDRESS", "LOCATION",
]


def redact_text(text: str, entities: Optional[list[str]] = None) -> tuple[str, bool]:
    """
    Redact PII from text.
    Returns (redacted_text, was_redacted).
    """
    if not text:
        return text, False

    if PRESIDIO_AVAILABLE:
        return _presidio_redact(text, entities or DEFAULT_ENTITIES)
    else:
        return _regex_redact(text)


def _presidio_redact(text: str, entities: list[str]) -> tuple[str, bool]:
    try:
        results = _analyzer.analyze(text=text, entities=entities, language="en")
        if not results:
            return text, False

        operators = {entity: OperatorConfig("replace", {"new_value": f"[{entity}]"}) for entity in entities}
        anonymized = _anonymizer.anonymize(text=text, analyzer_results=results, operators=operators)
        redacted = anonymized.text
        return redacted, redacted != text
    except Exception as e:
        logger.error(f"Presidio redaction failed: {e}")
        return _regex_redact(text)


def _regex_redact(text: str) -> tuple[str, bool]:
    redacted = text
    for pattern, replacement in _REGEX_PATTERNS:
        redacted = pattern.sub(replacement, redacted)
    return redacted, redacted != text


def truncate_preview(text: str, max_length: int = 200) -> str:
    """Truncate text to max_length for preview storage."""
    if not text:
        return ""
    if len(text) <= max_length:
        return text
    return text[:max_length] + "…"
