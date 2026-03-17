"""Shared LLM client using LiteLLM for multi-provider support.

Supports: OpenAI, Bedrock, Anthropic, Ollama, OpenRouter, and any LiteLLM-supported provider.

Model name format determines the provider:
  - bedrock/anthropic.claude-haiku-4-5-20251001
  - anthropic/claude-haiku-4-5-20251001
  - openai/gpt-4o-mini
  - ollama/llama3
  - gpt-4o-mini  (defaults to OpenAI)

For Bedrock: set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION_NAME env vars.
For Anthropic: set ANTHROPIC_API_KEY env var.
For OpenAI: set OPENAI_API_KEY env var (or LLM_API_KEY).
For Ollama: no key needed, just set model to ollama/<model>.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

# Load simulation/.env first, then project root .env (won't override existing)
load_dotenv(Path(__file__).parent.parent / ".env")
load_dotenv(Path(__file__).parent.parent.parent / ".env")

# Normalize AWS_REGION → AWS_REGION_NAME (LiteLLM expects AWS_REGION_NAME)
if os.getenv("AWS_REGION") and not os.getenv("AWS_REGION_NAME"):
    os.environ["AWS_REGION_NAME"] = os.environ["AWS_REGION"]


def get_model() -> str:
    """Get the configured model name."""
    return os.getenv("LLM_MODEL_NAME", os.getenv("OPENAI_MODEL", "gpt-4o-mini"))


def completion(messages: list[dict], temperature: float = 0.7,
               response_format: dict | None = None) -> str:
    """Call LLM and return the response text.

    Uses LiteLLM which auto-routes based on model name prefix.
    """
    import litellm

    model = get_model()
    base_url = os.getenv("LLM_BASE_URL", os.getenv("OPENAI_BASE_URL"))
    api_key = os.getenv("LLM_API_KEY") or os.getenv("OPENROUTER_API_KEY") or os.getenv("OPENAI_API_KEY")

    # Auto-detect OpenRouter from key if no base URL set
    if os.getenv("OPENROUTER_API_KEY") and not base_url:
        base_url = "https://openrouter.ai/api/v1"

    # If routing through OpenRouter or any custom base_url, use openai/ prefix
    # so litellm treats it as OpenAI-compatible instead of native Anthropic
    is_custom_proxy = base_url and "openrouter" in base_url
    is_bedrock = model.startswith("bedrock/")

    if is_custom_proxy:
        # OpenRouter is OpenAI-compatible — force openai provider
        litellm_model = f"openai/{model}" if not model.startswith("openai/") else model
    else:
        litellm_model = model

    kwargs: dict = {
        "model": litellm_model,
        "messages": messages,
        "temperature": temperature,
    }

    # Bedrock uses AWS env vars directly, no api_key/base_url needed
    if not is_bedrock:
        if api_key:
            kwargs["api_key"] = api_key
        if base_url:
            kwargs["api_base"] = base_url

    if response_format:
        kwargs["response_format"] = response_format

    response = litellm.completion(**kwargs)
    return response.choices[0].message.content


def get_camel_model():
    """Create a camel-ai ModelFactory model for OASIS agent calls.

    Routes through LiteLLM for Bedrock/Anthropic support.
    """
    from camel.models import ModelFactory
    from camel.types import ModelPlatformType

    model_name = get_model()

    # For Bedrock/Anthropic, use LiteLLM platform in camel
    if model_name.startswith("bedrock/") or model_name.startswith("anthropic/"):
        return ModelFactory.create(
            model_platform=ModelPlatformType.LITELLM,
            model_type=model_name,
        )

    # For OpenAI-compatible (OpenAI, Ollama, OpenRouter, etc.)
    api_key = os.getenv("LLM_API_KEY") or os.getenv("OPENROUTER_API_KEY") or os.getenv("OPENAI_API_KEY") or "ollama"
    base_url = os.getenv("LLM_BASE_URL") or os.getenv("OPENAI_BASE_URL")
    if os.getenv("OPENROUTER_API_KEY") and not os.getenv("LLM_BASE_URL"):
        base_url = "https://openrouter.ai/api/v1"
    base_url = base_url or "http://localhost:11434/v1"

    return ModelFactory.create(
        model_platform=ModelPlatformType.DEFAULT,
        model_type=model_name.removeprefix("openai/"),
        url=base_url,
        api_key=api_key,
    )
