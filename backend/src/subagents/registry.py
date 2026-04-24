from src.subagents.builtins import BUILTIN_SUBAGENTS


def get_subagent_config(name: str): return BUILTIN_SUBAGENTS.get(name)
def list_subagents(): return list(BUILTIN_SUBAGENTS.values())
def get_subagent_names(): return list(BUILTIN_SUBAGENTS.keys())
