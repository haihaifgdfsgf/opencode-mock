/**
 * ============================================================================
 * MockLLMClient — 模拟大模型 API 客户端（对齐 OpenCode 设计）
 * ============================================================================
 *
 * 【架构定位】
 * 在真实 OpenCode 中，LLM Client 是一个无状态的服务端点：
 * - 调用者通过 `role`（Agent 身份）指明"我是谁"
 * - 调用者携带自己的 messages（独立维护的对话历史）
 * - Client 不知道规划/执行阶段，只根据 role + 当前轮次路由响应
 *
 * 【与原版的差异】
 * 原版用 messages 内容关键词（"任务总控Agent" / "产品经理"）判断场景，
 * 这导致 Client 与业务逻辑耦合——改个 prompt 关键词就路由失败。
 *
 * 新版解耦方案：
 *   - 通过调用方显式传入 `agentRole`（如 "Planner"/"产品经理"/"UI设计师"）
 *   - 通过调用方传入 `sessionState`（如 {currentTurn: 1}）让 Mock 支持
 *     "同一个 Agent 多次循环调用"的场景（ReAct 模式）
 *   - Client 只负责"按 role + state 路由响应"，不解析消息内容
 *
 * 【调用方约定】
 *   chat(messages, { agentRole: "Planner", sessionState: {turn: 1} })
 *
 * 在真实系统中，agentRole 来自 Agent 实例，sessionState 是该 Agent 的私有状态。
 * ============================================================================
 */

const {
  plannerResponses, // Planner Agent 的多次循环响应
  productManagerResponses, // 产品经理 Agent 的多次循环响应
  uiDesignerResponses, // UI设计师 Agent 的多次循环响应
} = require("./llm-responses");

class MockLLMClient {
  constructor() {
    this.callCount = 0;
  }

  /**
   * chat — 模拟 LLM 聊天接口（对齐 OpenAI Chat Completions API）
   *
   * @param {Array} messages - 当前 Agent 自己的对话历史（独立维护）
   * @param {object} options
   *   - agentRole: 调用方所属的 Agent 角色（决定路由到哪一组 Mock 响应）
   *   - sessionState: 当前会话状态（如 {turn: 1}），用于支持 ReAct 多轮循环
   *   - temperature / maxTokens: LLM 调参
   * @returns {Promise<object>} 模拟的 LLM 响应
   */
  async chat(messages, options = {}) {
    this.callCount++;
    const callId = this.callCount;

    console.log(`\n${"=".repeat(60)}`);
    console.log(`📞 第 ${callId} 次大模型调用 [${options.agentRole || "unknown"}]`);
    console.log(`${"=".repeat(60)}`);

    console.log(`\n📤 请求消息 (${messages.length} 条):`);
    messages.forEach((msg, idx) => {
      const role = msg.role || "unknown";
      const content = msg.content || "";
      const preview =
        content.length > 200 ? content.substring(0, 200) + "..." : content;
      console.log(`  [${idx}] ${role}: ${preview}`);
    });

    if (messages.some((m) => m.role === "assistant" && m.tool_calls)) {
      const lastToolCall = messages.filter((m) => m.tool_calls).pop();
      console.log(
        `  🔧 tool_calls: ${JSON.stringify(
          lastToolCall.tool_calls.map((t) => t.function.name),
        )}`,
      );
    }

    await this.delay(500);

    const response = this.routeByRole(options.agentRole, options.sessionState);

    console.log("\n📥 大模型响应:");
    if (response.choices[0].message.content) {
      const content = response.choices[0].message.content;
      const preview =
        content.length > 300 ? content.substring(0, 300) + "..." : content;
      console.log(`  ${preview}`);
    }
    if (response.choices[0].message.tool_calls) {
      console.log(
        `  tool_calls: ${JSON.stringify(response.choices[0].message.tool_calls, null, 2)}`,
      );
    }
    console.log(`${"=".repeat(60)}\n`);

    return response;
  }

  /**
   * routeByRole — 按 agentRole + sessionState 路由到对应的 Mock 响应序列
   *
   * 每种 Agent 类型有一组"按调用轮次排列的响应"，
   * 模拟 ReAct 模式下"同一个 Agent 会被多次调用"的真实场景。
   */
  routeByRole(agentRole, sessionState = {}) {
    const turn = sessionState.turn || 1;
    const responses = this.getResponsesForRole(agentRole);
    const idx = Math.min(turn - 1, responses.length - 1);
    return responses[idx];
  }

  getResponsesForRole(agentRole) {
    switch (agentRole) {
      case "Planner":
        return plannerResponses;
      case "产品经理":
        return productManagerResponses;
      case "UI设计师":
        return uiDesignerResponses;
      default:
        return [
          {
            id: `chatcmpl-mock-${Date.now()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: "gpt-4o-mock",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: "我需要更多信息才能完成任务。",
                  tool_calls: null,
                },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          },
        ];
    }
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = { MockLLMClient };