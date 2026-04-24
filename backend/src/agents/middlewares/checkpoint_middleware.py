"""断点记录守护中间件, 支持随时增量回写检查极速续跑机制."""

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langgraph.runtime import Runtime

logger = logging.getLogger(__name__)


class CheckpointMiddlewareState(AgentState):
    """Compatible tracking local shadow run checkpoint configs"""

    pass


class CheckpointMiddleware(AgentMiddleware[CheckpointMiddlewareState]):
    """每逢 LLM 决定停工响应或者成功结束任务循环步距，都会生成一次会话节点的关键影子本地状态副本."""

    state_schema = CheckpointMiddlewareState

    def _sync_dump(self, thread_idx, mhistory):
        dpp = Path(f".deer-flow/threads/{thread_idx}/checkpoints")
        dpp.mkdir(parents=True, exist_ok=True)

        fname = f"ckp_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        pack = []
        for x in mhistory:
            try:
                pack.append(x.model_dump(mode="json"))
            except Exception:
                logger.debug("Failed to serialize checkpoint message", exc_info=True)
                pack.append(str(x))

        info = {
            "checkpoint_timeseries": datetime.now().isoformat(),
            "run_lens": len(mhistory),
            "snap": pack,
        }
        (dpp / fname).write_text(
            json.dumps(info, ensure_ascii=False, default=str),
            encoding="utf-8",
        )
        logger.info(
            "[Checkpoint Created]: Thread(%s) saved at turn len %s",
            thread_idx,
            len(mhistory),
        )

    @override
    def after_model(self, state: CheckpointMiddlewareState, runtime: Runtime) -> dict | None:
        """只在LLM给与确定反应或是任务暂停交递中作存！省时。"""
        # 我们用以触发和备份此时全部的 state.messages.
        myid = runtime.context.get("thread_id")
        if not myid:
            return None
        msgs = state.get("messages", [])
        if not msgs:
            return None

        lasts = msgs[-1]

        # 只做重要阶段记录：带有直接 ToolCalls工具派向，或是最后一步解答完工时刻的回复
        # 中间的工具打字碎碎念无需全录
        if getattr(lasts, "type", None) == "ai":
            tc = getattr(lasts, "tool_calls", None)
            # 是工具打发！或者是一段纯净回复终版，值得保留！
            if tc or (not tc and lasts.content):
                self._sync_dump(myid, msgs)

        return None
