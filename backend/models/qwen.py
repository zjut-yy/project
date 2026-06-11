from typing import Any, Dict, Optional

from .. import agent_internvideo_server as legacy


def ensure_qwen() -> None:
    legacy.ensure_qwen()


def chat(prompt: str, system: Optional[str] = None, max_new_tokens: Optional[int] = None) -> Optional[str]:
    if max_new_tokens is None:
        return legacy.qwen_chat(prompt, system=system)
    return legacy.qwen_chat(prompt, system=system, max_new_tokens=max_new_tokens)


def generate_unified_plan(question: str, ctx: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    return legacy.generate_unified_plan(question, ctx)
