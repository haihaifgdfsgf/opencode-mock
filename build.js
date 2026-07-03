/**
 * ============================================================================
 * build.js — 把 WIKI.md 渲染成精美的 HTML 静态页面
 * ============================================================================
 *
 * 【用法】
 *   node build.js
 *
 * 【产出】
 *   ../output/wiki/index.html  （项目本地）
 *   D:\nginx-1.27.3\html\index.html  （覆盖 nginx 默认欢迎页）
 *
 * 【样式特点】
 *   - GitHub 风格的 markdown 渲染
 *   - 代码高亮（highlight.js）
 *   - 左侧固定目录导航
 *   - 移动端响应式
 *   - 暗色模式跟随系统
 * ============================================================================
 */

const fs = require("fs");
const path = require("path");
const { marked } = require("marked");
const hljs = require("highlight.js");

// ────────────────────────────────────────────────────────────
// 1. 配置 marked
// ────────────────────────────────────────────────────────────
marked.setOptions({
  gfm: true,
  breaks: false,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch (e) {
        return code;
      }
    }
    return hljs.highlightAuto(code).value;
  },
});

// ────────────────────────────────────────────────────────────
// 2. 读取 WIKI.md 并转换
// ────────────────────────────────────────────────────────────
const wikiPath = path.join(__dirname, "WIKI.md");
const markdown = fs.readFileSync(wikiPath, "utf-8");
const htmlContent = marked.parse(markdown);

// ────────────────────────────────────────────────────────────
// 3. HTML 模板（带 GitHub 风格 + 侧边栏）
// ────────────────────────────────────────────────────────────
const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>OpenCode-Mock 架构教学 Wiki</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github-dark.min.css">
<style>
  :root {
    --bg-primary: #ffffff;
    --bg-secondary: #f6f8fa;
    --bg-code: #24292e;
    --text-primary: #1f2328;
    --text-secondary: #59636e;
    --border-color: #d1d9e0;
    --accent-color: #0969da;
    --link-color: #0969da;
    --shadow: 0 1px 3px rgba(31, 35, 40, 0.12);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --bg-code: #161b22;
      --text-primary: #e6edf3;
      --text-secondary: #8b949e;
      --border-color: #30363d;
      --accent-color: #58a6ff;
      --link-color: #58a6ff;
      --shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    }
  }

  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
                 "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif;
    line-height: 1.6;
    scroll-behavior: smooth;
  }

  /* ── 布局 ── */
  .layout {
    display: flex;
    max-width: 1400px;
    margin: 0 auto;
    padding: 0 24px;
    gap: 32px;
  }

  /* ── 侧边栏 ── */
  .sidebar {
    width: 280px;
    flex-shrink: 0;
    position: sticky;
    top: 0;
    height: 100vh;
    overflow-y: auto;
    padding: 32px 16px;
    border-right: 1px solid var(--border-color);
  }
  .sidebar h2 {
    font-size: 14px;
    text-transform: uppercase;
    color: var(--text-secondary);
    margin: 0 0 16px;
    letter-spacing: 0.05em;
  }
  .sidebar ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .sidebar li { margin: 4px 0; }
  .sidebar a {
    display: block;
    padding: 6px 12px;
    color: var(--text-secondary);
    text-decoration: none;
    border-radius: 6px;
    font-size: 14px;
    transition: all 0.15s ease;
  }
  .sidebar a:hover {
    background: var(--bg-secondary);
    color: var(--accent-color);
  }
  .sidebar .lvl-3 { padding-left: 28px; font-size: 13px; }
  .sidebar .lvl-4 { padding-left: 44px; font-size: 13px; }

  /* ── 主内容 ── */
  .content {
    flex: 1;
    padding: 48px 0 80px;
    max-width: 920px;
  }

  /* ── Markdown 元素 ── */
  h1, h2, h3, h4, h5 {
    color: var(--text-primary);
    font-weight: 600;
    line-height: 1.25;
    margin-top: 24px;
    margin-bottom: 16px;
  }
  h1 {
    font-size: 32px;
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 12px;
    margin-top: 0;
  }
  h2 {
    font-size: 24px;
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 8px;
    margin-top: 48px;
  }
  h3 { font-size: 20px; margin-top: 32px; }
  h4 { font-size: 17px; }
  h5 { font-size: 15px; }

  p { margin: 12px 0; }
  a {
    color: var(--link-color);
    text-decoration: none;
  }
  a:hover { text-decoration: underline; }

  ul, ol { padding-left: 28px; margin: 12px 0; }
  li { margin: 4px 0; }

  blockquote {
    margin: 16px 0;
    padding: 8px 16px;
    border-left: 4px solid var(--accent-color);
    background: var(--bg-secondary);
    color: var(--text-secondary);
    border-radius: 0 6px 6px 0;
  }

  code {
    background: var(--bg-secondary);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace;
    font-size: 0.9em;
  }

  pre {
    background: var(--bg-code);
    padding: 16px;
    border-radius: 8px;
    overflow-x: auto;
    line-height: 1.5;
    margin: 16px 0;
    box-shadow: var(--shadow);
  }
  pre code {
    background: transparent;
    padding: 0;
    color: #e6edf3;
    font-size: 13px;
  }

  table {
    border-collapse: collapse;
    margin: 16px 0;
    width: 100%;
  }
  th, td {
    border: 1px solid var(--border-color);
    padding: 8px 12px;
    text-align: left;
  }
  th {
    background: var(--bg-secondary);
    font-weight: 600;
  }

  hr {
    border: none;
    border-top: 1px solid var(--border-color);
    margin: 32px 0;
  }

  /* ── 锚点对齐 ── */
  h1, h2, h3, h4, h5 {
    scroll-margin-top: 24px;
  }

  /* ── 顶部 banner ── */
  .top-banner {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 24px 32px;
    margin: -48px -32px 32px;
    border-radius: 0 0 16px 16px;
  }
  .top-banner h1 {
    color: white;
    border: none;
    margin: 0 0 8px;
    font-size: 28px;
  }
  .top-banner p {
    margin: 4px 0;
    opacity: 0.95;
    font-size: 14px;
  }

  /* ── 移动端 ── */
  @media (max-width: 900px) {
    .layout { flex-direction: column; padding: 0 16px; }
    .sidebar {
      width: 100%;
      height: auto;
      position: relative;
      border-right: none;
      border-bottom: 1px solid var(--border-color);
      padding: 16px;
    }
    .content { padding: 24px 0 48px; }
  }
