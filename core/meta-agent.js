/**
 * ============================================================================
 * MetaAgent — 顶层编排 Agent（对齐 OpenCode Sisyphus 的核心模型）
 * ============================================================================
 *
 * 【架构定位 — V3 重构】
 *
 * V1: MetaAgent 是"调用 LLM 的程序"（拆 JSON → 顺序执行）
 * V2: MetaAgent 本身就是一个 Agent（自己的 Session + ReAct 循环）
 * V3: MetaAgent 把 Session 接入 SessionStore，
 *      显式维护 Session 父子层级（对齐 OpenCode parentID 模型）
 *
 * 这次升级解决的核心问题：
 *   - V2 里 Planner 和子 Agent 的 Session 是"两棵孤立的树"
 *   - 没有任何机制能回溯"这个子任务是谁派的、上下文是什么"
 *   - 子 Agent 看不到 Planner 的任何思考过程（只能看到 Planner 给的字符串 prompt）
 *
 * V3 的关键改动：
 *   1. Planner Session 接入 SessionStore（持久化 + 可追溯）
 *   2. 委派子 Agent 时，把 plannerSession 作为 parentSession 传入
 *   3. 子 Agent 启动时，把 Planner Session 历史摘要注入 initial prompt
 *   4. 任务结束后打印完整的 Session 父子树
 *
 * 【类比软件公司】
 *   Planner = 总经理
 *   SubAgentRunner = 人事部门
 *   每个子 Agent = 员工（入职登记表上写了"直属上级 = Planner"）
 *   SessionStore = 人事档案柜（按员工编号能查所有历史）
 *   父子 Session 链 = 公司组织树（能反查任意员工的完整汇报关系）
 * ============================================================================
 */

const fs = require("fs");
const path = require("path");
const { Registry } = require("./registry");
const { Session } = require("./session");
const { SessionStore } = require("./session-store");
const { MessageBus } = require("./message-bus");
const { ToolRegistry } = require("./tool-registry");
const { SubAgentRunner } = require("./sub-agent-runner");
const { MockLLMClient } = require("../mock/llm-client");
const { summarize } = require("./context-summarizer");

class MetaAgent {
  constructor() {
    this.registry = new Registry();
    this.llm = new MockLLMClient();
    this.messageBus = new MessageBus();

    // Planner 的输出文件目录
    this.outputDir = path.join(__dirname, "../output");
    this.sessionsDir = path.join(this.outputDir, "sessions");
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    // ── 新增：SessionStore（对齐 OpenCode Session.Service）──
    this.sessionStore = new SessionStore(this.sessionsDir);

    // 工具注册表（write_file 等真实工具）
    this.toolRegistry = new ToolRegistry({ outputDir: this.outputDir });

    // 注册一个虚拟的 "task" 工具：调用 SubAgentRunner
    this.toolRegistry.register({
      name: "task",
      description: "把子任务委派给指定角色的 Agent",
      parameters: { type: "object" },
      execute: async (args) => {
        return await this.delegateTask(args);
      },
    });

    // 子 Agent 运行器（注入 SessionStore）
    this.subAgentRunner = new SubAgentRunner({
      registry: this.registry,
      llm: this.llm,
      toolRegistry: this.toolRegistry,
      messageBus: this.messageBus,
      sessionStore: this.sessionStore,
      outputDir: this.sessionsDir,
    });

    this.skillName = "req-to-page";
    this.plannerSession = null; // 启动时创建
    this._taskCounter = 0; // 委派任务的自增 ID
  }

