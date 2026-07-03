/**
 * ============================================================================
 * SessionStore — Session 持久化与查询服务（对齐 OpenCode 的 Session 服务层）
 * ============================================================================
 *
 * 【架构定位】
 * 真实 OpenCode 的 Session 存到 SQLite（SessionTable），
 * 由 Session.Service 提供 create / get / children / list 等接口。
 *
 * Mock 版用文件系统模拟：
 *   - 每个 Session 一个 .json 文件
 *   - 文件名按 Session ID 排序
 *   - Session.snapshot() 是写入的内容（含 parentID、directory、messages）
 *
 * 这层抽象的关键意义：
 *   1. **可追溯**：任意时刻 dump 所有 Session 就能看到完整调用树
 *   2. **可查询**：通过 parentID 反查所有子 Session
 *   3. **可恢复**：未来可以从磁盘加载 Session 恢复执行（OpenCode 的 resume）
 *   4. **跨 Agent 引用**：Planner 知道产品经理的 Session ID，可以回查历史
 *
 * 【与旧版 persistSession() 的区别】
 * 旧版：每个 Session 一份文件，文件名是 `session_<taskId>_<owner>_<timestamp>.json`
 *       parentID 完全丢失，没法回溯父子关系
 *
 * 新版：
 *   - 文件名是 Session ID（持久不变）
 *   - 每个文件包含完整 parentID 字段
 *   - 维护一个内存中的 Session 索引，支持快速 children() 查询
 * ============================================================================
 */

const fs = require("fs");
const path = require("path");

class SessionStore {
  /**
   * @param {string} dir - Session 持久化目录（默认 .opencode/sessions/）
   */
  constructor(dir) {
    this.dir = dir;
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
    // 内存索引：sessionID -> Session 对象（用于快速查询）
    // 同时落盘一份 .json
    this.index = new Map();
  }

  /**
   * register — 注册一个 Session 到 Store（不立即落盘）
   *
   * 与 persist() 分离：注册是声明"我存在了"，持久化是写入磁盘。
   * 真实 OpenCode 用 SQLite 事务，这里拆开更清晰。
   */
  register(session) {
    this.index.set(session.id, session);
  }

  /**
   * persist — 把 Session 落盘（每次 ReAct 轮次结束都调一次）
   *
   * 文件名 = `<session_id>.json`
   * 真实 OpenCode 是 .jsonl（每条消息一行），Mock 用 .json 更直观。
   */
  persist(session) {
    if (!session) return;
    this.index.set(session.id, session);
    const filePath = path.join(this.dir, `${session.id}.json`);
    fs.writeFileSync(
      filePath,
      JSON.stringify(session.snapshot(), null, 2),
      "utf-8",
    );
  }

  /**
   * get — 按 ID 取一个 Session
   *
   * 对齐 OpenCode 的 `Session.get(id)`
   */
  get(sessionId) {
    if (this.index.has(sessionId)) {
      return this.index.get(sessionId);
    }
    // 落盘但未在内存（冷启动场景）：从磁盘恢复
    const filePath = path.join(this.dir, `${sessionId}.json`);
    if (!fs.existsSync(filePath)) return null;
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    // 反序列化为 Session（不重新触发 _touch / compact）
    const { Session } = require("./session");
    const restored = new Session({
      owner: raw.owner,
      parentID: raw.parentID,
      directory: raw.directory,
      canDelegate: raw.canDelegate,
      sessionId: raw.id,
    });
    restored.messages = raw.messages;
    restored.turn = raw.turn;
    restored.metadata = raw.metadata;
    this.index.set(sessionId, restored);
    return restored;
  }

  /**
   * children — 取一个 Session 的所有子 Session
   *
   * 对齐 OpenCode 的 `Session.children(parentID)`
   * 返回数组，按创建时间排序
   */
  children(parentID) {
    const result = [];
    for (const session of this.index.values()) {
      if (session.parentID === parentID) {
        result.push(session);
      }
    }
    // 按 createdAt 升序（创建先后）
    result.sort((a, b) => a.metadata.createdAt - b.metadata.createdAt);
    return result;
  }

  /**
   * all — 返回所有已注册的 Session
   */
  all() {
    return Array.from(this.index.values());
  }

  /**
   * root — 返回根 Session（parentID 为 null 的 Session）
   */
  root() {
    for (const session of this.index.values()) {
      if (session.parentID === null) return session;
    }
    return null;
  }
}

module.exports = { SessionStore };