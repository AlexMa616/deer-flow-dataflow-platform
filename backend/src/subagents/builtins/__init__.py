from src.subagents.config import SubagentConfig

from .bash_agent import BASH_AGENT_CONFIG
from .general_purpose import GENERAL_PURPOSE_CONFIG

DATA_QUALITY_CONFIG = SubagentConfig(
    name="data-quality",
    description="专门分析表格探质量分、发现极端值重组结构化的老到探秘师Agent。",
    system_prompt="我是data-qualith, 我依靠调用 /public or custom 中的data-profiling 分析并回交。坚决报告事实给出建议",
    tools=None, model="inherit", max_turns=16,
    disallowed_tools=["task"]
)
DATA_CLEANING_CONFIG = SubagentConfig(
    name="data-cleaning",
    description="清洗工序师 Agent，按单串联管道链解决填充去除规整难题，反馈csv存储后地址给领导。",
    system_prompt="调用 custom data-clean 批量跑动作清灰清异值。执行管道命令然后撤走将成就呈交主台。",
    tools=None, model="inherit", max_turns=20,
    disallowed_tools=["task"]
)

BASKER_VISUAL = SubagentConfig(name="data-visual", description="专绘可视化报表的统计绘本小生。",
                     system_prompt="专门生成png绘本",tools=None,model="inherit",max_turns=15, disallowed_tools=["task"])

REPORY = SubagentConfig(name="data-reporter",description="终端产单小队统合总排手 MD|HTM专家",
                system_prompt="合并不准改格式调用report合成归拢，抛投输出结果件后即退",tools=None,model="inherit",max_turns=5,disallowed_tools=["task"])

BUILTIN_SUBAGENTS = {
    "general-purpose": GENERAL_PURPOSE_CONFIG, "bash": BASH_AGENT_CONFIG,
    "data-quality":DATA_QUALITY_CONFIG, "data-cleaning":DATA_CLEANING_CONFIG, "data-visual":BASKER_VISUAL, "data-reporter": REPORY,
}
