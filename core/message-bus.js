/**
 * ============================================================================
 * MessageBus — 消息总线（对齐 OpenCode 的事件通信）
 * ============================================================================
 *
 * 【架构定位】
 * 真实 OpenCode 中，不同 Agent 之间的通信不通过共享内存，而是通过事件流。
 * MessageBus 提供：
 *   - 事件发布：记录"谁完成了什么"
 *   - 事件订阅：其他 Agent 可以监听并触发自己的反应
 *
 * 在当前简单版本里，MessageBus 主要承担"全局产出汇总"职责：
 *   - Planner 完成时把最终汇总写入
 *   - 每个被委派的子 Agent 完成后把结果写入
 *   - 索引和 dashboard 用
 *
 * 【接口设计】
 *   bus.publish(event)    // 发布事件
 *   bus.subscribe(filter) // 订阅事件（真实 OpenCode 中由 Planner 监听）
 *   bus.query(query)      // 查询历史事件（按 role/taskId 等条件）
 *
 * 当前先实现 publish/query，subscribe 接口先留 stub。
 * ============================================================================
 */

class MessageBus {
  constructor() {
    this.events = []; // 事件流（append-only log）
  }

  /**
   * publish — 发布一个事件
   *
   * @param {object} event
   *   - type: 事件类型（如 "task.done", "task.start"）
   *   - payload: 事件数据
   *   - source: 发出事件的 Agent role
   *   - taskId: 关联的子任务 ID（可选）
   */
  publish(event) {
    const enriched = {
      ...event,
      timestamp: Date.now(),
      id: this.events.length + 1,
    };
    this.events.push(enriched);
    return enriched;
  }

  /**
   * query — 按条件查询事件
   *
   * @param {object} filters
   *   - type: 按事件类型过滤
   *   - source: 按来源 Agent 过滤
   *   - taskId: 按任务 ID 过滤
   * @returns {Array} 匹配的事件列表
   */
  query(filters = {}) {
    return this.events.filter((e) => {
      for (const [key, val] of Object.entries(filters)) {
        if (e[key] !== val) return false;
      }
      return true;
    });
  }

  /**
   * getAllOutputs — 获取所有子 Agent 的最终产出
   * （兼容旧 API，供 summaryPhase 使用）
   */
  getAllOutputs() {
    const outputs = {};
    for (const e of this.events) {
      if (e.type === "task.done" && e.taskId != null) {
        outputs[e.taskId] = e.payload;
      }
    }
    return outputs;
  }

  /**
   * subscribe — 订阅事件（stub，留待后续扩展）
   */
  subscribe(/* filter */) {
    /* 当前未启用，留待未来实现 */
  }
}

module.exports = { MessageBus };