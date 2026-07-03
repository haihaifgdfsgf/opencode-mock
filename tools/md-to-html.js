/**
 * ============================================================================
 * md-to-html.js — Markdown → HTML 转换工具（冻结样式版）
 * ============================================================================
 *
 * 【目的】
 *   保证 Markdown → HTML 转换的样式 100% 一致，
 *   不会因为"让 AI 重新生成"而漂移。
 *
 * 【使用】
 *   node tools/md-to-html.js <input.md> [output.html]
 *
 *   示例：
 *     node tools/md-to-html.js WIKI.md              # 默认输出到 WIKI.html
 *     node tools/md-to-html.js WIKI.md docs/index.html
 *
 *   通过 npm scripts：
 *     npm run docs -- WIKI.md
 *
 * 【设计原则】
 *   1. CSS 永远从 tools/wiki.css 加载，不在脚本里写任何样式
 *   2. HTML 结构固定（侧栏 + 内容区 + 进度条 + JS）
 *   3. 唯一会变化的是 Markdown 解析后的 <body> 内容
 *   4. 不要在脚本里"优化"样式 — 如需改样式，改 wiki.css
 *
 * 【依赖】
 *   - marked: Markdown → HTML
 *   - highlight.js: 代码块语法高亮
 *   两者都在 package.json 的 dependencies 里
 * ============================================================================
 */

const fs = require("fs");
const path = require("path");
const { marked } = require("marked");
const hljs = require("highlight.js");

// ─── 配置 ───
const TOOLS_DIR = __dirname;
const PROJECT_ROOT = path.resolve(TOOLS_DIR, "..");
const CSS_SOURCE = path.join(TOOLS_DIR, "wiki.css");
const TEMPLATE_PATH = path.join(TOOLS_DIR, "template.html");

// ─── 解析参数 ───
// 行为约定：
//   npm run docs                       # 默认转 WIKI.md → output/wiki/index.html
//   npm run docs -- <input.md>         # 自定义输入，输出到 output/wiki/index.html
//   npm run docs -- <input.md> <out>   # 完全自定义输出路径
//   npm run docs -- README.md --no-default-out
//
// 设计意图：output/wiki/ 是"发布目录"，里面 index.html + wiki.css 是可直接
// 拷贝到任何静态服务器（nginx / GitHub Pages / CDN）的最终产物。
const args = process.argv.slice(2);
const noDefaultOut = args.includes("--no-default-out");
const cleanArgs = args.filter((a) => a !== "--no-default-out");

if (cleanArgs.length > 2) {
  console.error("❌ 参数过多");
  console.error("   用法: npm run docs                          # 默认转 WIKI.md");
  console.error("   用法: npm run docs -- <input.md>            # 自定义输入");
  console.error("   用法: npm run docs -- <input.md> <out.html> # 完全自定义");
  process.exit(1);
}

// 默认输入：项目根目录的 WIKI.md
const defaultInput = path.join(PROJECT_ROOT, "WIKI.md");

if (cleanArgs.length === 0) {
  if (fs.existsSync(defaultInput)) {
    cleanArgs.push(defaultInput);
    console.log(`ℹ️  未指定输入文件，默认使用: ${defaultInput}`);
  } else {
    console.error("❌ 用法: npm run docs -- <input.md> [output.html]");
    console.error("   示例: npm run docs -- WIKI.md");
    console.error("");
    console.error(`   也没找到默认文件 ${defaultInput}`);
    process.exit(1);
  }
}

const inputPath = path.resolve(cleanArgs[0]);

// 默认输出：output/wiki/index.html（发布就绪）
const DEFAULT_OUTPUT_DIR = path.join(PROJECT_ROOT, "output", "wiki");
const DEFAULT_OUTPUT_HTML = path.join(DEFAULT_OUTPUT_DIR, "index.html");

