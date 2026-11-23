"""agentos.ai — HTTP client for builtin `ai` (ticket 24 / 85)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from agentos.http import EnvMap, get_json, post_json, resolve_ext_api_base


def resolve_ai_api_base(env: EnvMap | None = None) -> str:
    """Resolve builtin ai API base (`…/api/ext/ai` or test override)."""
    return resolve_ext_api_base("ai", "AGENT_OS_AI_API_BASE", env)


class AiFileInput(BaseModel):
    """File/image input: files-builtin key or inline base64."""

    mediaType: str
    key: str | None = None
    base64: str | None = None


class GenerateTextInput(BaseModel):
    prompt: str | None = None
    message: str | None = None
    text: str | None = None
    temperature: float | None = None
    maxTokens: int | None = None
    schema_: dict[str, Any] | None = Field(default=None, alias="schema")
    files: list[AiFileInput] | None = None

    model_config = {"populate_by_name": True}


class GenerateTextResult(BaseModel):
    text: str | None = None
    object: Any | None = None


class GenerateImageResult(BaseModel):
    stub: bool
    mediaType: str
    base64: str | None = None


class EmbedInput(BaseModel):
    value: str | None = None
    text: str | None = None


class EmbedResult(BaseModel):
    embedding: list[float]
    stub: bool


class ChatInput(BaseModel):
    prompt: str | None = None
    message: str | None = None
    text: str | None = None
    registry: Any = None


class ChatResult(BaseModel):
    text: str
    toolNames: list[str] | None = None


class AiHealth(BaseModel):
    ok: bool
    mode: str


def _body(model: BaseModel | dict[str, Any]) -> dict[str, Any]:
    if isinstance(model, BaseModel):
        return model.model_dump(exclude_none=True, by_alias=True)
    return model


async def health(env: EnvMap | None = None) -> AiHealth:
    base = resolve_ai_api_base(env)
    data = await get_json(f"{base}/health", "ai health")
    return AiHealth.model_validate(data)


async def generate_text(
    input: GenerateTextInput | dict[str, Any],
    env: EnvMap | None = None,
) -> GenerateTextResult:
    base = resolve_ai_api_base(env)
    data = await post_json(
        f"{base}/generate-text",
        _body(input),
        "ai generate-text",
    )
    return GenerateTextResult.model_validate(data)


async def generate_image(
    input: GenerateTextInput | dict[str, Any],
    env: EnvMap | None = None,
) -> GenerateImageResult:
    base = resolve_ai_api_base(env)
    data = await post_json(
        f"{base}/generate-image",
        _body(input),
        "ai generate-image",
    )
    return GenerateImageResult.model_validate(data)


async def embed(
    input: EmbedInput | dict[str, Any],
    env: EnvMap | None = None,
) -> EmbedResult:
    base = resolve_ai_api_base(env)
    data = await post_json(f"{base}/embed", _body(input), "ai embed")
    return EmbedResult.model_validate(data)


async def chat(
    input: ChatInput | dict[str, Any],
    env: EnvMap | None = None,
) -> ChatResult:
    base = resolve_ai_api_base(env)
    data = await post_json(f"{base}/chat", _body(input), "ai chat")
    return ChatResult.model_validate(data)
