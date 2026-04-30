import logging

from langchain.chat_models import BaseChatModel

from src.config import get_app_config, get_tracing_config, is_tracing_enabled
from src.models.relay_compatible_chat_model import RelayCompatibleChatModel
from src.models.relay_http import relay_requires_sdk_header_strip
from src.reflection import resolve_class

logger = logging.getLogger(__name__)

def create_chat_model(name: str | None = None, thinking_enabled: bool = False, **kwargs) -> BaseChatModel:
    """Create a chat model instance from the config.

    Args:
        name: The name of the model to create. If None, the first model in the config will be used.

    Returns:
        A chat model instance.
    """
    config = get_app_config()
    if name is None:
        name = config.models[0].name
    model_config = config.get_model_config(name)
    if model_config is None:
        raise ValueError(f"Model {name} not found in config") from None
    model_class = resolve_class(model_config.use, BaseChatModel)
    provider_thinking_mode = model_config.provider_thinking_mode
    thinking_requested = thinking_enabled and provider_thinking_mode == "native"
    model_settings_from_config = model_config.model_dump(
        exclude_none=True,
        exclude={
            "use",
            "name",
            "display_name",
            "description",
            "supports_thinking",
            "supports_plan_mode",
            "supports_subagents",
            "preferred_subagent_model",
            "preferred_bash_subagent_model",
            "ultra_uses_plan_mode",
            "when_thinking_enabled",
            "supports_vision",
            "supports_workflow_modes",
            "provider_thinking_mode",
        },
    )
    if thinking_requested and model_config.when_thinking_enabled is not None:
        if not model_config.supports_thinking:
            raise ValueError(f"Model {name} does not support thinking. Set `supports_thinking` to true in the `config.yaml` to enable thinking.") from None
        model_settings_from_config.update(model_config.when_thinking_enabled)

    base_url = model_settings_from_config.get("base_url")
    if model_config.use == "langchain_openai:ChatOpenAI" and relay_requires_sdk_header_strip(base_url):
        model_class = RelayCompatibleChatModel
        logger.info(
            "Using relay-compatible chat wrapper for model '%s' via base_url=%s",
            name,
            base_url,
        )

    model_instance = model_class(**kwargs, **model_settings_from_config)

    if is_tracing_enabled():
        try:
            from langchain_core.tracers.langchain import LangChainTracer

            tracing_config = get_tracing_config()
            tracer = LangChainTracer(
                project_name=tracing_config.project,
            )
            existing_callbacks = model_instance.callbacks or []
            model_instance.callbacks = [*existing_callbacks, tracer]
            logger.debug(
                f"LangSmith tracing attached to model '{name}' (project='{tracing_config.project}')"
            )
        except Exception as e:
            logger.warning(f"Failed to attach LangSmith tracing to model '{name}': {e}")
    return model_instance