</style>
</head>
<body>
<div class="layout">
  <aside class="sidebar">
    <h2>📚 目录</h2>
    <ul id="nav"></ul>
  </aside>
  <main class="content">
    <div class="top-banner">
      <h1>🧠 OpenCode-Mock 架构教学 Wiki</h1>
      <p>面向 AI 智能体开发新手的多 Agent 协作教学文档</p>
      <p>预计阅读：45 分钟 + 30 分钟动手实验</p>
    </div>
    ${htmlContent}
  </main>
</div>

<script>
  // 自动生成侧边栏导航（从 h1/h2/h3 抽取）
  (function() {
    const nav = document.getElementById('nav');
    const headings = document.querySelectorAll('.content h1, .content h2, .content h3');

    headings.forEach((h, i) => {
      if (!h.id) {
        h.id = 'heading-' + i;
      }
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#' + h.id;
      a.textContent = h.textContent;
      a.className = 'lvl-' + h.tagName.substring(1);
      li.appendChild(a);
      nav.appendChild(li);
    });
  })();
</script>
</body>
</html>
`;

// ────────────────────────────────────────────────────────────
// 4. 输出文件
// ────────────────────────────────────────────────────────────

// 4.1 输出到项目本地（output/wiki/）
const localOutputDir = path.join(__dirname, "output", "wiki");
if (!fs.existsSync(localOutputDir)) {
  fs.mkdirSync(localOutputDir, { recursive: true });
}
const localOutputPath = path.join(localOutputDir, "index.html");
fs.writeFileSync(localOutputPath, fullHtml, "utf-8");
console.log(`✅ 已生成: ${localOutputPath}`);

// 4.2 部署到 nginx html 目录（覆盖默认欢迎页）
const nginxHtmlPath = "D:\\nginx-1.27.3\\html\\index.html";
try {
  fs.writeFileSync(nginxHtmlPath, fullHtml, "utf-8");
  console.log(`✅ 已部署到 nginx: ${nginxHtmlPath}`);
} catch (e) {
  console.log(`⚠️ 部署到 nginx 失败: ${e.message}`);
  console.log(`   请以管理员身份运行此脚本，或手动复制文件`);
  console.log(`   源文件: ${localOutputPath}`);
  console.log(`   目标: ${nginxHtmlPath}`);
}

console.log(`\n📏 文件大小: ${(fullHtml.length / 1024).toFixed(1)} KB`);
console.log(`\n🚀 下一步:`);
console.log(`   1. 启动 nginx: cd D:\\nginx-1.27.3 && start nginx`);
console.log(`   2. 浏览器访问: http://localhost`);