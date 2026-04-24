import json
from typing import Annotated

from langchain.tools import InjectedToolCallId, ToolRuntime, tool
from langgraph.typing import ContextT

from src.agents.thread_state import ThreadState
from src.tools.events import emit_tool_error, emit_tool_result, emit_tool_start
from src.vector import get_vector_index


@tool("semantic_search", parse_docstring=True)
def semantic_search_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    query: Annotated[str, "Search query to run against uploads and memory"],
    tool_call_id: Annotated[str, InjectedToolCallId],
    top_k: Annotated[int, "Number of results to return"] = 5,
) -> str:
    """Semantic search across uploads and memory with citations.

    Args:
        runtime: Tool runtime context that may contain the thread ID.
        query: Search query to run against uploads and memory.
        top_k: Number of results to return.

    Returns:
        JSON string containing results with `excerpt` and `citation` fields.
        Use the citation info to reference sources in your response.
    """
    emit_tool_start(
        "semantic_search",
        tool_call_id=tool_call_id,
        summary=query,
    )

    thread_id = None
    if runtime is not None and runtime.context is not None:
        thread_id = runtime.context.get("thread_id")

    try:
        index = get_vector_index()
        results = index.search(query=query, top_k=top_k, thread_id=thread_id)
        if thread_id:
            memory_results = index.search(query=query, top_k=top_k, source="memory")
            results = results + memory_results
            results.sort(key=lambda item: item.score, reverse=True)
            results = results[:top_k]
        payload = []
        for result in results:
            payload.append(
                {
                    "score": result.score,
                    "source": result.source,
                    "thread_id": result.thread_id,
                    "filename": result.filename,
                    "chunk_index": result.chunk_index,
                    "excerpt": result.content[:280].replace("\n", " ").strip(),
                    "metadata": result.metadata,
                    "citation": result.citation,
                }
            )
        response = json.dumps({"query": query, "results": payload}, ensure_ascii=False)
        emit_tool_result(
            "semantic_search",
            tool_call_id=tool_call_id,
            summary=query,
            preview=f"{len(payload)} result(s)",
        )
        return response
    except Exception as e:
        error = f"Error: {type(e).__name__}: {e}"
        emit_tool_error(
            "semantic_search",
            tool_call_id=tool_call_id,
            summary=query,
            error=error,
        )
        return error
