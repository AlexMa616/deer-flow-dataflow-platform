"""Tests for extension config resolution and MCP tool interceptors."""

from __future__ import annotations

from typing import Any

from langchain_core.tools import BaseTool

from src.config.extensions_config import ExtensionsConfig, McpToolInterceptorConfig
from src.mcp.tools import apply_mcp_tool_interceptors


class FakeTool(BaseTool):
    name: str
    description: str
    metadata: dict[str, Any] | None = None

    def _run(self, *args: Any, **kwargs: Any) -> str:
        return "ok"


def test_resolve_env_variables_recurses_lists_tuples_and_missing(monkeypatch):
    monkeypatch.setenv("TOKEN", "secret")
    config = {
        "env": {
            "TOKEN": "$TOKEN",
            "MISSING": "$MISSING_TOKEN",
            "NESTED": ["$TOKEN", {"value": "$TOKEN"}, ("$TOKEN", "$MISSING_TOKEN")],
        }
    }

    resolved = ExtensionsConfig.resolve_env_variables(config)

    assert resolved["env"]["TOKEN"] == "secret"
    assert resolved["env"]["MISSING"] == ""
    assert resolved["env"]["NESTED"][0] == "secret"
    assert resolved["env"]["NESTED"][1]["value"] == "secret"
    assert resolved["env"]["NESTED"][2] == ("secret", "")


def test_mcp_tool_interceptors_deny_and_decorate_tools():
    tools = [
        FakeTool(name="github_search", description="Search repos", metadata={"server": "github"}),
        FakeTool(name="danger_delete", description="Delete data", metadata={"server": "github"}),
    ]
    config = ExtensionsConfig(
        tool_interceptors=[
            McpToolInterceptorConfig(action="deny", tool="danger*"),
            McpToolInterceptorConfig(
                action="decorate",
                server="github",
                tool="github_*",
                descriptionPrefix="Use only for repository research.",
                tags=["research"],
                metadata={"reviewed": True},
            ),
        ]
    )

    intercepted = apply_mcp_tool_interceptors(tools, config)

    assert [tool.name for tool in intercepted] == ["github_search"]
    assert intercepted[0].description.startswith("Use only for repository research.")
    assert intercepted[0].metadata["reviewed"] is True
    assert "research" in intercepted[0].tags