const outputPath = cleanArgs[1]
  ? path.resolve(cleanArgs[1])
  : noDefaultOut
    ? path.resolve(
        path.basename(inputPath, path.extname(inputPath)) + ".html",
      )
    : DEFAULT_OUTPUT_HTML;

if (!fs.existsSync(inputPath)) {
  console.error(`❌ 输入文件不存在: ${inputPath}`);
  process.exit(1);
}

// ─── CSS 引用策略 ───
// 优先使用外链（适合发布到静态服务器）：<link href="./wiki.css">
// 当用户显式指定了输出路径（不在默认 output/wiki/）时，仍可保持外链模式，
// 只要同目录下能找到 wiki.css 即可。
// 反之，使用内联 <style> 兜底，确保任何路径都能自包含运行。
function detectCssStrategy(htmlPath, cssPath) {
  const cssInSameDir =
    fs.existsSync(
      path.join(path.dirname(htmlPath), "wiki.css"),
    ) ||
    fs.existsSync(cssPath); // 源码也存在 ⇒ 内联

  return cssInSameDir ? "link" : "inline";
}

// ─── 配置 marked ───
marked.setOptions({
  gfm: true,
  breaks: false,
  highlight: function (code, lang) {
    if (lang === "ascii" || lang === "ascii-art") {
      // ascii-art 块不交给 hljs 高亮（保留原始字符）
      return code;
    }
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch (_) {}
    }
    try {
      return hljs.highlightAuto(code).value;
    } catch (_) {
      return code;
    }
  },
});

// marked 自定义渲染器
const renderer = new marked.Renderer();

// 全局 headings 列表：{ level, text, id, raw }，renderer 和 sidebar 共用同一份
const HEADINGS = [];

// id 别名表：alias_id -> 真实 heading id
// 在 parse 完成后由 buildIdMap() 填充，链接重写阶段查这里
// 一个 heading 可能有多种写法（WIKI.md 里手敲的、变体等），都映射到同一个权威 id
const ID_MAP = Object.create(null);

// 给所有 heading 自动生成稳定 id（中文+ASCII slug，同名时去重）
// 同时收集到 HEADINGS 供 sidebar 使用
//
// 规则（参考 GitHub slug 算法）：
//   1. 去掉 emoji
//   2. Unicode 类别切换时插入连字符：
//      - CJK 字符 (一-鿿)
//      - 拉丁字母/数字 (a-z A-Z 0-9)
//      - 其他空白/标点
//   3. 保留原始大小写信息（小写化为可选）
//   4. 非 [a-z 0-9 一-鿿 -] 的字符变成 -
//   5. 折叠连续连字符，去首尾
//
// 关键改进：之前 "ai-agent入门" 被错误合并，现在 "agent" 和 "入" 之间会插入 -
function slugifyHeading(text) {
  return String(text)
    .trim()
    // 1. 去掉 emoji（保留中文）
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    // 2. Unicode 类别切换插入连字符
    .replace(/([\u4e00-\u9fa5])([A-Za-z0-9])/g, "$1-$2")
    .replace(/([A-Za-z0-9])([\u4e00-\u9fa5])/g, "$1-$2")
    // 3. 空白字符变连字符
    .replace(/\s+/g, "-")
    // 4. 非合法字符变连字符
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9-]+/g, "-")
    // 5. 折叠 + 去首尾
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/**
 * normalizeSlug — 把任意 #anchor "压平"成最朴素的对照键，用于 alias 匹配
 *
 * 跟 slugifyHeading 的差别：
 *   - 不在 CJK 之间插入连字符（"第 2 章认识" 保持原样）
 *   - 非字母数字中文的字符（包括标点空格）一律删掉（不是变成 -）
 *   - 不做 toLowerCase 之外的折叠
 *
 * 思路：WIKI.md 里手敲的 anchor 常常是 "把章节文本原样小写化，去标点" 这种朴素规则。
 * 我们也给权威 id 跑一遍同样的朴素化，注册为别名，这样双向都能匹配。
 */
