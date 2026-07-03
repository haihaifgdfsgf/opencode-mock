/**
 * ============================================================================
 * Registry — Agent 和 Skill 的注册中心（对齐 OpenCode 的服务发现）
 * ============================================================================
 *
 * 提供：
 *   - Agent 注册和查询
 *   - Skill 注册和查询
 *   - Planner system prompt 渲染（注入可用 Agent 清单）
 * ============================================================================
 */

const { agentDefinitions } = require("../config/agents");
const { skillDefinitions } = require("../config/skills");

class Registry {
  constructor() {
    this.agents = agentDefinitions;
    this.skills = skillDefinitions;
  }

  /**
   * getAgentManifest — 获取所有"可被委派"的 Agent 清单
   *
   * 注意：排除 Planner 自己（Planner 是编排者，不能被自己委派）
   */
  getAgentManifest() {
    const manifest = [];
    for (const [name, config] of Object.entries(this.agents)) {
      if (name === "Planner") continue;
      manifest.push({
        name,
        description: config.description,
      });
    }
    return manifest;
  }

  getAgent(name) {
    return this.agents[name] || null;
  }

  getSkill(name) {
    return this.skills[name] || null;
  }

  /**
   * formatAgentManifestForPrompt — 把清单渲染成 Planner system prompt 的
   * {{available_agents}} 占位符
   */
  formatAgentManifestForPrompt() {
    const manifest = this.getAgentManifest();
    return manifest
      .map((item, index) => `${index + 1}. ${item.name}：${item.description}`)
      .join("\n");
  }

  /**
   * renderPlannerSystemPrompt — 把 Skill 里的 Planner system prompt 渲染完整
   *
   * 把 {{available_agents}} 占位符替换为真实的 Agent 清单。
   */
  renderPlannerSystemPrompt(skillName) {
    const skill = this.getSkill(skillName);
    if (!skill) throw new Error(`Skill "${skillName}" 未找到`);
    const manifest = this.formatAgentManifestForPrompt();
    return skill.plannerAgent.systemPrompt.replace(
      "{{available_agents}}",
      manifest,
    );
  }

  /**
   * getPlannerTools — 返回 Planner 可用的全部工具定义（含 task 工具）
   */
  getPlannerTools(skillName) {
    const skill = this.getSkill(skillName);
    if (!skill) throw new Error(`Skill "${skillName}" 未找到`);
    return [skill.taskToolDef];
  }
}

module.exports = { Registry };