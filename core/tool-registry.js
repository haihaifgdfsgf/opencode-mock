/**
 * ============================================================================
 * ToolRegistry — 工具注册表（对齐 OpenCode 的 Tool 模型）
 * ============================================================================
 *
 * 每个工具是一个 {name, execute(args) -> Promise<string>} 的对象。
 * Registry 负责按名字查找并执行。
 *
 * 当前可用工具：
 *   - write_file: 把内容写入磁盘
 * ============================================================================
 */

const fs = require("fs");
const path = require("path");
const { loginHtmlContent } = require("../mock/llm-responses");

class ToolRegistry {
  constructor({ outputDir }) {
    this.outputDir = outputDir;
    this.tools = new Map();

    this.registerBuiltinTools();
  }

  registerBuiltinTools() {
    this.register({
      name: "write_file",
      description: "把内容写入指定路径的文件",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径" },
          content: { type: "string", description: "文件内容" },
        },
        required: ["path", "content"],
      },
      execute: async (args) => {
        // 路径安全校验：禁止写到 outputDir 之外
        const targetPath = path.isAbsolute(args.path)
          ? args.path
          : path.join(this.outputDir, "..", args.path);
        const normalized = path.resolve(targetPath);
        const outputDirResolved = path.resolve(this.outputDir);
        if (!normalized.startsWith(path.resolve(outputDirResolved, ".."))) {
          throw new Error(`拒绝写入目录外路径: ${args.path}`);
        }

        // 占位符替换（Mock 协议）：让真实 HTML 注入
        // 真实系统中 LLM 会直接产出完整 HTML，不需要这个
        let content = args.content;
        if (typeof content === "string" && content.includes("<!--HTML_HERE-->")) {
          content = content.replace("<!--HTML_HERE-->", loginHtmlContent);
        }

        const dir = path.dirname(normalized);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(normalized, content, "utf-8");
        return `文件已写入: ${normalized}（${content.length} 字符）`;
      },
    });
  }

  register(tool) {
    this.tools.set(tool.name, tool);
  }

  get(name) {
    return this.tools.get(name);
  }

  /**
   * execute — 执行指定工具
   * @returns {Promise<string>} 工具执行结果文本（喂回给 LLM）
   */
  async execute(name, args) {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`工具不存在: ${name}`);
    }
    return await tool.execute(args);
  }
}

module.exports = { ToolRegistry };