"""Tests for memory queue guardrails."""

from src.agents.memory.queue import MemoryUpdateQueue
from src.config.memory_config import MemoryConfig, get_memory_config, set_memory_config


def test_memory_queue_drops_oldest_when_pending_limit_is_reached():
    original_config = get_memory_config()
    set_memory_config(MemoryConfig(debounce_seconds=300, max_pending_contexts=10))

    queue = MemoryUpdateQueue()
    try:
        for index in range(11):
            queue.add(f"thread-{index}", [str(index)])

        assert queue.pending_count == 10
        assert [context.thread_id for context in queue._queue] == [f"thread-{index}" for index in range(1, 11)]
    finally:
        queue.clear()
        set_memory_config(original_config)
