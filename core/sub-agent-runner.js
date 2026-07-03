/**
 * ============================================================================
 * SubAgentRunner — 子 Agent 运行器（对齐 OpenCode 的 SubAgent 调度）
 * ============================================================================
 *
 * 负责"启动一个指定角色的 Agent，让它自己跑完 ReAct 循环并返回最终结果"。
 *
 * 【关键升级 — 对齐 OpenCode 真实实现】
 *
 * 旧版：每次 run() 都创建一个无 parentID 的 Session，父子完全断裂
 * 新版：
 *   1. 创建子 Session 时显式设置 parentID（指向调用方 Planner Session）
 *   2. 继承父 Session 的 directory（对齐 PR #30650 的 directory 继承）
 *   3. 子 Session 默认 canDelegate=false（防递归对齐 OpenCode 默认 deny）
 *   4. 子 Session 启动时，自动注入"父 Session 历史摘要"作为上下文
 *   5. 每个 ReAct 轮次结束都持久化 Session（OpenCode 实时落盘）
 *
 * 【ReAct 循环】
 *   loop {
 *     response = llm.chat(session.messages, { agentRole, sessionState })
 *     if (response.tool_calls) {
 *       for each tool_call:
 *         result = toolRegistry.execute(...)
 *         session.addToolResult(tool_call_id, result)
 *         session.persist()  ← 每轮都落盘
 *       session.bumpTurn()
 *       continue
 *     } else {
 *       return response.content  // Agent 完成
 *     }
 *   }
 *
 * ============================================================================
 */

const fs = require("fs");
const path = require("path");
const { Session } = require("./session");
const { summarize } = require("./context-summarizer");

class SubAgentRunner {
  /**
   * @param {object} deps
   *   - registry: Registry 实例（用于查找 Agent 配置）
   *   - llm: LLM 客户端
   *   - toolRegistry: 工具注册表
   *   - messageBus: 消息总线（用于发布"task.done"事件）
   *   - sessionStore: Session 存储服务（OpenCode 风格的 Session 持久化）
   *   - outputDir: 持久化 Session 的目录（对齐 OpenCode 的 .opencode/sessions/）
   *   - maxTurns: 单个 Agent 最多循环多少次（防止死循环）
   */
  constructor({
    registry,
    llm,
    toolRegistry,
    messageBus,
    sessionStore,
    outputDir,
    maxTurns = 5,
  }) {
    this.registry = registry;
    this.llm = llm;
    this.toolRegistry = toolRegistry;
    this.messageBus = messageBus;
    this.sessionStore = sessionStore;
    this.outputDir = outputDir;
    this.maxTurns = maxTurns;

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  }

