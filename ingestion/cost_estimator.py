"""
Token cost estimation per provider/model.
Prices in USD per 1K tokens (input, output).
Updated: 2025
"""
from decimal import Decimal
from typing import Optional

# (input_per_1k, output_per_1k) in USD
PRICING: dict[str, dict[str, tuple[float, float]]] = {
    "openai": {
        "gpt-4.1":              (0.002,   0.008),
        "gpt-4.1-mini":         (0.0004,  0.0016),
        "gpt-4o":               (0.005,   0.015),
        "gpt-4o-mini":          (0.00015, 0.0006),
        "gpt-4-turbo":          (0.01,    0.03),
        "gpt-3.5-turbo":        (0.0005,  0.0015),
        "o1":                   (0.015,   0.06),
        "o1-mini":              (0.003,   0.012),
    },
    "anthropic": {
        "claude-sonnet-4-5":    (0.003,   0.015),
        "claude-3-5-sonnet-20241022": (0.003, 0.015),
        "claude-3-5-haiku-20241022":  (0.0008, 0.004),
        "claude-3-opus-20240229":     (0.015,  0.075),
        "claude-3-haiku-20240307":    (0.00025, 0.00125),
    },
    "google": {
        "gemini-1.5-pro":       (0.00125, 0.005),
        "gemini-1.5-flash":     (0.000075, 0.0003),
        "gemini-2.0-flash":     (0.0001,  0.0004),
        "gemini-pro":           (0.0005,  0.0015),
    },
    "deepseek": {
        "deepseek-chat":        (0.00014, 0.00028),
        "deepseek-reasoner":    (0.00055, 0.00219),
    },
    "xai": {
        "grok-2":               (0.002,   0.01),
        "grok-2-mini":          (0.0002,  0.001),
        "grok-beta":            (0.005,   0.015),
    },
}


def estimate_cost(
    provider: str,
    model: str,
    prompt_tokens: Optional[int],
    completion_tokens: Optional[int],
) -> Optional[Decimal]:
    """Return estimated cost in USD, or None if pricing unknown."""
    if prompt_tokens is None and completion_tokens is None:
        return None

    provider_pricing = PRICING.get(provider.lower(), {})
    # Try exact match, then prefix match
    model_pricing = provider_pricing.get(model)
    if model_pricing is None:
        for key, val in provider_pricing.items():
            if model.startswith(key) or key.startswith(model):
                model_pricing = val
                break

    if model_pricing is None:
        return None

    input_rate, output_rate = model_pricing
    cost = Decimal(0)
    if prompt_tokens:
        cost += Decimal(str(input_rate)) * Decimal(prompt_tokens) / 1000
    if completion_tokens:
        cost += Decimal(str(output_rate)) * Decimal(completion_tokens) / 1000

    return cost
