/**
 * ============================================================================
 * LLM 模拟响应数据 — 按角色组织的多轮响应序列（对齐 ReAct 模式）
 * ============================================================================
 *
 * 【架构定位】
 * 真实 LLM Agent 是循环调用的：
 *   loop {
 *     response = llm.chat(messages)
 *     if (response.tool_calls) {
 *       execute tools, append results, continue
 *     } else {
 *       return response.content  // 最终答案
 *     }
 *   }
 *
 * 因此每个 Agent 类型需要一组"按轮次排列"的 Mock 响应：
 *   - 第 1 轮通常是"思考 + 调用工具"
 *   - 第 2 轮是"拿到工具结果后产出最终答案"
 *
 * 当前系统里三个 Agent 各有两种典型循环模式：
 *   - Planner：第 1 轮调用 task 工具委派给"产品经理"，第 2 轮再委派给"UI设计师"，第 3 轮返回最终汇总
 *   - 产品经理：通常 1 轮就直接产出 PRD（不需要工具）
 *   - UI设计师：第 1 轮思考，第 2 轮产出 HTML
 *
 * 工具调用采用 OpenAI tool_calls 格式（与真实 API 一致）。
 * ============================================================================
 */

// ────────────────────────────────────────────────────────────
// 工具定义（OpenAI function calling 格式）
// ────────────────────────────────────────────────────────────

const taskToolDef = {
  type: "function",
  function: {
    name: "task",
    description:
      "委派一个子任务给指定的 Agent 执行。该 Agent 会以全新的独立对话历史运行，完成后返回结果。",
    parameters: {
      type: "object",
      properties: {
        agentRole: {
          type: "string",
          description: "被委派的 Agent 角色名，必须从可用角色清单中选择",
        },
        prompt: {
          type: "string",
          description: "给该 Agent 的具体任务描述",
        },
      },
      required: ["agentRole", "prompt"],
    },
  },
};

const writeFileToolDef = {
  type: "function",
  function: {
    name: "write_file",
    description: "将内容写入指定路径的文件",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径" },
        content: { type: "string", description: "文件内容" },
      },
      required: ["path", "content"],
    },
  },
};