function normalizeSlug(text) {
  return String(text)
    .trim()
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "") // 去 emoji
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]+/g, "")            // 删标点空格
    .toLowerCase();
}

// 从 HEADINGS 构建 id 别名表
// 一个 heading 注册多个别名（兼容性是关键，WIKI.md 里手敲的 anchor
// 可能跟权威 slug 略有差异——比如没有把全角冒号当分隔符）：
//   - 权威 id 本身
//   - 同样规则跑 text 一次（去掉 emoji / 内联格式后的版本）
//   - 文本原样的"裸"版本（decodeURIComponent 后）
//   - normalizeSlug 跑 raw 和 text 各一次（最宽松的兜底）
function buildIdMap() {
  for (const h of HEADINGS) {
    ID_MAP[h.id] = h.id;

    const altFromText = slugifyHeading(h.text);
    if (altFromText) ID_MAP[altFromText] = h.id;

    // 原始文本直接放，方便链接写"中文文本"的情况
    ID_MAP[h.text] = h.id;

    // 宽松版：把权威 id 跑 normalizeSlug，再去权威 id 跑一次，注册成别名
    // 比如真实 id = "第-2-章-认识-opencode-mock"
    //      normalizeSlug = "第2章认识opencodelmock"
    // 任何 hand-written anchor 经过同样 normalizeSlug 也能匹配上
    const norm = normalizeSlug(h.id);
    if (norm) ID_MAP[norm] = h.id;

    // 再用 raw 和 text 也算一次（raw 含 # 号前缀，需要先剥掉）
    const rawCleaned = (h.raw || "").replace(/^#+\s*/, "");
    const normRaw = normalizeSlug(rawCleaned);
    if (normRaw) ID_MAP[normRaw] = h.id;
  }
}

// 把任意 #anchor 重写为权威 id：找不到就保持原样
// 关键策略：先原样查、再 decode、再 slugify、再 normalizeSlug
// 这样能兼容 WIKI.md 里手写的各种"近似 slug"
function resolveAnchor(anchor) {
  if (!anchor) return anchor;

  // 1. 原样查
  if (ID_MAP[anchor]) return ID_MAP[anchor];

  // 2. URL 解码后查
  let decoded = anchor;
  try {
    decoded = decodeURIComponent(anchor);
    if (decoded !== anchor && ID_MAP[decoded]) return ID_MAP[decoded];
  } catch (_) {}

  // 3. 跑一次 slugify 归一化（WIKI.md 里手敲的链接常见差异：
  //    多/少一个连字符、空格保留/去除、emoji 残留等）
  const normalized = slugifyHeading(decoded);
  if (normalized && ID_MAP[normalized]) return ID_MAP[normalized];

  // 4. 最宽松的兜底：normalizeSlug（直接删标点空格）
  const norm = normalizeSlug(decoded);
  if (norm && ID_MAP[norm]) return ID_MAP[norm];

  // 5. 终极兜底：去掉标点空格后的子串匹配
  // 只有在 DEBUG_REWRITE=1 时启用（避免误吞有效但错误的链接）
  if (process.env.DEBUG_REWRITE) {
    for (const [alias, real] of Object.entries(ID_MAP)) {
      // alias 已经是 normalizeSlug 过的（注册时跑过一次）
      // norm 是当前 anchor 的 normalizeSlug
      if (alias && (alias.includes(norm) || norm.includes(alias)) && norm.length >= 4) {
        console.log(`⚠️  fuzzy match: "${anchor}" -> "${real}" (via alias "${alias}")`);
        return real;
      }
    }
  }

  return anchor;
}

// 顶层 heading 渲染器：自动分配 id 并记录到 HEADINGS
// marked v18 的 heading 函数签名：({tokens, depth, raw, text})
//   - text: 已剥离 markdown 标记的纯文本
//   - raw:  原始 markdown 文本（含 #）
//   - depth: heading 层级 (1-6)
//   - tokens: inline tokens 数组（用于内容渲染）
renderer.heading = function ({ tokens, depth, raw, text }) {
  const safeText = (text == null ? "" : String(text)).trim();
  const rawText = String(raw === undefined ? safeText : raw);

  // 生成 slug，同名时去重
  const baseId = slugifyHeading(rawText) || `heading-${HEADINGS.length + 1}`;
  let id = baseId;
  let counter = 1;
  while (HEADINGS.some((h) => h.id === id)) {
    counter += 1;
    id = `${baseId}-${counter}`;
  }

  HEADINGS.push({ level: Number(depth), text: safeText, id });

  // 渲染 inline 内容（保留 **加粗** 等格式）
  const parsed = this.parser.parseInline(tokens);

  return `<h${depth} id="${escapeHtmlAttr(id)}">${parsed}</h${depth}>\n`;
};

// 给 ```ascii / ```ascii-art 代码块加 class
// marked v18: code({text, lang, escaped})
// 注意：marked v18 不接受"返回 false 走默认"——必须 return undefined
renderer.code = function ({ text, lang, escaped }) {
  const langName = (lang || "").trim().split(/\s+/)[0];
  if (langName === "ascii" || langName === "ascii-art") {
    return `<pre class="ascii-art"><code>${escaped ? text : escapeHtml(text)}</code></pre>\n`;
  }
  // 手动渲染默认代码块（marked 18.x + parse({renderer}) 下，
  // 返回 undefined / false / "" 都会被转成字符串"undefined"/"false"输出，
  // 没法靠 return false 触发默认行为，所以这里自己处理）
  const langClass = langName ? ` class="language-${langName}"` : "";
  const safeText = escaped ? text : escapeHtml(text);
  return `<pre><code${langClass}>${safeText}</code></pre>\n`;
};

// 给 blockquote 自动识别 callout（检测首字符 emoji）
// marked v18: blockquote({tokens})
renderer.blockquote = function ({ tokens }) {
  const innerHtml = this.parser.parse(tokens);
  // 检测 💡 / ⚠️ / ✅ / ❌ 等图标
  if (innerHtml.includes('💡')) return `<div class="callout callout-info">\n${innerHtml}</div>\n`;
  if (innerHtml.includes('⚠️')) return `<div class="callout callout-warning">\n${innerHtml}</div>\n`;
  if (innerHtml.includes('✅')) return `<div class="callout callout-success">\n${innerHtml}</div>\n`;
  // 默认 GitHub 风格 blockquote
  return `<blockquote>\n${innerHtml}</blockquote>\n`;
};

// 给所有 heading 自动注入 id 的辅助函数（已废弃，保留为空以防外部调用）
function collectHeadings(md) {
  HEADINGS.length = 0; // 重置
}

// ─── 读取输入 ───
console.log(`📄 读取 Markdown: ${inputPath}`);
const mdContent = fs.readFileSync(inputPath, "utf-8");

// ─── 转换 ───
console.log(`🔄 转换中...`);

// 关闭 marked 内置缓存，确保 renderer 一定会被触发
marked.setOptions({});

// 一次性解析：renderer.heading 会 push 到 HEADINGS，buildSidebar 直接读
HEADINGS.length = 0;
for (const k of Object.keys(ID_MAP)) delete ID_MAP[k];
let bodyHtml = marked.parse(mdContent, { renderer });

console.log(`   共找到 ${HEADINGS.length} 个 heading`);

// ─── 重写正文中的内部锚点链接 ───
// WIKI.md 里手写的目录链接（比如 `#-第-1-章ai-agent-入门`）可能跟我们的 slugify 算法不一致，
// 这里把所有 `href="#xxx"` 统一改写为权威 id。找不到的保持原样（不破坏外链）。
buildIdMap();
const fixed = rewriteAnchorLinks(bodyHtml);
if (fixed.count > 0) {
  console.log(`🔗 修正了 ${fixed.count} 个内部锚点链接`);
}
bodyHtml = fixed.html;

// 调试：打印 ID_MAP 前几条
if (process.env.DEBUG_IDMAP) {
  console.log("\n=== ID_MAP (first 10) ===");
  let i = 0;
  for (const [k, v] of Object.entries(ID_MAP)) {
    console.log(`  ${k} -> ${v}`);
    if (++i >= 10) break;
  }
  console.log("=== /ID_MAP ===\n");
}

/**
 * 把 body 里的所有 href="#xxx" 走 ID_MAP 重写
 * 返回 { html, count }
 */
function rewriteAnchorLinks(html) {
  let count = 0;
  const newHtml = html.replace(/href="#([^"]+)"/g, (match, anchor) => {
    const resolved = resolveAnchor(anchor);
    if (resolved !== anchor) {
      count += 1;
      return `href="#${escapeHtmlAttr(resolved)}"`;
    }
    return match;
  });
  return { html: newHtml, count };
}

