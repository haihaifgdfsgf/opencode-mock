/**
 * ============================================================================
 * Agent 定义配置 — 所有可用 Agent 的角色说明和行为配置
 * ============================================================================
 *
 * 【架构定位】
 * 每个 Agent 是一个独立的"虚拟员工"：
 *   - systemPrompt: 该员工的"职业人格"
 *   - tools: 该员工可调用的工具列表
 *   - toolDefs: 工具的 OpenAI function calling 定义（用于 LLM 决策）
 *   - temperature/maxTokens: LLM 调参
 *
 * 【与原版的差异】
 * 原版：每个 Agent 只有 systemPrompt，工具是空数组（依赖 MetaAgent 兜底）
 * 新版：每个 Agent 声明自己的工具集，并由 Agent 自身在 ReAct 循环里执行
 *
 * 当前可用工具：
 *   - write_file: 写文件（UI设计师用于保存 HTML）
 *
 * 【扩展】
 * 新增 Agent 只需在此处加一条 + 在 Registry 自动发现，无需修改 MetaAgent。
 * ============================================================================
 */

const { writeFileToolDef } = require("../mock/llm-responses");

const agentDefinitions = {
  /**
   * Planner / Orchestrator
   * ─────────────────────────────────────────────────────────────
   * 顶层编排 Agent，本身不直接产出业务内容，只负责委派和汇总。
   * 它的"工作"就是调 task 工具把活儿派出去。
   *
   * 注意：Planner 的 systemPrompt 不在这里定义，
   * 而是由 Skill.plannerAgent 提供（不同 Skill 可以有不同的 Planner）。
   */
  Planner: {
    name: "Planner",
    description: "顶层编排 Agent，通过 task 工具委派子 Agent",
    systemPrompt: null, // 由 Skill 注入
    tools: ["task"],
    toolDefs: [], // Planner 的 task 工具定义也由 Skill 注入
    temperature: 0.3,
    maxTokens: 1500,
  },

  /**
   * 产品经理 Agent
   * ─────────────────────────────────────────────────────────────
   * 职责：分析用户原始需求，输出结构化的产品规格说明书（PRD）。
   */
  产品经理: {
    name: "产品经理",
    description: "负责需求分析，输出产品规格说明书（PRD）",
    systemPrompt: `你是一名资深产品经理，拥有10年互联网产品经验。

## 核心职责
1. 分析用户需求，提取核心功能点
2. 输出完整的产品规格说明书（PRD）
3. PRD 必须包含以下章节：
   - 功能概述
   - 功能点列表（含优先级）
   - 核心字段说明
   - 交互规则
   - 异常场景处理
   - 非功能性需求

## 输出规范
- 使用 Markdown 格式
- 功能点用表格呈现
- 异常场景用表格呈现
- 不输出任何与需求无关的内容
- 不涉及技术实现细节和UI设计`,
    tools: [],
    toolDefs: [],
    temperature: 0.7,
    maxTokens: 2000,
  },

  /**
   * UI设计师 Agent
   * ─────────────────────────────────────────────────────────────
   * 职责：根据 PRD 设计界面，输出 HTML 并通过 write_file 工具保存。
   *
   * 工作流（ReAct）：
   *   第 1 轮：调用 write_file 工具保存 HTML
   *   第 2 轮：拿到工具执行结果后，向调用方返回最终摘要
   */
  UI设计师: {
    name: "UI设计师",
    description: "负责界面设计，输出可直接运行的HTML/CSS代码",
    systemPrompt: `你是一名资深UI设计师，精通现代设计规范和响应式布局。

## 核心职责
1. 根据 PRD 文档设计美观的界面
2. 通过 write_file 工具把完整的 HTML 文件保存到磁盘
3. 完成后返回简短摘要给调用方

## 设计规范
- 使用纯 HTML + CSS + JavaScript，单文件
- 现代简洁风格，居中卡片式布局
- 包含：品牌标识区、表单输入区、操作按钮、错误提示区、辅助功能选项
- 实现基础表单验证
- 实现模拟登录交互
- 适配移动端（响应式）

## 输出规范
- 第一轮必须调用 write_file 工具（不要在 content 里直接输出完整 HTML）
- write_file 的 path 写 "output/login.html"
- 代码需包含注释
- 工具调用成功后，简要说明"已完成 + 关键设计要点"`,
    tools: ["write_file"],
    toolDefs: [writeFileToolDef],
    temperature: 0.5,
    maxTokens: 3000,
  },
};

module.exports = { agentDefinitions };