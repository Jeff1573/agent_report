from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage, ToolMessage
from langchain_core.tools import tool
import json

# 1) 定义工具
@tool
def add(a: float, b: float) -> float:
    """Return the sum of two numbers."""
    return a + b

tools = [add]

# 2) 初始化模型 & 绑定工具
llm = ChatOpenAI(
    model="gemini-2.5-flash-preview-09-2025",  # 建议先用 models.list 确认真实可用ID
    api_key="ggcfcmd233@.",
    base_url="http://47.79.38.245:3002/proxy/gemini/v1beta/openai/",
)
llm_with_tools = llm.bind_tools(tools)

# 3) 对话消息
msgs = [
    SystemMessage(content="You are a helpful assistant."),
    HumanMessage(content="请用工具把 3.5 和 8 相加，然后用一句中文告诉我结果。")
]

# 4) “一次”工具循环：调用 -> 执行 -> 回传 -> 得最终答案
ai = llm_with_tools.invoke(msgs)   # 可能会提出 tool_calls
msgs.append(ai)

if getattr(ai, "tool_calls", None):
    # 执行每个工具并把结果以 ToolMessage 回给模型
    name_to_tool = {t.name: t for t in tools}
    tool_msgs = []
    for tc in ai.tool_calls:
        tname = tc["name"]
        targs = tc.get("args", {})
        out = name_to_tool[tname].invoke(targs)
        # 注意：content 建议是字符串；可把结构化结果转成 JSON 字符串
        tool_msgs.append(ToolMessage(
            tool_call_id=tc["id"],
            content=json.dumps({"result": out}, ensure_ascii=False)
        ))
    msgs.extend(tool_msgs)

# 5) 让模型基于工具结果给出最终自然语言回答
final = llm.invoke(msgs)
print(final.content)