  /**
   * execute — 启动 Planner Agent 的 ReAct 循环
   *
   * @param {string} userInput - 用户的原始需求
   * @returns {Promise<string>} Planner 的最终输出（汇总给用户）
   */
  async execute(userInput) {
    console.log("\n🚀 用户需求:", userInput);
    console.log("━".repeat(60));

    // ── 1. 创建 Planner Session（根 Session，parentID=null，可委派）──
    const skill = this.registry.getSkill(this.skillName);
    const systemPrompt = this.registry.renderPlannerSystemPrompt(this.skillName);
    this.plannerSession = new Session({
      owner: "Planner",
      systemPrompt,
      parentID: null, // Planner 是根 Session
      canDelegate: true, // Planner 是唯一允许 task 委派的 Session
    });
    this.sessionStore.register(this.plannerSession);
    this.sessionStore.persist(this.plannerSession);
    console.log(`🆔 Planner Session ID: ${this.plannerSession.id} (root, canDelegate=true)`);

    // ── 2. 注入用户原始需求 ──
    this.plannerSession.addUser(userInput);
    this.sessionStore.persist(this.plannerSession);

    // ── 3. Planner 的 ReAct 循环 ──
    let finalOutput = null;
    const maxTurns = 10;
    for (let turn = 1; turn <= maxTurns; turn++) {
      this.plannerSession.bumpTurn();

      console.log(`\n🔄 [Planner] 第 ${turn} 轮 LLM 调用`);

      const response = await this.llm.chat(this.plannerSession.getMessages(), {
        agentRole: "Planner",
        sessionState: { turn: this.plannerSession.turn },
        temperature: skill.plannerAgent.temperature,
        maxTokens: skill.plannerAgent.maxTokens,
        tools: this.registry.getPlannerTools(this.skillName),
      });

      const message = response.choices[0].message;
      const toolCalls = message.tool_calls;

      // ── 路径 A：调用 task 工具委派子 Agent ──
      if (toolCalls && toolCalls.length > 0) {
        this.plannerSession.addAssistantToolCalls(message.content || "", toolCalls);
        this.sessionStore.persist(this.plannerSession);

        for (const call of toolCalls) {
          if (call.function.name !== "task") {
            this.plannerSession.addToolResult(
              call.id,
              `❌ Planner 不能调用工具 ${call.function.name}`,
            );
            this.sessionStore.persist(this.plannerSession);
            continue;
          }

          console.log(`   🎯 Planner 委派子任务`);

          const toolResult = await this.toolRegistry.execute(
            call.function.name,
            JSON.parse(call.function.arguments),
          );

          this.plannerSession.addToolResult(call.id, toolResult);
          this.sessionStore.persist(this.plannerSession);
        }
        continue;
      }

      // ── 路径 B：Planner 给出最终汇总 ──
      this.plannerSession.addAssistant(message.content || "");
      this.sessionStore.persist(this.plannerSession);
      finalOutput = message.content || "";
      break;
    }

    if (finalOutput === null) {
      finalOutput = "Planner 达到最大循环次数仍未产出汇总";
    }

    // ── 4. 展示 Session 父子树 ──
    this.printSessionTree();

    // ── 5. 展示汇总 ──
    this.summaryPhase();

    return finalOutput;
  }

  /**
   * delegateTask — task 工具的实际执行逻辑
   *
   * 关键改动：
   *   - 把 this.plannerSession 作为 parentSession 传入
   *   - 自动生成 Planner Session 的历史摘要，注入子 Agent 上下文
   */
  async delegateTask(args) {
    const agentRole = args.agentRole;
    let prompt = args.prompt;
    this._taskCounter++;
    const taskId = this._taskCounter;

    // 处理 Planner 传入的 {{PRD_HERE}} 占位符（Mock 协议）
    let contextFromPlanner = null;
    if (prompt.includes("{{PRD_HERE}}")) {
      const pmOutputs = this.messageBus.query({ source: "产品经理", type: "task.done" });
      if (pmOutputs.length > 0) {
        const prd = pmOutputs[0].payload;
        prompt = prompt.replace("{{PRD_HERE}}", prd);
        contextFromPlanner = prd;
      }
    }

    // ── 新增：自动注入 Planner Session 历史摘要（对齐 OpenCode compaction）──
    const parentContextSummary = this.plannerSession
      ? summarize(this.plannerSession)
      : null;

    // 启动子 Agent（传递 parentSession + 父上下文摘要）
    const output = await this.subAgentRunner.run({
      agentRole,
      prompt,
      taskId,
      parentSession: this.plannerSession, // ← 关键：建立 parentID 层级
      contextFromPlanner,
      parentContextSummary, // ← 关键：父 Session 摘要注入子 Agent
    });

    return output;
  }

  /**
   * printSessionTree — 打印完整的 Session 父子树（OpenCode 的 session_parent 导航等价物）
   */
  printSessionTree() {
    console.log("\n🌳 Session 父子树");
    console.log("─".repeat(60));

    const root = this.sessionStore.root();
    if (!root) {
      console.log("   (无 Session)");
      return;
    }

    const printNode = (session, depth) => {
      const indent = "   ".repeat(depth);
      const tag = depth === 0 ? "🟢 ROOT" : "├─";
      const flag = session.canDelegate ? " (canDelegate)" : "";
      console.log(
        `${indent}${tag} [${session.id}] owner=${session.owner}${flag}`,
      );
      console.log(`${indent}    messages=${session.messages.length}, turn=${session.turn}`);
      const children = this.sessionStore.children(session.id);
      children.forEach((c) => printNode(c, depth + 1));
    };

    printNode(root, 0);
  }

  /**
   * summaryPhase — 任务完成汇总
   */
  summaryPhase() {
    console.log("\n📊 阶段三：任务完成");
    console.log("─".repeat(40));

    const outputs = this.messageBus.getAllOutputs();
    console.log(`✅ Planner 共委派 ${Object.keys(outputs).length} 个子 Agent`);

    for (const [taskId, output] of Object.entries(outputs)) {
      console.log(`\n   📦 子任务 #${taskId}:`);
      const preview = output.length > 200 ? output.substring(0, 200) + "..." : output;
      console.log(`      ${preview}`);
    }

    console.log("\n📁 产出文件:");
    const htmlPath = path.join(this.outputDir, "login.html");
    if (fs.existsSync(htmlPath)) {
      console.log(`   ${htmlPath}`);
    }

    console.log(`\n📁 Session 文件目录:`);
    console.log(`   ${this.sessionsDir}`);
    console.log(`   (每个 Session 一个 .json 文件，含 parentID 字段)`);

    console.log("\n🎉 任务执行完毕！");
  }
}

module.exports = { MetaAgent };