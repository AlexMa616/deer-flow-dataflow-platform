from pydantic import BaseModel, ConfigDict, Field


class ModelConfig(BaseModel):
    """Config section for a model"""

    name: str = Field(..., description="Unique name for the model")
    display_name: str | None = Field(..., default_factory=lambda: None, description="Display name for the model")
    description: str | None = Field(..., default_factory=lambda: None, description="Description for the model")
    use: str = Field(
        ...,
        description="Class path of the model provider(e.g. langchain_openai.ChatOpenAI)",
    )
    model: str = Field(..., description="Model name")
    model_config = ConfigDict(extra="allow")
    supports_thinking: bool = Field(default_factory=lambda: False, description="Whether the model supports thinking")
    supports_plan_mode: bool = Field(
        default_factory=lambda: True,
        description="Whether the model supports heavier plan-mode orchestration",
    )
    supports_subagents: bool = Field(
        default_factory=lambda: True,
        description="Whether the model supports delegated subagent workflows",
    )
    preferred_subagent_model: str | None = Field(
        default_factory=lambda: None,
        description="Preferred model to use for delegated subagents spawned by this parent model",
    )
    preferred_bash_subagent_model: str | None = Field(
        default_factory=lambda: None,
        description="Preferred model to use for bash subagents spawned by this parent model",
    )
    ultra_uses_plan_mode: bool = Field(
        default_factory=lambda: True,
        description="Whether Ultra mode should also enable the heavier todo/plan middleware for this model",
    )
    when_thinking_enabled: dict | None = Field(
        default_factory=lambda: None,
        description="Extra settings to be passed to the model when thinking is enabled",
    )
    supports_vision: bool = Field(default_factory=lambda: False, description="Whether the model supports vision/image inputs")
