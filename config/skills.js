/**
 * ============================================================================
 * Skill 定义配置 — 可复用的工作流模板（对齐 OpenCode 的 Skill 模型）
 * ============================================================================
 *
 * 【架构定位】
 * Skill 在 OpenCode 中是一份"工作流契约"，包含：
 *   - plannerAgent: 顶层编排 Agent 的配置（system prompt / 可用工具）
 *   - taskToolDef: 委派任务的工具定义（OpenAI function calling 格式）
 *   - tools: Planner 可用的全部工具（含 task 工具）
 *   - systemContext: 注入到 Planner system prompt 的全局上下文（如 Agent 清单）
 *
 * Planner 不再用"调用 LLM 拆解任务"的两阶段模式，
 * 而是自己作为一个 Agent，通过 task 工具自主决定何时委派给哪个子 Agent。
 *
 * 【与原版的差异】
 * 原版：Planner 只用一次 LLM 把任务拆成 JSON 列表，然后 MetaAgent 顺序执行
 * 新版：Planner 是一个真正的 Agent，循环调用 LLM，每轮用 task 工具委派子任务，
 *      直到所有任务完成才输出最终汇总。
 *
 * 这正是 OpenCode / Sisyphus 的核心设计。
 * ============================================================================
 */

const skillDefinitions = {
  /**
   * "req-to-page" Skill
   * ─────────────────────────────────────────────────────────────
   * 根据用户需求生成登录页面（从需求分析到 UI 设计）。
   *
   * Planner 工作流：
   *   第 1 轮：task(agentRole="产品经理")        ← 委派 PRD
   *   第 2 轮：task(agentRole="UI设计师")        ← 委派 HTML
   *   第 3 轮：输出最终汇总
   */
  "req-to-page": {
    name: "req-to-page",
    description: "根据用户需求生成登录页面（从需求分析到UI设计）",
    version: "2.0.0",

    /**
     * plannerAgent — 顶层编排 Agent 的定义
     *
     * 它本身是一个完整的 Agent，有自己的 system prompt 和工具集。
     */
    plannerAgent: {
      name: "Planner",
      description: "顶层编排 Agent，负责理解需求并通过 task 工具委派子 Agent",
      systemPrompt: `你是一个资深的项目编排 Agent（Planner / Orchestrator）。

## 核心职责
1. 接收用户的原始需求
2. 通过 task 工具把任务委派给合适的子 Agent 执行
3. 监听子 Agent 的返回结果，决定下一步动作
4. 当所有任务完成后，向用户输出最终汇总

## 可用角色清单
{{available_agents}}

## 工作原则
- 永远不要自己"代替"子 Agent 输出内容（比如不要自己写 PRD 或 HTML）
- 通过 task 工具委派，task 工具会返回子 Agent 的最终产出
- 当所有需要的子 Agent 都完成后，给出最终的汇总答复
- 如果用户需求中已经包含 HTML 内容，你可以直接总结而不需要再次委派

## 输出规范
- 思考过程用简短的中文说明（不超过 50 字）
- 真正干活请用 task 工具
- 最终汇总时，清晰列出"完成了什么 + 产出文件路径"`,
      temperature: 0.3,
      maxTokens: 1500,
    },

    /**
     * task 工具定义（OpenAI function calling 格式）
     *
     * Planner 通过调用此工具把任务委派给指定角色的子 Agent。
     * 工具执行器（SubAgentRunner）会创建对应 Agent 的 Session，
     * 让该 Agent 独立运行并返回最终输出。
     */
    taskToolDef: {
      type: "function",
      function: {
        name: "task",
        description:
          "把一个子任务委派给指定角色的 Agent 执行。该 Agent 会以全新的独立对话历史运行，完成后返回最终结果。",
        parameters: {
          type: "object",
          properties: {
            agentRole: {
              type: "string",
              description:
                "被委派的 Agent 角色名，必须从「可用角色清单」中选择",
            },
            prompt: {
              type: "string",
              description: "给该 Agent 的具体任务描述（可包含上下文）",
            },
          },
          required: ["agentRole", "prompt"],
        },
      },
    },
  },
};

module.exports = { skillDefinitions };