// ────────────────────────────────────────────────────────────
// Planner Agent 的响应序列（Orchestrator 本身也是一个 Agent）
// ────────────────────────────────────────────────────────────
// Planner 的工作流：
//   第 1 轮：思考用户需求，决定委派给产品经理
//   第 2 轮：拿到 PRD 后，决定委派给 UI设计师
//   第 3 轮：拿到 HTML 后，向用户输出最终汇总
const plannerResponses = [
  // ── 第 1 轮：委派给产品经理 ──
  {
    id: "chatcmpl-planner-1",
    object: "chat.completion",
    created: 0,
    model: "gpt-4o-mock",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content:
            "用户需要一个登录页面。按照 req-to-page 工作流，我先委派给产品经理输出 PRD。",
          tool_calls: [
            {
              id: "call_001",
              type: "function",
              function: {
                name: "task",
                arguments: JSON.stringify({
                  agentRole: "产品经理",
                  prompt:
                    "请根据用户的原始需求输出完整的产品规格说明书（PRD）。用户需求：" +
                    "帮我设计一个用户登录页面，包含用户名、密码输入和登录按钮",
                }),
              },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280 },
  },
  // ── 第 2 轮：拿到 PRD，委派给 UI设计师 ──
  {
    id: "chatcmpl-planner-2",
    object: "chat.completion",
    created: 0,
    model: "gpt-4o-mock",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "PRD 已经完成，现在委派给 UI设计师基于 PRD 输出 HTML 页面。",
          tool_calls: [
            {
              id: "call_002",
              type: "function",
              function: {
                name: "task",
                arguments: JSON.stringify({
                  agentRole: "UI设计师",
                  prompt:
                    "请根据以下产品经理产出的 PRD 设计登录页面 HTML：\n\n" +
                    "{{PRD_HERE}}",
                }),
              },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 400, completion_tokens: 100, total_tokens: 500 },
  },
  // ── 第 3 轮：拿到 HTML，向用户输出最终汇总 ──
  {
    id: "chatcmpl-planner-3",
    object: "chat.completion",
    created: 0,
    model: "gpt-4o-mock",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content:
            "任务全部完成。产品经理已产出完整 PRD，UI设计师已根据 PRD 设计并保存登录页面到 output/login.html。",
          tool_calls: null,
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 500, completion_tokens: 60, total_tokens: 560 },
  },
];

// ────────────────────────────────────────────────────────────
// 产品经理 Agent 的响应序列
// ────────────────────────────────────────────────────────────
// 产品经理通常一轮就产出 PRD（不需要工具调用）
const productManagerResponses = [
  // ── 第 1 轮：直接产出 PRD ──
  {
    id: "chatcmpl-pm-1",
    object: "chat.completion",
    created: 0,
    model: "gpt-4o-mock",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: `# 用户登录功能 - 产品规格说明书（PRD）

## 1. 功能概述
提供用户身份认证入口，验证用户凭据后授予系统访问权限。

## 2. 功能点列表

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 用户名输入 | 文本输入框，支持任意字符 | P0 |
| 密码输入 | 密码类型输入框，输入时隐藏 | P0 |
| 登录提交 | 点击后向后端发起认证请求 | P0 |
| 记住我 | 可选功能，保存登录状态 | P1 |
| 错误提示 | 登录失败时显示具体错误信息 | P0 |

## 3. 核心字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | 文本（string） | 是 | 用户唯一标识 |
| password | 密码（string） | 是 | 用户密码，传输需加密 |

## 4. 交互规则

1. 用户输入用户名和密码，点击登录按钮
2. 前端做基础空值校验
3. 校验通过后，向后端发送认证请求（POST /api/login）
4. 认证成功 → 跳转至仪表盘页面
5. 认证失败 → 在表单上方显示红色错误提示

## 5. 异常场景处理

| 场景 | 提示信息 |
|------|----------|
| 用户名为空 | "请输入用户名" |
| 密码为空 | "请输入密码" |
| 账号不存在 | "用户名或密码错误" |
| 密码错误 | "用户名或密码错误" |
| 网络超时/异常 | "网络异常，请稍后重试" |

## 6. 非功能性需求

- 页面加载时间 < 2秒
- 支持移动端适配
- 密码输入需做掩码处理

---
**文档状态**：✅ 已完成，等待进入UI设计阶段。`,
          tool_calls: null,
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 350, completion_tokens: 280, total_tokens: 630 },
  },
];

// ────────────────────────────────────────────────────────────
// UI设计师 Agent 的响应序列
// ────────────────────────────────────────────────────────────
// UI设计师会调用 write_file 工具保存 HTML
const uiDesignerResponses = [
  // ── 第 1 轮：调用 write_file 工具保存页面 ──
  {
    id: "chatcmpl-ui-1",
    object: "chat.completion",
    created: 0,
    model: "gpt-4o-mock",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_ui_001",
              type: "function",
              function: {
                name: "write_file",
                arguments: JSON.stringify({
                  path: "output/login.html",
                  content: "<!--HTML_HERE-->",
                }),
              },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 600, completion_tokens: 100, total_tokens: 700 },
  },
  // ── 第 2 轮：拿到工具结果，向 Planner 返回最终产物 ──
  {
    id: "chatcmpl-ui-2",
    object: "chat.completion",
    created: 0,
    model: "gpt-4o-mock",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content:
            "✅ 已完成登录页面设计，HTML 文件已写入 output/login.html。页面包含居中卡片布局、用户名/密码输入、登录按钮、错误提示区、记住我和忘记密码链接、表单验证、模拟登录交互（admin/123456）和响应式适配。",
          tool_calls: null,
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 700, completion_tokens: 120, total_tokens: 820 },
  },
];

