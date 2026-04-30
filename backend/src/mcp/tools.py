"""Load MCP tools using langchain-mcp-adapters."""

import fnmatch
import logging
from copy import copy

from langchain_core.tools import BaseTool

from src.config.extensions_config import ExtensionsConfig, McpToolInterceptorConfig
from src.mcp.client import build_servers_config

logger = logging.getLogger(__name__)


def _candidate_tool_names(tool: BaseTool) -> set[str]:
    """Return likely names that interceptor rules may target."""
    names = {tool.name}
    metadata = getattr(tool, "metadata", None) or {}
    server_name = metadata.get("server") or metadata.get("server_name") or metadata.get("mcp_server")
    original_name = metadata.get("name") or metadata.get("tool_name")
    if server_name:
        names.add(f"{server_name}.{tool.name}")
        names.add(f"{server_name}:{tool.name}")
        names.add(f"{server_name}__{tool.name}")
    if server_name and original_name:
        names.add(f"{server_name}.{original_name}")
        names.add(f"{server_name}:{original_name}")
        names.add(f"{server_name}__{original_name}")
    return names


def _matches_interceptor(tool: BaseTool, interceptor: McpToolInterceptorConfig) -> bool:
    """Check whether a MCP tool matches an interceptor rule."""
    names = _candidate_tool_names(tool)
    metadata = getattr(tool, "metadata", None) or {}
    server_name = str(metadata.get("server") or metadata.get("server_name") or metadata.get("mcp_server") or "")

    if interceptor.server:
        server_matches = fnmatch.fnmatch(server_name, interceptor.server)
        if not server_matches:
            server_matches = any(name.startswith(f"{interceptor.server}.") or name.startswith(f"{interceptor.server}:") or name.startswith(f"{interceptor.server}__") for name in names)
        if not server_matches:
            return False

    return any(fnmatch.fnmatch(name, interceptor.tool) for name in names)


def _decorate_tool(tool: BaseTool, interceptor: McpToolInterceptorConfig) -> BaseTool:
    """Apply a non-destructive metadata/description decoration to a tool."""
    next_tool = copy(tool)
    description = getattr(next_tool, "description", "") or ""
    if interceptor.description_prefix:
        description = f"{interceptor.description_prefix}\n{description}".strip()
    if interceptor.description_suffix:
        description = f"{description}\n{interceptor.description_suffix}".strip()
    if description != getattr(next_tool, "description", ""):
        next_tool.description = description

    metadata = dict(getattr(next_tool, "metadata", None) or {})
    metadata.update(interceptor.metadata)
    metadata.setdefault("mcp_intercepted", True)
    next_tool.metadata = metadata

    if interceptor.tags:
        next_tool.tags = sorted(set([*(getattr(next_tool, "tags", None) or []), *interceptor.tags]))
    return next_tool


def apply_mcp_tool_interceptors(tools: list[BaseTool], extensions_config: ExtensionsConfig) -> list[BaseTool]:
    """Apply declarative MCP tool allow/deny/decorate rules.

    The rule model intentionally works at load time. It gives the workspace a
    safe, inspectable control plane for MCP tools without coupling the agent loop
    to individual MCP server implementations.
    """
    interceptors = [rule for rule in extensions_config.tool_interceptors if rule.enabled]
    if not interceptors:
        return tools

    allow_rules = [rule for rule in interceptors if rule.action == "allow"]
    deny_rules = [rule for rule in interceptors if rule.action == "deny"]
    decorate_rules = [rule for rule in interceptors if rule.action == "decorate"]

    intercepted_tools: list[BaseTool] = []
    for tool in tools:
        if allow_rules and not any(_matches_interceptor(tool, rule) for rule in allow_rules):
            logger.info("MCP tool skipped by allowlist interceptor: %s", tool.name)
            continue
        if any(_matches_interceptor(tool, rule) for rule in deny_rules):
            logger.info("MCP tool denied by interceptor: %s", tool.name)
            continue

        next_tool = tool
        for rule in decorate_rules:
            if _matches_interceptor(next_tool, rule):
                next_tool = _decorate_tool(next_tool, rule)
        intercepted_tools.append(next_tool)

    logger.info("Applied %d MCP tool interceptor rule(s): %d -> %d tools", len(interceptors), len(tools), len(intercepted_tools))
    return intercepted_tools


async def get_mcp_tools() -> list[BaseTool]:
    """Get all tools from enabled MCP servers.

    Returns:
        List of LangChain tools from all enabled MCP servers.
    """
    try:
        from langchain_mcp_adapters.client import MultiServerMCPClient
    except ImportError:
        logger.warning("langchain-mcp-adapters not installed. Install it to enable MCP tools: pip install langchain-mcp-adapters")
        return []

    # NOTE: We use ExtensionsConfig.from_file() instead of get_extensions_config()
    # to always read the latest configuration from disk. This ensures that changes
    # made through the Gateway API (which runs in a separate process) are immediately
    # reflected when initializing MCP tools.
    extensions_config = ExtensionsConfig.from_file()
    servers_config = build_servers_config(extensions_config)

    if not servers_config:
        logger.info("No enabled MCP servers configured")
        return []

    try:
        # Create the multi-server MCP client
        logger.info(f"Initializing MCP client with {len(servers_config)} server(s)")
        client = MultiServerMCPClient(servers_config)

        # Get all tools from all servers
        tools = await client.get_tools()
        tools = apply_mcp_tool_interceptors(tools, extensions_config)
        logger.info(f"Successfully loaded {len(tools)} tool(s) from MCP servers")

        return tools

    except Exception as e:
        logger.error(f"Failed to load MCP tools: {e}", exc_info=True)
        return []
