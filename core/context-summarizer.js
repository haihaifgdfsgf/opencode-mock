/**
 * ============================================================================
 * ContextSummarizer — 父 Session 历史摘要器（对齐 OpenCode 的 compaction 机制）
 * ============================================================================
 *
 * 【架构定位】
 * 真实 OpenCode 中，子 Agent 不能直接"看到"父 Agent 的完整对话历史——
 * 那会让 context window 爆炸，并且破坏 Session 隔离原则。
 *
 * 但完全切断父子通信又会让子 Agent 失去"为什么我要做这件事"的语境。
 * 真实系统的做法是：
 *   1. 父 Session 完成时，调一个 compaction Agent 把历史压缩成摘要
 *   2. 摘要塞进子 Session 的初始 prompt（作为上下文）
 *   3. 子 Session 自己保留独立历史，不再回看父的原始消息
 *
 * 我们的 mock 实现：
 *   - 不真的调 LLM（mock 环境）
 *   - 用确定性算法从 messages 提取关键信息
 *   - 输出一个紧凑的"父 Session 摘要"
 *
 * 摘要格式（结构化，方便下游 Agent 解析）：
 *
 *   ## 上游上下文摘要 (parentSession: <id>, owner: <role>)
 *
 *   ### 思考过程
 *   - <每轮 assistant 的简短总结>
 *
 *   ### 关键决策
 *   - <每次 tool_call 的意图>
 *
 *   ### 产出
 *   - <最终输出>
 *
 * ============================================================================
 */

/**
 * summarize — 把一个父 Session 压缩成一段结构化摘要
 *
 * @param {Session} parentSession - 父 Session（已完成或进行中均可）
 * @returns {string} Markdown 格式的摘要文本
 */
function summarize(parentSession) {
  if (!parentSession) return "";

  const lines = [];
  lines.push(
    `## 上游上下文摘要 (parentSession: ${parentSession.id}, owner: ${parentSession.owner})`,
  );
  lines.push("");

  const { messages } = parentSession;

  // 1. 提取每轮 assistant 的思考
  const assistantThoughts = messages
    .filter((m) => m.role === "assistant" && m.content && !m.tool_calls)
    .map((m) => m.content.trim());

  if (assistantThoughts.length > 0) {
    lines.push("### 思考过程");
    assistantThoughts.forEach((t, i) => {
      const short = t.length > 150 ? t.substring(0, 150) + "..." : t;
      lines.push(`- 第 ${i + 1} 轮：${short}`);
    });
    lines.push("");
  }

  // 2. 提取 tool_call 决策
  const toolCalls = [];
  for (const m of messages) {
    if (m.role === "assistant" && m.tool_calls) {
      for (const tc of m.tool_calls) {
        let args = tc.function.arguments || "";
        if (args.length > 100) args = args.substring(0, 100) + "...";
        toolCalls.push(`- 调用 \`${tc.function.name}\`(${args})`);
      }
    }
  }
  if (toolCalls.length > 0) {
    lines.push("### 关键决策");
    toolCalls.forEach((t) => lines.push(t));
    lines.push("");
  }

  // 3. 最终产出（最后一条 assistant 文本）
  const finalOutput = parentSession.getLastAssistantContent();
  if (finalOutput) {
    const short = finalOutput.length > 300
      ? finalOutput.substring(0, 300) + "..."
      : finalOutput;
    lines.push("### 最终产出");
    lines.push(short);
    lines.push("");
  }

  return lines.join("\n");
}

module.exports = { summarize };