// ────────────────────────────────────────────────────────────
// 实际写入文件的 HTML 内容（独立维护，便于复用）
// ────────────────────────────────────────────────────────────
const loginHtmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>用户登录</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(145deg, #f0f4f8 0%, #d9e2ec 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .login-card {
            background: #ffffff;
            border-radius: 24px;
            padding: 48px 40px 40px;
            width: 100%;
            max-width: 400px;
            box-shadow: 0 20px 60px rgba(0, 20, 40, 0.15);
        }
        .logo { text-align: center; margin-bottom: 32px; }
        .logo h1 { font-size: 28px; font-weight: 700; color: #0b1e33; }
        .logo p { color: #6b7a8f; font-size: 15px; margin-top: 6px; }
        .form-group { margin-bottom: 20px; }
        .form-group label { display: block; font-size: 14px; font-weight: 600; color: #1a2a3a; margin-bottom: 6px; }
        .form-group input {
            width: 100%;
            padding: 12px 16px;
            font-size: 15px;
            border: 2px solid #e2e8f0;
            border-radius: 12px;
            background: #fafcff;
            outline: none;
            transition: border-color 0.2s ease;
        }
        .form-group input:focus {
            border-color: #3b82f6;
            box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.15);
        }
        .error-message {
            background: #fef2f2;
            color: #dc2626;
            padding: 10px 14px;
            border-radius: 10px;
            font-size: 14px;
            margin-bottom: 16px;
            border-left: 4px solid #dc2626;
            display: none;
        }
        .error-message.show { display: block; }
        .login-btn {
            width: 100%;
            padding: 14px;
            background: #1a2a3a;
            color: #ffffff;
            font-size: 16px;
            font-weight: 600;
            border: none;
            border-radius: 12px;
            cursor: pointer;
            transition: background 0.2s ease;
        }
        .login-btn:hover { background: #0b1e33; }
        .login-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .extra-options {
            display: flex;
            justify-content: space-between;
            margin-top: 16px;
            font-size: 14px;
        }
        .extra-options label { display: flex; align-items: center; gap: 6px; color: #3d4e62; cursor: pointer; }
        .extra-options a { color: #3b82f6; text-decoration: none; font-weight: 500; }
        .footer-text { text-align: center; margin-top: 24px; font-size: 14px; color: #7a8a9e; }
        @media (max-width: 480px) { .login-card { padding: 32px 20px 28px; } }
    </style>
</head>
<body>
    <div class="login-card">
        <div class="logo">
            <h1>🚀 MyApp</h1>
            <p>欢迎回来，请登录您的账号</p>
        </div>
        <div id="errorMessage" class="error-message">
            ⚠️ <span id="errorText">用户名或密码错误</span>
        </div>
        <form id="loginForm" novalidate>
            <div class="form-group">
                <label for="username">用户名</label>
                <input type="text" id="username" placeholder="请输入用户名" />
            </div>
            <div class="form-group">
                <label for="password">密码</label>
                <input type="password" id="password" placeholder="请输入密码" />
            </div>
            <button type="submit" class="login-btn" id="loginBtn">登 录</button>
            <div class="extra-options">
                <label><input type="checkbox" id="rememberMe" /> 记住我</label>
                <a href="#">忘记密码？</a>
            </div>
        </form>
        <div class="footer-text">还没有账号？ <a href="#">立即注册</a></div>
    </div>

    <script>
        (function() {
            const form = document.getElementById('loginForm');
            const username = document.getElementById('username');
            const password = document.getElementById('password');
            const errorMessage = document.getElementById('errorMessage');
            const errorText = document.getElementById('errorText');
            const loginBtn = document.getElementById('loginBtn');

            function showError(msg) { errorText.textContent = msg; errorMessage.classList.add('show'); }
            function hideError() { errorMessage.classList.remove('show'); }

            form.addEventListener('submit', async function(e) {
                e.preventDefault();
                hideError();

                const user = username.value.trim();
                const pass = password.value.trim();

                if (!user) { showError('请输入用户名'); username.focus(); return; }
                if (!pass) { showError('请输入密码'); password.focus(); return; }

                loginBtn.disabled = true;
                loginBtn.textContent = '登录中...';
                await new Promise(r => setTimeout(r, 800));

                if (user === 'admin' && pass === '123456') {
                    hideError();
                    loginBtn.textContent = '✅ 登录成功！';
                    setTimeout(() => {
                        alert('🎉 登录成功！');
                        loginBtn.textContent = '登 录';
                        loginBtn.disabled = false;
                    }, 500);
                } else {
                    showError('用户名或密码错误');
                    loginBtn.textContent = '登 录';
                    loginBtn.disabled = false;
                }
            });

            username.addEventListener('input', hideError);
            password.addEventListener('input', hideError);
        })();
    </script>
</body>
</html>`;

module.exports = {
  plannerResponses,
  productManagerResponses,
  uiDesignerResponses,
  loginHtmlContent,
  taskToolDef,
  writeFileToolDef,
};