// ─── CSS 处理：发布准备 ───
// 1. 源码 CSS 必须存在
// 2. 自动复制一份到输出目录的同侧（覆盖式，保证最新）
// 3. HTML 用 <link> 外链引用同一份 CSS（不是内嵌）
//    这样产物目录 (output/wiki/) 就是"发布包"，丢到任何静态服务器即可
if (!fs.existsSync(CSS_SOURCE)) {
  console.error(`❌ 样式文件不存在: ${CSS_SOURCE}`);
  console.error(`   这是关键文件，绝对不能丢失。`);
  process.exit(1);
}

const outputDir = path.dirname(outputPath);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// 复制 CSS 到输出目录（输出目录里叫 wiki.css，保持 URL 一致）
const cssTarget = path.join(outputDir, "wiki.css");
const cssContent = fs.readFileSync(CSS_SOURCE, "utf-8");
fs.writeFileSync(cssTarget, cssContent, "utf-8");
console.log(`📋 复制样式: ${CSS_SOURCE}`);
console.log(`        ->  ${cssTarget}`);

// ─── 生成最终 HTML ───
// 改用 <link rel="stylesheet" href="./wiki.css"> 外链
const title = path.basename(inputPath, path.extname(inputPath));
const finalHtml = buildHtml({ title, cssRef: "./wiki.css", body: bodyHtml });