  /**
   * run — 启动一个子 Agent 并让它跑完
   *
   * @param {object} params
   *   - agentRole: Agent 角色名
   *   - prompt: 给该 Agent 的初始任务描述
   *   - taskId: 关联的任务 ID（用于消息总线追踪）
   *   - parentSession: 父 Session（Planner Session），用于建立 parentID 层级
   *   - contextFromPlanner: Planner 传入的额外上下文（如 PRD）
   *   - parentContextSummary: 父 Session 的压缩摘要（对齐 OpenCode compaction）
   * @returns {Promise<string>} Agent 的最终输出
   */
  async run({
    agentRole,
    prompt,
    taskId,
    parentSession = null,
    contextFromPlanner = null,
    parentContextSummary = null,
  }) {
    const agentConfig = this.registry.getAgent(agentRole);
    if (!agentConfig) throw new Error(`Agent "${agentRole}" 未找到`);
    if (!agentConfig.systemPrompt) {
      throw new Error(`Agent "${agentRole}" 缺少 systemPrompt`);
    }

    console.log(`\n🤖 启动子 Agent: ${agentRole}`);
    if (parentSession) {
      console.log(
        `   🔗 parentID=${parentSession.id} (parent owner: ${parentSession.owner})`,
      );
    }
    if (contextFromPlanner) {
      console.log(`   📦 携带上下文: ${contextFromPlanner.length} 字符`);
    }

    // ── 1. 创建子 Session（带 parentID，继承 directory，禁止委派）──
    const session = new Session({
      owner: agentRole,
      systemPrompt: agentConfig.systemPrompt,
      parentID: parentSession ? parentSession.id : null,
      directory: parentSession ? parentSession.directory : process.cwd(),
      canDelegate: false, // 子 Agent 默认禁止 task 委派（对齐 OpenCode 默认 deny）
    });
    this.sessionStore.register(session);
    this.sessionStore.persist(session);
    console.log(`   🆔 子 Session ID: ${session.id}`);

    // ── 2. 注入初始任务（含父上下文摘要 + Planner 显式传入的 context）──
    let initialPrompt = prompt;
    if (parentContextSummary) {
      initialPrompt = `${initialPrompt}\n\n${parentContextSummary}`;
    }
    if (contextFromPlanner) {
      initialPrompt = `${initialPrompt}\n\n## 来自 Planner 的上下文\n${contextFromPlanner}`;
    }
    session.addUser(initialPrompt);
    this.sessionStore.persist(session);

    // ── 3. ReAct 循环 ──
    let finalOutput = null;
    for (let turn = 1; turn <= this.maxTurns; turn++) {
      session.bumpTurn();

      console.log(`   🔄 [${agentRole}] 第 ${turn} 轮 LLM 调用`);

      const response = await this.llm.chat(session.getMessages(), {
        agentRole,
        sessionState: { turn: session.turn },
        temperature: agentConfig.temperature,
        maxTokens: agentConfig.maxTokens,
        tools: agentConfig.toolDefs,
      });

      const choice = response.choices[0];
      const message = choice.message;
      const toolCalls = message.tool_calls;

      // ── 路径 A：有工具调用 ──
      if (toolCalls && toolCalls.length > 0) {
        // 安全检查：子 Session 不能调 task 工具（防递归，对齐 OpenCode deny）
        for (const call of toolCalls) {
          if (call.function.name === "task") {
            console.log(`      🚫 [${agentRole}] 子 Session 无权调用 task 工具`);
            session.addAssistantToolCalls(message.content || "", toolCalls);
            session.addToolResult(
              call.id,
              `❌ 子 Agent 不能调用 task 工具（OpenCode 默认 deny，防止无限递归）`,
            );
            this.sessionStore.persist(session);
            continue;
          }
        }

        session.addAssistantToolCalls(message.content || "", toolCalls);
        this.sessionStore.persist(session);

        for (const call of toolCalls) {
          if (call.function.name === "task") continue; // 已处理
          const args = JSON.parse(call.function.arguments);
          console.log(`      🔧 调用工具: ${call.function.name}`);
          try {
            const result = await this.toolRegistry.execute(
              call.function.name,
              args,
            );
            session.addToolResult(call.id, result);
          } catch (e) {
            session.addToolResult(call.id, `❌ 工具执行失败: ${e.message}`);
          }
          this.sessionStore.persist(session);
        }
        continue;
      }

      // ── 路径 B：没有工具调用 → Agent 完成 ──
      session.addAssistant(message.content || "");
      this.sessionStore.persist(session);
      finalOutput = message.content || "";
      break;
    }

    if (finalOutput === null) {
      finalOutput = `[${agentRole}] 达到最大循环次数 (${this.maxTurns}) 仍未产出最终答案`;
      console.log(`   ⚠️  [${agentRole}] 达到 maxTurns 上限`);
      this.sessionStore.persist(session);
    }

    // ── 4. 发布事件 ──
    this.messageBus.publish({
      type: "task.done",
      source: agentRole,
      taskId,
      sessionID: session.id, // 对齐 OpenCode：事件携带 Session ID
      parentSessionID: session.parentID,
      payload: finalOutput,
    });

    console.log(`   ✅ [${agentRole}] 完成，输出 ${finalOutput.length} 字符`);
    console.log(`   🔗 Session 父子链: ${session.id} ← ${session.parentID || "(root)"}`);

    return finalOutput;
  }
}

module.exports = { SubAgentRunner };