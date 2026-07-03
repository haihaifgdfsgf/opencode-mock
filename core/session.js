/**
 * ============================================================================
 * Session — 对话会话（对齐 OpenCode 的 Session 模型）
 * ============================================================================
 *
 * 【架构定位】
 * 在真实 OpenCode 中，每个 Agent 运行时都持有自己的 Session：
 *   - Session.id: 全局唯一 ID（对齐 OpenCode 的 ULID）
 *   - Session.parentID: 父 Session ID（对齐 OpenCode SessionTable.parentID）
 *   - Session.messages: 该 Agent 私有的对话历史
 *   - Session.metadata: Session 身份（owner role, parentID, directory 等）
 *   - Session.compact(): 当历史过长时压缩（对齐真实 OpenCode 的 /compact）
 *
 * 不同 Agent 的 Session 互相隔离。Session 之间通过 parentID 建立父子层级：
 *
 *     Planner Session (parentID=null)
 *       └── 产品经理 Session (parentID=planner_id)
 *       └── UI设计师 Session (parentID=planner_id)
 *
 * 这正是 OpenCode 的核心模型：
 *   1. 每个 Agent = 1 个 Session
 *   2. Session 通过 parentID 形成树形层级（可任意深度）
 *   3. 权限通过 Session 隔离（子 Session 不能调 task 工具，防止无限递归）
 *   4. 父 Session 的 directory / 上下文会继承给子 Session
 *
 * 【与 ContextManager 的区别】
 * 原版 ContextManager 是一个"全局共享的状态机"（一个对象管所有子任务的 outputs）。
 * 新版 Session 是"每个 Agent 一份独立 memory"，更贴近真实 OpenCode。
 *
 * 全局共享的部分（如各 Agent 最终产出）由 MessageBus 承担。
 * ============================================================================
 */

const { randomUUID } = require("crypto");

const MAX_MESSAGES = 20; // 超过该数量触发压缩

class Session {
  /**
   * @param {object} opts
   *   - owner: 该 Session 所属的 Agent 角色名（如 "Planner"）
   *   - systemPrompt: Agent 的系统提示词（作为 messages[0]）
   *   - parentID: 父 Session 的 ID（对齐 OpenCode SessionTable.parentID）
   *                null 表示这是一个根 Session（顶层 Planner）
   *   - directory: 该 Session 的工作目录（子 Session 继承父 Session）
   *   - canDelegate: 是否允许调 task 工具创建更深的子 Session
   *                  Planner=true, 子 Agent=false（对齐 OpenCode 默认 deny）
   *   - sessionId: 自定义 ID（默认自动生成 UUID）
   */
  constructor({
    owner,
    systemPrompt,
    parentID = null,
    directory = process.cwd(),
    canDelegate = false,
    sessionId = null,
  } = {}) {
    this.id = sessionId || generateSessionID();
    this.parentID = parentID;
    this.owner = owner;
    this.directory = directory;
    this.canDelegate = canDelegate; // 是否允许 task 委派（防递归）
    this.turn = 0; // 该 Agent 已经调过几次 LLM（用于 Mock 路由）
    this.messages = systemPrompt
      ? [{ role: "system", content: systemPrompt }]
      : [];
    this.metadata = {
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      title: null, // UI 友好的标题（OpenCode 用 session.title）
    };
  }

  /**
   * addUser — 追加 user 消息
   */
  addUser(content) {
    this.messages.push({ role: "user", content });
    this._touch();
  }

  /**
   * addAssistant — 追加 assistant 消息（纯文本响应）
   */
  addAssistant(content) {
    this.messages.push({ role: "assistant", content });
    this._touch();
  }

  /**
   * addAssistantToolCalls — 追加带 tool_calls 的 assistant 消息
   */
  addAssistantToolCalls(content, toolCalls) {
    const message = { role: "assistant", content };
    if (toolCalls && toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }
    this.messages.push(message);
    this._touch();
  }

  /**
   * addToolResult — 追加工具执行结果（OpenAI tool message 格式）
   */
  addToolResult(toolCallId, content) {
    this.messages.push({
      role: "tool",
      tool_call_id: toolCallId,
      content,
    });
    this._touch();
  }

  /**
   * getMessages — 返回当前 Session 的消息列表（供 LLM 调用）
   */
  getMessages() {
    return this.messages;
  }

  /**
   * getLastAssistantContent — 取最后一条 assistant 的文本内容
   */
  getLastAssistantContent() {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.role === "assistant" && m.content && !m.tool_calls) {
        return m.content;
      }
    }
    return null;
  }

  /**
   * bumpTurn — 自增内部 turn 计数（用于 Mock 路由 & 真实系统的 telemetry）
   */
  bumpTurn() {
    this.turn++;
  }

  /**
   * compact — 上下文压缩（对齐真实 OpenCode 的 /compact 机制）
   *
   * 当 messages 数量超过 MAX_MESSAGES 时，保留 system prompt + 最近 N 条，
   * 中间部分用 "[... 已压缩的历史上下文 ...]" 占位符替代。
   * 真实系统中这里通常会再调一次 LLM 做摘要。
   */
  compact() {
    if (this.messages.length <= MAX_MESSAGES) return;

    const systemMsg = this.messages[0];
    const recent = this.messages.slice(-Math.floor(MAX_MESSAGES / 2));

    this.messages = [
      systemMsg,
      {
        role: "system",
        content: `[... 已压缩 ${this.messages.length - 1 - recent.length} 条历史消息 ...]`,
      },
      ...recent,
    ];

    console.log(
      `   🗜️  [${this.owner}] Session 已压缩，当前消息数: ${this.messages.length}`,
    );
  }

  /**
   * snapshot — 把当前 Session 序列化为可持久化对象（对齐 OpenCode JSONL）
   */
  snapshot() {
    return {
      id: this.id,
      parentID: this.parentID,
      owner: this.owner,
      directory: this.directory,
      canDelegate: this.canDelegate,
      turn: this.turn,
      messages: this.messages,
      metadata: this.metadata,
    };
  }

  _touch() {
    this.metadata.lastActiveAt = Date.now();
    this.compact();
  }
}

/**
 * generateSessionID — 生成 Session ID
 *
 * 真实 OpenCode 用 ULID（Descending ULID，按时间倒序）。
 * Mock 简化为 UUID v4，文件名前缀方便排序。
 */
function generateSessionID() {
  return `ses_${randomUUID().replace(/-/g, "").substring(0, 16)}`;
}

module.exports = { Session, MAX_MESSAGES, generateSessionID };