// ─── 写入 ───
fs.writeFileSync(outputPath, finalHtml, "utf-8");

console.log(`✅ 生成完毕: ${outputPath}`);
console.log(`   文件大小: ${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB`);

/**
 * buildHtml — 把 Markdown 渲染结果 + 冻结的 CSS + JS 行为打包成完整 HTML
 *
 * 这是整个工具唯一会"拼接"HTML 的地方。
 * CSS / JS 全部从外部资源注入或写死在这里，body 只放 marked 渲染结果。
 */
function buildHtml({ title, css, cssRef, body }) {
  // 优先用 cssRef（外链），如果没传则内联（兜底）
  const styleBlock = cssRef
    ? `<link rel="stylesheet" href="${escapeHtmlAttr(cssRef)}">`
    : `<style>\n${css}\n</style>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  ${styleBlock}
</head>
<body>

<div class="progress-bar"><div class="progress-bar-fill" id="progress"></div></div>

<!-- ─── Sidebar ─── -->
<nav class="sidebar">
  <div class="sidebar-title">📚 目录</div>
  ${buildSidebar()}
</nav>

<!-- ─── Main Content ─── -->
<div class="main">
${body}
</div>

<!-- ─── Right-side TOC ─── -->
<aside class="toc-aside">
  <div class="toc-title">本页目录</div>
  ${buildTocAside()}
</aside>

<script>
  // Progress bar
  const progressFill = document.getElementById('progress');
  window.addEventListener('scroll', () => {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    progressFill.style.width = pct + '%';
  });

  // Highlight active nav item
  // 侧栏 + 右侧 TOC 的 active 高亮都交给 updateTocVisibility 的 scroll-spy 算法
  // 旧的 IntersectionObserver 移除（rootMargin 太严苛，h2 边界容易漏触发）

  // ─── 右侧 TOC：scroll-spy 决定当前 chapter + 当前 active 小节 ───
  const tocLinks = document.querySelectorAll('.toc-aside a[data-toc-link], .toc-aside a.is-chapter');
  const tocChapterMarkers = document.querySelectorAll('.toc-aside a[data-chapter-marker]');
  if (tocLinks.length > 0) {
    // 收集所有 chapter 标题元素（HTML 里真正的 h1）
    const chapterHeads = Array.from(tocChapterMarkers)
      .map(a => document.getElementById(a.getAttribute('data-chapter-marker')))
      .filter(Boolean);

    let activeChapterId = null;

    // 同步 sidebar 高亮（跟右侧 TOC 一致：scroll-spy 直接算当前 active heading）
  const sidebarNavLinks = document.querySelectorAll('.sidebar .nav-item');

  function updateTocVisibility() {
    // 根据 chapterHeads 的位置判断当前 chapter
    const scrollY = window.scrollY + 100; // 100px 偏移，提前切换
    let newChapter = null;
    for (const ch of chapterHeads) {
      if (ch.offsetTop <= scrollY) newChapter = ch;
      else break;
    }
    const newChapterId = newChapter ? newChapter.id : null;
    if (newChapterId !== activeChapterId) {
      activeChapterId = newChapterId;
      // 切换可见性：只显示当前 chapter 的项（含其 chapter 标题自身）
      tocLinks.forEach(link => {
        const linkChapter = link.dataset.chapter || link.dataset.chapterMarker;
        const visible = !linkChapter || linkChapter === newChapterId;
        link.style.display = visible ? '' : 'none';
        if (visible && newChapterId === linkChapter && link.classList.contains('is-chapter')) {
          // 当前 chapter 标题始终显在最上面，不加 active
          link.classList.remove('active');
        }
      });

      // 把当前 chapter 标题 scroll-into-view（限 toc-aside 容器内）
      const visibleChapterMark = document.querySelector(
        '.toc-aside a[data-chapter-marker="' + newChapterId + '"]'
      );
      if (visibleChapterMark) {
        const aside = visibleChapterMark.closest('.toc-aside');
        if (aside) {
          // 用 getBoundingClientRect 算相对 aside 视口的位置
          const linkRect = visibleChapterMark.getBoundingClientRect();
          const asideRect = aside.getBoundingClientRect();
          const relTop = linkRect.top - asideRect.top;
          // 仅当 chapter 标题在视口外才滚
          if (relTop < 0 || relTop > aside.clientHeight) {
            const desiredScrollTop =
              linkRect.top - asideRect.top + aside.scrollTop - 60;
            aside.scrollTop = Math.max(0, desiredScrollTop);
          }
        }
      }

      // ─── 同步左侧 sidebar：chapter 高亮 + 容器内滚动 ───
      // 用 [href="#chapterId"] 找 sidebar 里对应的 chapter 标题
      const sidebarChapter = newChapterId
        ? document.querySelector('.sidebar .nav-item.chapter[href="#' + newChapterId + '"]')
        : null;
      if (sidebarChapter) {
        // 高亮当前 chapter（与右侧 TOC 的 active 风格区分）
        document.querySelectorAll('.sidebar .nav-item.chapter').forEach(c => {
          c.classList.toggle('current-chapter', c === sidebarChapter);
        });
        // 容器内滚到该 chapter 顶部（用 getBoundingClientRect，比 offsetTop 准）
        const sidebar = sidebarChapter.closest('.sidebar');
        if (sidebar) {
          const linkRect = sidebarChapter.getBoundingClientRect();
          const sideRect = sidebar.getBoundingClientRect();
          const relTop = linkRect.top - sideRect.top;
          // 仅当 chapter 标题在 sidebar 视口外才滚
          if (relTop < 0 || relTop > sidebar.clientHeight) {
            const desiredScrollTop =
              linkRect.top - sideRect.top + sidebar.scrollTop - 16;
            sidebar.scrollTop = Math.max(0, desiredScrollTop);
          }
        }
      }
    }

    // 右侧 TOC：精细到 h2/h3/h4
    let activeItem = null;
    const allHeadings = document.querySelectorAll('.main h2[id], .main h3[id], .main h4[id]');
    for (const h of allHeadings) {
      if (h.offsetTop <= scrollY) activeItem = h;
      else break;
    }

    // 左侧 sidebar：只到 h2（因为 sidebar 没 h3+，下钻到 h3 会找不到对应元素）
    let activeH2 = null;
    const mainH2s = document.querySelectorAll('.main h2[id]');
    for (const h of mainH2s) {
      if (h.offsetTop <= scrollY) activeH2 = h;
      else break;
    }

    // 右侧 TOC 高亮 + 滚动 chapter
    tocLinks.forEach(link => link.classList.remove('active'));
    if (activeItem) {
      const tocActiveLink = document.querySelector(
        '.toc-aside a[data-toc-link="' + activeItem.id + '"]'
      );
      if (tocActiveLink) tocActiveLink.classList.add('active');
    }

    // 左侧 sidebar 高亮 + 滚动到 active h2（保证 sidebar 永远有匹配元素）
    sidebarNavLinks.forEach(link => link.classList.remove('active'));
    if (activeH2) {
      const targetHref = '#' + activeH2.id;
      const sidebarActiveLinks = document.querySelectorAll(
        '.sidebar .nav-item[href="' + targetHref + '"]'
      );
      sidebarActiveLinks.forEach(link => link.classList.add('active'));

      // 让 sidebar 内 active h2 贴顶
      const activeSidebarLink = sidebarActiveLinks[0];
      if (activeSidebarLink && !activeSidebarLink.classList.contains('chapter')) {
        const sidebar = activeSidebarLink.closest('.sidebar');
        if (sidebar) {
          const linkRect = activeSidebarLink.getBoundingClientRect();
          const sideRect = sidebar.getBoundingClientRect();
          const relTop = linkRect.top - sideRect.top;
          if (relTop < 16 || relTop > sidebar.clientHeight - 40) {
            const desiredScrollTop =
              linkRect.top - sideRect.top + sidebar.scrollTop - 16;
            sidebar.scrollTop = Math.max(0, desiredScrollTop);
          }
        }
      }
    }
  }

  window.addEventListener('scroll', updateTocVisibility, { passive: true });
  window.addEventListener('resize', updateTocVisibility);
  updateTocVisibility(); // 初始化
}
</script>
</body>
</html>`;
}

