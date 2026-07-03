/**
 * ============================================================================
 * 入口文件 — OpenCode 多 Agent 协作模拟系统的启动点
 * ============================================================================
 *
 * 【架构定位】
 * 用户输入到达顶层 Planner Agent（Sisyphus），
 * Planner 自己跑 ReAct 循环：通过 task 工具委派子 Agent，
 * 每个子 Agent 也跑自己的 ReAct 循环，直到所有任务完成。
 *
 * 【执行流程】
 *   用户需求 → Planner Session
 *              │
 *              ├─ ReAct 循环:
 *              │   ├─ 调 LLM 思考"该让谁干"
 *              │   ├─ 调 task(agentRole="产品经理", prompt="...")
 *              │   │     └─ SubAgentRunner 启动新产品经理 Session
 *              │   │           └─ 产品经理 ReAct 循环 → 产出 PRD
 *              │   ├─ 调 task(agentRole="UI设计师", prompt="...")
 *              │   │     └─ SubAgentRunner 启动新UI设计师 Session
 *              │   │           └─ UI设计师 ReAct 循环 → 调 write_file 工具 → 产出 HTML
 *              │   └─ 最终汇总输出给用户
 * ============================================================================
 */

const { MetaAgent } = require("./core/meta-agent");

async function main() {
  console.log("\n" + "═".repeat(60));
  console.log("   🧠 OpenCode Mock - 多Agent协作演示");
  console.log("═".repeat(60));

  const userInput = "帮我设计一个用户登录页面，包含用户名、密码输入和登录按钮";

  const metaAgent = new MetaAgent();

  try {
    await metaAgent.execute(userInput);
  } catch (error) {
    console.error("\n❌ 执行失败:", error.message);
    console.error(error.stack);
  }

  console.log("\n" + "═".repeat(60));
  console.log("   演示结束");
  console.log("═".repeat(60));
}

main();