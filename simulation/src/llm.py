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

load_dotenv(Path(__file__).parent.parent / ".env")


def get_model() -> str:
    """Get the configured model name."""
    return os.getenv("LLM_MODEL_NAME", os.getenv("OPENAI_MODEL", "gpt-4o-mini"))


def completion(messages: list[dict], temperature: float = 0.7,
               response_format: dict | None = None) -> str:
    """Call LLM and return the response text.

    Uses LiteLLM which auto-routes based on model name prefix.
    """
    import litellm

    # Map our env vars to what litellm/providers expect
    api_key = os.getenv("LLM_API_KEY", os.getenv("OPENAI_API_KEY"))
    base_url = os.getenv("LLM_BASE_URL", os.getenv("OPENAI_BASE_URL"))
    model = get_model()

    kwargs: dict = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
    }

    # Only pass api_key/base_url for OpenAI-compatible providers
    # Bedrock and Anthropic use their own env vars (AWS_*, ANTHROPIC_API_KEY)
    is_bedrock = model.startswith("bedrock/")
    is_anthropic = model.startswith("anthropic/")

    if not is_bedrock and not is_anthropic:
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
    return ModelFactory.create(
        model_platform=ModelPlatformType.DEFAULT,
        model_type=model_name.removeprefix("openai/"),
        url=os.getenv("LLM_BASE_URL", os.getenv("OPENAI_BASE_URL", "http://localhost:11434/v1")),
        api_key=os.getenv("LLM_API_KEY", os.getenv("OPENAI_API_KEY", "ollama")),
    )