/**
 * buildSidebar — 从全局 HEADINGS 数组构造侧栏导航
 *
 * 数据来源：renderer.heading 在解析时已 push 到 HEADINGS
 * 这里不再扫描 HTML 字符串，避免双重解析 / id 不一致
 *
 * 规则：
 *   - h1 = 顶级章节分组（"📚 第 X 章：标题"）
 *   - h2 = 侧栏条目
 *   - h3+ 不进侧栏（避免太长）
 *   - 第一个 h1（通常是文档总标题）也展示
 */
function buildSidebar() {
  if (!HEADINGS || HEADINGS.length === 0) return "";

  // 按 h1 分组：每个 h1 group 包含后续所有 h2 直到下一个 h1
  const groups = [];
  let current = null;

  for (const h of HEADINGS) {
    if (h.level === 1) {
      current = { title: h.text, id: h.id, items: [] };
      groups.push(current);
    } else if (h.level === 2) {
      if (!current) {
        // 没有 h1 时，把 h2 也当顶级
        current = { title: null, id: null, items: [] };
        groups.push(current);
      }
      current.items.push({ id: h.id, text: h.text });
    }
    // h3+ 跳过（不进 sidebar）
  }

  let html_out = "";
  for (const g of groups) {
    html_out += `<div class="nav-group">\n`;
    if (g.id) {
      html_out += `  <a class="nav-item chapter" href="#${g.id}">${escapeHtml(g.title)}</a>\n`;
    }
    for (const item of g.items) {
      html_out += `  <a class="nav-item" href="#${item.id}">${escapeHtml(item.text)}</a>\n`;
    }
    html_out += `</div>\n`;
  }
  return html_out;
}

/**
 * buildTocAside — 渲染右侧浮动 TOC
 *
 * 设计：
 *   - 把全部 h2/h3/h4 都塞进 HTML（一份"完整目录"）
 *   - 加 data-chapter-id 标记每个 h2 属于哪个 chapter（h1）
 *     这样 JS 能根据当前可见的 chapter，折叠/隐藏不属于当前 chapter 的项
 *   - 第一个 h1 不算独立 chapter（用作文档总标题，不是"页"）
 *   - 没有 h1 的情况：全部 h2 视为独立 chapter
 */
function buildTocAside() {
  if (!HEADINGS || HEADINGS.length === 0) return "";

  // 先把 HEADINGS 按 h1 切分成 chapters
  // 规则：
  //   - 第一个 h1 之前的所有标题（"前言"）全部不进 TOC
  //   - 第一个 h1 是"文档总标题"，跳过（在它之前的 h2/h3 也不进 TOC）
  //   - 后续每个 h1 是一个 chapter
  //   - h2/h3/h4 归到当前 chapter
  const chapters = []; // [{ title, id, items: [{lvl, id, text}] }]
  let curChapter = null;
  let firstH1Passed = false;

  for (const h of HEADINGS) {
    if (h.level === 1) {
      if (!firstH1Passed) {
        firstH1Passed = true;
        continue; // 文档总标题，跳过
      }
      curChapter = { title: h.text, id: h.id, items: [] };
      chapters.push(curChapter);
    } else {
      // 总标题之前的所有标题都跳过（属于"前言"或目录本身，不重复展示）
      if (!firstH1Passed) continue;

      if (!curChapter) continue; // 保险

      if (h.level >= 2 && h.level <= 4) {
        curChapter.items.push({
          lvl: h.level,
          id: h.id,
          text: h.text,
        });
      }
      // h5+ 跳过
    }
  }

  // 如果没有任何 chapter fallback（纯 h2 文档），全部铺平
  if (chapters.length === 0) return "";

  // 渲染：每个 chapter 一组。每个 h2 上加 data-chapter-id，方便 JS 切换可见性
  let html_out = "";
  for (let ci = 0; ci < chapters.length; ci++) {
    const ch = chapters[ci];
    // chapter 标题（h2 级别，标记为 is-chapter）
    html_out += `<a class="lvl-2 is-chapter" href="#${ch.id}" data-chapter-marker="${ch.id}">${escapeHtml(ch.title)}</a>\n`;
    for (const it of ch.items) {
      // 标记属于哪个 chapter（用 h2 的 id 标记；h3/h4 继承最近 h2 的标记）
      // 这里简化：所有 items 的 data-chapter 用 chapter 自身的 id
      html_out += `<a class="lvl-${it.lvl}" href="#${it.id}" data-chapter="${ch.id}" data-toc-link="${it.id}">${escapeHtml(it.text)}</a>\n`;
    }
  }

  return html_out;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeHtmlAttr(text) {
  return escapeHtml(text);
}