# 🧠 OpenCode-Mock 架构教学 Wiki 

> **目标读者**：AI 智能体开发新手
> **学习目标**：理解一个最简单 多Agent 系统的核心机制，能读懂 opencode-mock 的代码、能动手修改实验
> **预计阅读时间**：45 分钟 + 30 分钟动手

---

## 📑 目录

| 章节                                    | 标题                | 学完后你能回答的问题                                                               |
| ------------------------------------- | ----------------- | ------------------------------------------------------------------------ |
| [第 1 章](#第-1-章-ai-agent-入门)           | AI Agent 入门       | Agent 是什么？为什么要多 Agent？                                                   |
| [第 2 章](#第-2-章-认识-opencode-mock)      | 认识 opencode-mock  | 这个项目想模拟什么？它做了什么简化？                                                       |
| [第 3 章](#第-3-章-七大核心概念)                | 七大核心概念            | Planner、Agent、Session、ReAct、Tool、Task、MessageBus、**SessionStore** 各自是什么？ |
| [第 4 章](#第-4-章-项目代码地图)                | 项目代码地图            | 每个文件在哪个目录、干什么用的？                                                         |
| [第 5 章](#第-5-章-完整调用链路走读)              | 完整调用链路走读          | 从用户输入"帮我设计登录页"到 HTML 写盘，全程发生了什么？                                         |
| [第 5.5 章](#第-5-5-章-session-父子树与上下文继承) | Session 父子树与上下文继承 | Session 怎么形成层级？子 Agent 怎么"看到"父 Agent 的思考？                                |
| [第 6 章](#第-6-章-动手实验任务)                | 动手实验任务            | 怎么改一个 Agent？怎么加一个新角色？                                                    |
| [第 7 章](#第-7-章-常见误区与进阶方向)             | 常见误区与进阶方向         | 我容易踩什么坑？真实生产里还有什么？                                                       |
| [第 8 章](#第-8-章-大模型接口完全解析)            | 大模型接口完全解析         | OpenAI Chat Completions 的入参出参长什么样？tool_calls 怎么用？                      |

---

# 🎓 第 1 章：AI Agent 入门

## 1.1 什么是 AI Agent？

最朴素的理解：

> **Agent = 一个能用工具、能自主决策的 AI 程序。**

对比三种东西：

| 概念                 | 类比    | 特点                        |
| ------------------ | ----- | ------------------------- |
| **普通 LLM 调用**      | 问答机器人 | 你问一句，它答一句，结束              |
| **Agent**          | 实习生   | 你给个目标，它自己琢磨步骤、调工具、试错、最终交付 |
| **Multi-Agent 系统** | 项目团队  | 多个实习生分工协作，每人负责自己擅长的部分     |

我们这个项目，就是一个**最简 Multi-Agent 系统**——一个"小公司"。

## 1.2 为什么要多 Agent？

想象一下这个场景：用户说"帮我设计一个登录页"。

**单 Agent 方案**：一个全能型 AI

* 既要会写产品需求文档（PRD）
* 又要会设计界面、写 HTML/CSS/JS
* 还要会测试、调样式
* prompt 越长越混乱，越容易"啥都会但啥都不精"

**多 Agent 方案**（opencode-mock 用的）：

* **产品经理 Agent**：专门写 PRD，prompt 里只有"你是产品经理"那点事
* **UI 设计师 Agent**：专门写 HTML，prompt 里只有"你是设计师"那点事
* **Planner Agent**：不做具体工作，专门决定"这个活儿派给谁"

每个 Agent 的 prompt 都**短而专**，效果更好维护也更容易。

## 1.3 OpenCode 是什么？

**OpenCode** 是一个真实存在的开源 AI 编程助手（你可以在 GitHub 上找到它）。

它的核心架构就是**多 Agent 协作**，里面有个角色叫 **Sisyphus**（西西弗斯，希腊神话里推石头上山的人），扮演的就是"不停把任务派给别人"的角色。

我们的 `opencode-mock` 项目，就是用最简代码模拟 Sisyphus 的工作方式。

---

# 🎓 第 2 章：认识 opencode-mock

## 2.1 项目目标

> **用约 \~500 行 Node.js 代码，演示一个真实多 Agent 系统的核心调度机制。**

## 2.2 真实 vs Mock

| 维度      | 真实 OpenCode            | opencode-mock               |
| ------- | ---------------------- | --------------------------- |
| LLM     | 调用 GPT-4o / Claude API | 用 Mock 客户端返回预设答案            |
| 工具      | 真实执行 bash、写文件、跑命令      | write\_file 真实写文件，其他是 Mock  |
| Agent 数 | 几十个                    | 3 个（Planner + 产品经理 + UI设计师） |
| 任务复杂度   | 完整项目                   | 一个登录页                       |

**好消息**：因为 Mock 了 LLM，**你不用 API key 就能跑**，跑出来的结果完全可预测。

## 2.3 一句话总结项目架构

> **一个 Planner Agent 通过 `task` 工具委派子 Agent，每个 Agent 独立跑 ReAct 循环，通过 MessageBus 通信。**

别急，看完第 3 章你就懂了。

---

# 🎓 第 3 章：七大核心概念

这是最核心的一章。学完这一章，整个项目的代码对你来说就是"透明"的。

## 3.1 Agent（智能体）

### 定义

> **一个拥有独立对话历史、能调用工具、能自主决策的实体。**

### 在项目里看 Agent

打开 `config/agents.js`：

```javascript
// config/agents.js
const agentDefinitions = {
  Planner: {
    name: "Planner",
    description: "顶层编排 Agent，通过 task 工具委派子 Agent",
    systemPrompt: null,  // 由 Skill 注入
    tools: ["task"],
  },

  产品经理: {
    name: "产品经理",
    systemPrompt: `你是一名资深产品经理，拥有10年互联网产品经验...`,
    tools: [],
  },

  UI设计师: {
    name: "UI设计师",
    systemPrompt: `你是一名资深UI设计师...`,
    tools: ["write_file"],
  },
};
```

### 关键理解

**Planner 也是一个 Agent！**

它跟产品经理、UI设计师**结构上一模一样**，唯一的区别是它持有 `task` 工具，能"招聘"别人。别的 Agent 持有 `write_file` 工具，能"写文件"。

💡 **这个洞察极其重要**：在 OpenCode 体系里，所有 Agent **完全平等**，只是工具不同。Planner 不特殊，它就是个"持有一把特殊工具的 Agent"。

---

## 3.2 Session（会话）

### 定义

> **一个 Agent 私有的对话历史，并且和其他 Session 通过 `parentID` 形成一棵层级树。**

### 为什么需要它？

想象产品经理和 UI 设计师共用一个对话记录：

* 第 1 条："你是产品经理..."
* 第 2 条："现在你是 UI 设计师..."
* LLM 看着这个记录会很困惑："我到底是谁？"

**Session = 每个 Agent 一个独立的小本子**，各自记各自的对话。

### 在项目里看 Session

打开 `core/session.js`：

```javascript
class Session {
  constructor({ owner, systemPrompt, parentID, canDelegate, directory }) {
    this.id = randomUUID();                  // 这本子的编号（OpenCode ULID）
    this.parentID = parentID;                // 上级是谁（关键！建立父子树）
    this.owner = owner;                      // 这本子是谁的
    this.canDelegate = canDelegate;          // 能不能再委派给别人（防递归）
    this.directory = directory;              // 工作目录（子 Session 继承父）
    this.turn = 0;                           // 他思考过几次
    this.messages = [
      { role: "system", content: systemPrompt }  // 第 1 页永远是 system prompt
    ];
  }

  addUser(content) { /* 加一页 user 的发言 */ }
  addAssistant(content) { /* 加一页 assistant 的发言 */ }
  addToolResult(id, content) { /* 加一页工具执行结果 */ }
}
```

### 关键理解

| 概念          | 类比                        |
| ----------- | ------------------------- |
| Session     | 一个人的小本子                   |
| id          | 本子的编号（HR 系统里员工工号）         |
| parentID    | 直属上级的工号（汇报关系）             |
| messages    | 本子上按时间顺序记的对话              |
| owner       | 本子的主人                     |
| turn        | 他已经"翻过几次页"（调用过几次 LLM）     |
| canDelegate | 能不能派活给下属（只有 Planner=true） |

### Session 父子层级（对齐 OpenCode 真实实现）

真实 OpenCode 里，每个 Session 在创建时可以指定 `parentID`，形成一棵**调用树**：

```
🟢 ROOT Planner Session (canDelegate=true, parentID=null)
    │
    ├─ 产品经理 Session (canDelegate=false, parentID=planner_id)
    │
    ├─ UI设计师 Session (canDelegate=false, parentID=planner_id)
    │
    └─ 测试工程师 Session (canDelegate=false, parentID=planner_id)
```

关键规则（来自 OpenCode 源码 `Session.create`）：

1. **子 Session 禁止再委派**：`canDelegate=false`，调 task 工具会被拒绝  
   * 防止"产品经理 → 让 UI 设计师 → 让前端工程师 → 让设计师 → ..."无限递归
2. **子 Session 继承父的 directory**：避免 HTTP 模式下路径漂移（PR #30650）
3. **父 Session 可以持有所有子 Session 的 ID**：可随时回查下属历史

我们项目里跑一次 `node index.js`，最后打印的 Session 父子树长这样：

```
🟢 ROOT [ses_5c82ffb8cadd4cca] owner=Planner (canDelegate)
    messages=7, turn=3
   ├─ [ses_93e418db6a2540e6] owner=产品经理
   │   messages=3, turn=1
   ├─ [ses_f584f61b585e4142] owner=UI设计师
       messages=5, turn=2
```

---

## 3.2.1 SessionStore（会话存储服务）

### 定义

> **Session 的"数据库层"——负责 Session 的持久化、查询、父子关系导航。**

### 为什么需要它？

### 为什么需要它？

早期的 mock 项目把每个 Session 用 `session_<taskId>_<owner>_<时间戳>.json` 命名直接落盘，踩了几个坑：

* ❌ Session ID 不固定（用时间戳），每次重启都变，没法引用
* ❌ 文件名里塞不进 `parentID`，父子关系全丢
* ❌ 想查"Planner 有哪些子 Session"得扫所有 json 文件再正则匹配

所以我们做了一个 **Session 的"数据库层"**，专门管理这些会话：

* ✅ Session ID 在创建时生成（UUID），整个生命周期不变
* ✅ 每个 Session 一个 `<id>.json` 文件
* ✅ 文件内容里显式带 `parentID` 字段
* ✅ 提供 `children(parentID)` 这样的快速查询方法

### 接口对照

| 我们的 SessionStore   | 真实 OpenCode 的 Session.Service |
| ------------------ | ----------------------------- |
| register(session)  | Session.create({...})         |
| persist(session)   | 内部 SQLite INSERT              |
| get(sessionId)     | Session.get(id)               |
| children(parentID) | Session.children(parentID)    |
| root()             | Session.list({ roots: true }) |

当前 Session 文件命名规范：

| 文件名                         | 含义                                            |
| --------------------------- | --------------------------------------------- |
| `ses_<id>.json`             | 每个 Session 一个文件，`<id>` 是创建时生成的 UUID（永久不变） |
| 文件里的 `parentID` 字段       | 指向父 Session 的 `<id>`，建立父子树                  |
| 文件里的 `owner` 字段          | Session 归属哪个 Agent（Planner / 产品经理 / UI 设计师） |

---

## 3.2.2 上下文继承：子 Agent 怎么"看到"父 Agent 的思考？

### 核心矛盾

子 Session 有自己的独立 messages（这是 Session 隔离的原则），但完全切断了父子通信会让子 Agent 失去"为什么我要做这件事"的语境。

### OpenCode 的解决方案：compaction + 上下文注入

真实 OpenCode 的做法：

1. 父 Session 完成时，调一个内置的 `compaction` Agent 把历史压成摘要
2. 摘要塞进子 Session 的 initial prompt（作为上下文）
3. 子 Session 自己保留独立历史，不再回看父的原始消息

### 我们的实现

`core/context-summarizer.js` 负责把父 Session 压成结构化摘要：

```
## 上游上下文摘要 (parentSession: <id>, owner: Planner)

### 思考过程
- 第 1 轮：<每轮 assistant 的简短总结>
- 第 2 轮：...

### 关键决策
- 调用 `task`({"agentRole":"产品经理","prompt":"..."})
- 调用 `task`({"agentRole":"UI设计师","prompt":"..."})

### 最终产出
- Planner 给出任务完成总结
```

`SubAgentRunner` 在创建子 Session 时自动注入：

```javascript
// core/sub-agent-runner.js
const parentContextSummary = summarize(parentSession);
session.addUser(`${prompt}\n\n${parentContextSummary}`);
```

跑起来后，子 Agent 看到的 user prompt 长这样：

```
[1] user: 请根据以下产品经理产出的 PRD 设计登录页面 HTML：

## 上游上下文摘要 (parentSession: ses_5c82..., owner: Planner)
### 关键决策
- 调用 `task`({"agentRole":"产品经理","prompt":"..."})
```

**注意：子 Session 的 messages 里只有这段摘要，没有父 Session 的完整历史。** 这就是 OpenCode 的设计精髓——**父子通信是单向的、压缩的、有边界的**。

---

## 3.3 ReAct 循环（推理 + 行动）

### 定义

> **一种"调 LLM → 看它想干啥 → 干 → 再调 LLM → 再看 → ..."的循环模式，直到 Agent 自己说"我干完了"。**

### 为什么要循环？

因为一个 Agent 干一件事可能要分多步。比如 UI 设计师：

1. 思考：我得先写 HTML
2. 调 `write_file` 工具：把 HTML 写进去
3. 看工具结果：写成功了吗？
4. 思考：好，写完了，给个总结
5. 完成

如果只是"调一次 LLM → 拿答案"，那 Agent 就只能"问答"，没法"做事"。

### 在项目里看 ReAct

打开 `core/sub-agent-runner.js`，找到 `run` 方法里的 for 循环：

```javascript
// core/sub-agent-runner.js（简化）
for (let turn = 1; turn <= this.maxTurns; turn++) {
  // 1. 调 LLM
  const response = await this.llm.chat(session.getMessages(), {
    agentRole: "UI设计师",
  });

  // 2. 看 LLM 想干啥
  const toolCalls = response.choices[0].message.tool_calls;

  if (toolCalls) {
    // 3. LLM 想调工具 → 执行工具 → 把结果塞回 Session → 下一轮
    for (const call of toolCalls) {
      const result = await toolRegistry.execute(call.function.name, args);
      session.addToolResult(call.id, result);
    }
    continue; // 继续循环
  } else {
    // 4. LLM 觉得干完了 → 返回最终答案
    return response.choices[0].message.content;
  }
}
```

### 关键理解

**ReAct 是所有现代 AI Agent 的心脏。** 不管是 LangChain、AutoGPT 还是 OpenCode，核心都是这个循环。

💡 **ReAct vs 普通函数调用**：

* 普通函数：`调用 → 返回 → 调用 → 返回`，每一步你知道会发生啥
* ReAct：`调用 → AI 决定下一步干啥 → 可能调工具 → 再调 AI → ...`，每一步 AI 自己决定

---

## 3.4 Tool（工具）

### 定义

> **Agent 能调用的"能力函数"。每个工具就是一个 `name + execute(args)` 的对象。**

### 在项目里看工具

打开 `core/tool-registry.js`：

```javascript
// 内置工具：write_file
this.toolRegistry.register({
  name: "write_file",
  description: "把内容写入文件",
  parameters: { type: "object", properties: { ... } },
  execute: async (args) => {
    // 真的写文件到磁盘
    fs.writeFileSync(args.path, args.content);
    return "文件已写入";
  },
});
```

调用方式：

```javascript
const result = await toolRegistry.execute("write_file", {
  path: "output/login.html",
  content: "<html>...</html>"
});
```

### 关键理解

**Tool Registry = 工具的电话簿**。它就是个 `Map<name, tool>`，加个 `execute(name, args)` 函数。

💡 **task 工具和 write\_file 是同一个 Registry 里的"公民"**。

* Planner 调 `task`：触发的执行器会"启动子 Agent"
* UI 设计师调 `write_file`：触发的执行器会"写文件到磁盘"

Registry 不在乎——它就是个"按名字调用函数"的服务。

---

## 3.5 task 工具（最特殊的一个）

### 定义

> **Planner 专用的"调度工具"。调用它 = 启动一个子 Agent。**

### 为什么这么重要？

因为它是 **Agent 之间沟通的唯一通道**。

Planner 自己**不写 PRD、不写 HTML**。它只会调 task 工具：

```
Planner: "这个活儿派给产品经理"
         ↓
         task 工具被调用
         ↓
         SubAgentRunner 创建新产品经理 Session
         ↓
         产品经理跑自己的 ReAct 循环
         ↓
         干完了把结果作为 task 工具的返回值
         ↓
         Planner 收到结果，继续想下一步
```

### 在项目里看 task 工具

打开 `core/meta-agent.js`，构造函数里：

```javascript
// 注册一个虚拟的 "task" 工具：调用 SubAgentRunner
this.toolRegistry.register({
  name: "task",
  description: "把子任务委派给指定角色的 Agent",
  execute: async (args) => {
    // args: { agentRole, prompt }
    return await this.delegateTask(args);  // 真正的委派逻辑
  },
});
```

注意 `execute` 是个 `async` 函数，它可以调任何异步逻辑。在这里就是"启动一个全新的 Agent Session"。

---

## 3.6 MessageBus（消息总线）

### 定义

> **跨 Agent 通信的事件日志。是个 append-only 的事件流。**

### 为什么需要它？

因为每个 Agent 的 Session 是隔离的。Planner 看不到产品经理 Session 里的内容。

但 Planner 有时需要"引用"产品经理的产出（比如："PRD 已经好了，现在派给 UI 设计师，PRD 内容是..."）。这时需要一个**全局可访问的地方**让 Planner 查到。

### 在项目里看 MessageBus

打开 `core/message-bus.js`：

```javascript
publish(event) {
  // 任何人都可以发布事件
  this.events.push({ ...event, timestamp: Date.now() });
}

query(filters) {
  // 按条件查询历史事件
  return this.events.filter(e => matches(e, filters));
}
```

调用方式：

```javascript
// 产品经理完成时
this.messageBus.publish({
  type: "task.done",
  source: "产品经理",
  taskId: 1,
  payload: "# 用户登录功能 PRD..."
});

// Planner 需要查产品经理的产出
const pmOutputs = this.messageBus.query({ source: "产品经理" });
const prd = pmOutputs[0].payload;
```

### 关键理解

| 概念         | 类比        |
| ---------- | --------- |
| MessageBus | 公司公告板     |
| publish    | 贴一张通知     |
| query      | 翻看通知找自己要的 |

**它是"最终一致性"的**：Agent 完成工作时往里写，需要数据的 Agent 自己去查。没有任何"实时推送"。

---

## 3.7 七个概念的关系图

```
                    Planner Agent
                   ┌────────────────┐
                   │ plannerSession  │ ◄───── 这个 Agent 的私有记忆
                   │ id=ses_xxx      │        (id 永久不变)
                   │ parentID=null   │        (根 Session)
                   │ canDelegate=true│        (唯一能派活的)
                   │ - messages[]    │
                   └────────────────┘
                           │
                           │ 调 task 工具
                           ↓
                   ┌────────────────┐
                   │  ToolRegistry   │ ──► write_file 工具 ──► 写文件到磁盘
                   │  - task         │
                   │  - write_file   │
                   └────────────────┘
                           │
                           │ task 工具的执行器
                           ↓
                   ┌────────────────┐
                   │ SubAgentRunner  │ ──► 创建子 Agent 的 Session
                   │ +SessionStore   │      自动注入"父上下文摘要"
                   └────────────────┘
                           │
                           ↓
                    子 Agent（比如产品经理）
                   ┌────────────────┐
                   │  pmSession      │ ◄───── 独立的私有记忆
                   │ id=ses_yyy      │        (新生成的 ID)
                   │ parentID=ses_xxx│        (汇报关系：产品经理向 Planner 汇报)
                   │ canDelegate=false│       (不能再派活)
                   │ - messages[]    │
                   └────────────────┘
                           │
                           │ 持久化
                           ↓
                   ┌────────────────┐
                   │  SessionStore   │ ──► output/sessions/<id>.json
                   │  - register     │      (含 parentID 字段)
                   │  - persist      │
                   │  - get          │
                   │  - children     │      ← 按 parentID 查所有子 Session
                   │  - root         │
                   └────────────────┘
                           │
                           │ 完成后 publish
                           ↓
                   ┌────────────────┐
                   │  MessageBus     │ ──► Planner 可以 query
                   │  - events[]      │
                   └────────────────┘
```

**关键机制**：

* 每个 Session 有永久 ID（创建时生成 UUID，不再用时间戳命名）
* 父子 Session 通过 `parentID` 形成可追溯的调用树
* 子 Agent 启动时自动拿到"父上下文摘要"（不靠 MessageBus 凑）
* SessionStore 提供类数据库的查询接口（children / root / get）

---

# 🎓 第 4 章：项目代码地图

## 4.1 文件总览

```
opencode-mock/
├── index.js                  ← 入口
├── config/                   ← 配置（Agent 和 Skill 的定义）
│   ├── agents.js
│   └── skills.js
├── core/                     ← 核心机制
│   ├── meta-agent.js         ← Planner Agent
│   ├── sub-agent-runner.js   ← 子 Agent 运行器（含 ReAct 循环）
│   ├── session.js            ← 对话会话
│   ├── message-bus.js        ← 消息总线
│   ├── tool-registry.js      ← 工具注册表
│   ├── registry.js           ← Agent/Skill 注册中心
│   ├── session-store.js      ← Session 持久化服务
│   └── context-summarizer.js ← 父 Session 摘要生成器
└── mock/                     ← Mock LLM
    ├── llm-client.js         ← 模拟 LLM 客户端
    └── llm-responses.js      ← 预设的 Mock 响应
```

## 4.2 入口和配置层

### `index.js`（49 行）

**作用**：启动入口。创建一个 MetaAgent，喂给它用户输入。

**关键代码**：

```javascript
const metaAgent = new MetaAgent();
await metaAgent.execute("帮我设计一个用户登录页面...");
```

### `config/agents.js`（119 行）

**作用**：定义所有 Agent 的"人格"。

**看什么**：

* `Planner`：没有 systemPrompt，由 Skill 注入
* `产品经理`：写 PRD 的人格
* `UI设计师`：写 HTML 的人格 + 持有 `write_file` 工具

### `config/skills.js`（107 行）

**作用**：定义"工作流契约"——Planner 怎么思考、有什么工具。

**看什么**：

* `plannerAgent.systemPrompt`：Planner 的人格（注入 Agent 清单）
* `taskToolDef`：Planner 用的 task 工具定义

## 4.3 核心机制层（最复杂）

### `core/meta-agent.js`（249 行）⭐ 必读

**作用**：实现 Planner Agent。

**关键方法**：

* `constructor()`：初始化所有依赖 + 注册 `task` 工具
* `execute(userInput)`：Planner 的 ReAct 循环
* `delegateTask(args)`：task 工具的执行器（启动子 Agent）

### `core/sub-agent-runner.js`（179 行）⭐ 必读

**作用**：实现子 Agent 的 ReAct 循环。

**关键方法**：

* `run({agentRole, prompt})`：启动一个子 Agent，跑完返回结果
* `persistSession()`：把 Session 保存到磁盘

### `core/session.js`

**作用**：独立对话会话。

**关键字段**：

* `id`：Session 永久 ID（UUID）
* `parentID`：父 Session 的 ID（建立父子层级）
* `canDelegate`：是否能再 task 委派（防递归）
* `directory`：工作目录（子 Session 继承父）

**关键方法**：

* `addUser / addAssistant / addToolResult`：往消息列表追加消息
* `compact()`：超过 20 条消息时压缩（对齐真实 OpenCode 的 `/compact`）
* `snapshot()`：序列化为可持久化的对象

### `core/session-store.js`⭐ 必读

**作用**：Session 的"数据库层"，对齐真实 OpenCode 的 `Session.Service`。

**关键方法**：

* `register(session)`：注册 Session 到内存索引
* `persist(session)`：Session 落盘到 `<id>.json`
* `get(sessionId)`：按 ID 取 Session（未在内存则从磁盘恢复）
* `children(parentID)`：查一个 Session 的所有子 Session（关键查询）
* `root()`：取根 Session（parentID=null）

### `core/context-summarizer.js`⭐ 必读

**作用**：把父 Session 的对话历史压缩成结构化摘要。

**关键函数**：

* `summarize(parentSession)`：从 messages 提取"思考过程 / 关键决策 / 最终产出"，输出 Markdown

**这是 OpenCode 上下文继承的核心机制**：子 Agent 不直接读父 Session 的原始 messages，而是读这段压缩后的摘要——既隔离了状态，又保留了"为什么做这件事"的语境。

### `core/message-bus.js`

**作用**：事件流。

**关键方法**：

* `publish(event)`：发事件
* `query(filters)`：按条件查事件

### `core/tool-registry.js`

**作用**：工具字典。

**关键方法**：

* `register(tool)`：注册工具
* `execute(name, args)`：执行工具

### `core/registry.js`

**作用**：Agent 和 Skill 的注册中心。

**关键方法**：

* `getAgent(name)`：按名字查 Agent
* `getSkill(name)`：按名字查 Skill
* `renderPlannerSystemPrompt()`：把 Agent 清单注入 Planner 的 prompt

## 4.4 Mock 层

### `mock/llm-client.js`

**作用**：模拟 LLM API 调用。

**关键方法**：

* `chat(messages, options)`：返回预设响应
* 路由逻辑：根据 `agentRole + turn` 决定返回哪条 Mock

### `mock/llm-responses.js`（467 行）

**作用**：所有预设响应。

**看什么**：

* `plannerResponses`：Planner 的 3 轮响应（委派→再委派→汇总）
* `productManagerResponses`：产品经理的 1 轮响应（产出 PRD）
* `uiDesignerResponses`：UI设计师的 2 轮响应（调工具→拿结果）

---

# 🎓 第 5 章：完整调用链路走读

我们跟着一个真实运行，把每一步对应到代码。

**场景**：用户输入 `帮我设计一个用户登录页面，包含用户名、密码输入和登录按钮`

## 5.1 启动阶段

```
index.js:38  →  metaAgent.execute(userInput)
                 ↓
meta-agent.js:87  →  Planner 创建 Session（接入 SessionStore）
                       this.plannerSession = new Session({
                         owner:"Planner",
                         parentID: null,             // 根 Session
                         canDelegate: true,          // Planner 唯一能派活的
                       })
                       this.sessionStore.register(plannerSession)
                       this.sessionStore.persist(plannerSession)
                       → output/sessions/ses_<id>.json
```

**发生了什么**：

1. MetaAgent 构造函数已经初始化好 Registry、MessageBus、ToolRegistry、SessionStore 等所有依赖
2. MetaAgent.execute() 拿到用户输入后，**给 Planner 创建了一个独立 Session**
3. Planner Session 的关键字段：  
   * `id`：新生成的 UUID（永久不变）  
   * `parentID`：null（根 Session）  
   * `canDelegate`：true（唯一能调 task 工具的 Session）
4. Session 立刻落盘到 `output/sessions/ses_<id>.json`
5. Planner Session 的 messages 数组现在是：  
```javascript  
[  
  { role: "system", content: "你是一个资深的项目编排 Agent..." },  
  { role: "user", content: "帮我设计一个用户登录页面..." }  
]  
```

## 5.2 Planner 第 1 轮 LLM 调用

```
meta-agent.js:110  →  this.llm.chat(plannerSession.getMessages(), {agentRole: "Planner"})
                       ↓
mock/llm-client.js  →  根据 agentRole="Planner" + turn=1 返回 plannerResponses[0]
                       ↓
返回：tool_calls: [{ name: "task", arguments: '{"agentRole":"产品经理", ...}' }]
```

**Planner 的"思考过程"**：

* 输入：用户想要登录页
* 输出："我得让产品经理先写 PRD"

Planner 没法"自己写 PRD"——它没那个能力。它的工具集只有 `task`，所以它必须用这个工具。

## 5.3 执行 task 工具（启动产品经理）

```
meta-agent.js:138  →  toolRegistry.execute("task", {agentRole:"产品经理", prompt:"..."})
                       ↓
                    MetaAgent.delegateTask(args)
                       ↓
meta-agent.js:173  →  delegateTask() 创建 taskId=1，调用 subAgentRunner.run()
                       ↓
sub-agent-runner.js:104  →  SubAgentRunner.run()
                            1. 查 registry 找到产品经理的 systemPrompt
                            2. 创建新的 Session：new Session({owner:"产品经理"})
                            3. pmSession.addUser(prompt)
                            4. 进入 ReAct 循环
```

**关键**：这里**新建了一个 Session**！Planner 的 Session 和产品经理的 Session 是两个独立的对象。

## 5.4 产品经理 ReAct 循环

```
sub-agent-runner.js:115  →  for (let turn=1; turn<=5; turn++) {
                              response = llm.chat(pmSession.getMessages(), {agentRole:"产品经理"})
                              if (response.tool_calls) { ... }   // 没有工具
                              else { return response.content; }   // 直接产出 PRD
                            }
```

**产品经理的"思考过程"**：

* 输入：原始需求
* 输出：一段完整的 PRD（无 tool\_calls）

因为产品经理的 tools 是空数组 `[]`，它**永远不会有 tool\_calls**，永远一轮就返回。

## 5.5 Planner 收到产品经理产出

```
sub-agent-runner.js:165  →  messageBus.publish({type:"task.done", source:"产品经理", taskId:1, payload: PRD})
                            持久化产品经理 Session 到磁盘
                            return PRD
                       ↓
meta-agent.js:143  →  plannerSession.addToolResult(call.id, PRD)
```

**Planner Session 现在的样子**：

```javascript
[
  { role: "system", content: "Planner 人格..." },
  { role: "user", content: "原始需求" },
  { role: "assistant", content: "我得让产品经理先写 PRD", tool_calls: [...] },
  { role: "tool", content: "# 用户登录功能 PRD..." }
]
```

**工具结果作为 `role: "tool"` 的消息塞进了 Planner 的对话历史**。这就是 OpenAI 的 tool message 格式。

## 5.6 Planner 第 2 轮 LLM 调用

Planner 带着"PRD 已完成"的新上下文再次调 LLM：

```
meta-agent.js:110  →  llm.chat(plannerSession.getMessages(), {agentRole:"Planner", sessionState:{turn:2}})
                       ↓
返回：tool_calls: [{ name: "task", arguments: '{"agentRole":"UI设计师", "prompt":"...{{PRD_HERE}}"}' }]
```

**Planner 的"思考过程"**：

* 输入：PRD 内容
* 输出："PRD 写好了，该让 UI 设计师做页面了"

注意 prompt 里有个奇怪的 `{{PRD_HERE}}`——这是一个**占位符**，会在 delegateTask 时被替换成真实的 PRD。这是 Mock 系统的协议，真实 OpenCode 里不会有（真实 LLM 会自己写完整 prompt）。

## 5.7 启动 UI 设计师

```
meta-agent.js:173  →  delegateTask()
                       处理 {{PRD_HERE}} → 从 messageBus 查产品经理的产出 → 替换占位符
                       taskId=2, subAgentRunner.run(agentRole="UI设计师", prompt="...真实PRD...")
                       ↓
sub-agent-runner.js:115  →  UI设计师 ReAct 循环开始
```

**这次不一样了**！UI 设计师的工具集里有 `write_file`，所以它会触发工具调用。

## 5.8 UI 设计师第 1 轮：调 write\_file

```
sub-agent-runner.js:121  →  llm.chat(uiSession.getMessages(), {agentRole:"UI设计师"})
                       ↓
返回：tool_calls: [{ name: "write_file", arguments: '{"path":"output/login.html", "content":"<!--HTML_HERE-->"}' }]
```

**UI 设计师的"思考过程"**：

* 输入：PRD + 自己的 system prompt
* 输出："我得调 write\_file 工具把 HTML 写进去"

content 里的 `<!--HTML_HERE-->` 是另一个占位符，在 `toolRegistry.execute("write_file", ...)` 时被替换为真实的 HTML 内容。

## 5.9 执行 write\_file 工具（真写文件）

```
sub-agent-runner.js:135  →  toolRegistry.execute("write_file", args)
                       ↓
tool-registry.js  →  write_file.execute(args):
                     1. 替换 <!--HTML_HERE--> → 真实 HTML
                     2. fs.writeFileSync("output/login.html", htmlContent)
                     3. return "文件已写入..."
```

**这是整个系统里**唯一真正产生副作用**的地方**——文件被写到了磁盘上。

## 5.10 UI 设计师第 2 轮：返回摘要

```
sub-agent-runner.js:121  →  llm.chat(uiSession.getMessages(), {agentRole:"UI设计师", sessionState:{turn:2}})
                       ↓
这次 messages 里多了一条 {role:"tool", content:"文件已写入..."}
                       ↓
返回：content = "✅ 已完成登录页面设计，HTML 文件已写入..."
```

**UI 设计师的"思考过程"**：

* 输入：刚才的写文件结果
* 输出：给 Planner 一个简短摘要

**注意**：这次没有 tool\_calls，所以 ReAct 循环 `break`，UI 设计师结束。

## 5.11 Planner 第 3 轮：输出汇总

```
meta-agent.js:110  →  llm.chat(plannerSession.getMessages(), {agentRole:"Planner", sessionState:{turn:3}})
                       ↓
返回：content = "任务全部完成。产品经理已产出 PRD，UI 设计师已保存 HTML..."
                       ↓
meta-agent.js:149  →  plannerSession.addAssistant(content)
                       finalOutput = content
                       break
```

**Planner 的"思考过程"**：

* 输入：UI 设计师的摘要
* 输出："所有任务都完成了，给用户做个汇总"

没有 tool\_calls，ReAct 循环 break，整个流程结束。

## 5.12 全程调用次数统计

| # | 谁调用     | 干了什么            |
| - | ------- | --------------- |
| 1 | Planner | 思考 + 调 task     |
| 2 | 产品经理    | 直接产出 PRD        |
| 3 | Planner | 拿到 PRD + 调 task |
| 4 | UI设计师   | 调 write\_file   |
| 5 | UI设计师   | 拿到工具结果 + 返回摘要   |
| 6 | Planner | 拿到摘要 + 输出最终汇总   |

**6 次 LLM 调用 = 1 个完整的 Planner ReAct + 2 个子 Agent ReAct**

---

# 🎓 第 5.5 章：Session 父子树与上下文继承

> **本章重点**。如果你只想搞懂"父子 Session 怎么通信"，看这一章就够。

## 5.5.1 最终形成的 Session 树

跑完一次 `node index.js`，最后一次打印长这样：

```
🌳 Session 父子树
────────────────────────────────────────────────────────────
🟢 ROOT [ses_5c82ffb8cadd4cca] owner=Planner (canDelegate)
    messages=7, turn=3
   ├─ [ses_93e418db6a2540e6] owner=产品经理
   │   messages=3, turn=1
   ├─ [ses_f584f61b585e4142] owner=UI设计师
       messages=5, turn=2
```

这棵树完全对齐真实 OpenCode 的 Session 层级：

* ROOT 是 Planner（`parentID=null`、`canDelegate=true`）
* 产品经理和 UI 设计师挂在 Planner 下（`parentID=Planner.id`、`canDelegate=false`）
* 任意子 Session 都能通过 `parentID` 字段向上回溯

## 5.5.2 落盘文件结构

`output/sessions/` 目录：

```
ses_5c82ffb8cadd4cca.json    ← Planner（7 条消息，3 轮）
ses_93e418db6a2540e6.json    ← 产品经理（3 条消息，1 轮）
ses_f584f61b585e4142.json    ← UI设计师（5 条消息，2 轮）
```

每个文件用 Session ID 命名（永久不变），里面带：

```json
{
  "id": "ses_93e418db6a2540e6",
  "parentID": "ses_5c82ffb8cadd4cca",      ← 关键
  "owner": "产品经理",
  "canDelegate": false,                    ← 关键
  "directory": "C:\\Users\\A\\Desktop\\opencode-mock",
  "turn": 1,
  "messages": [...]
}
```

**对比两种命名风格**：

| 命名风格         | 示例                                          | parentID |
| ------------ | ------------------------------------------- | -------- |
| 时间戳命名（不推荐）   | `session_1_产品经理_1782544012636.json`        | ❌ 文件名里没有 |
| UUID 命名（当前用） | `ses_93e418db6a2540e6.json`                  | ✅ 写在文件内容里 |

UUID 命名的好处：

* ✅ ID 在创建时一次性生成，整个生命周期不变，可重复引用
* ✅ 文件名固定跨重启，方便调试和日志回溯
* ✅ `parentID` 等结构化字段全部写在 JSON 里，便于程序读取

## 5.5.3 上下文继承流程（最关键的链路）

Planner 委派 UI 设计师时，UI 设计师的 Session 第一条 user 消息长这样：

```
请根据以下产品经理产出的 PRD 设计登录页面 HTML：

## 上游上下文摘要 (parentSession: ses_5c82ffb8cadd4cca, owner: Planner)

### 思考过程
- 第 1 轮：用户需要一个登录页面。按照 req-to-page 工作流，我先委派给产品经理输出 PRD。

### 关键决策
- 调用 `task`({"agentRole":"产品经理","prompt":"请根据用户的原始需求输出完整的产品规格说明书（PRD）..."})
- 调用 `task`({"agentRole":"UI设计师","prompt":"请根据以下产品经理产出的 PRD 设计登录页面 HTML..."})

### 最终产出
- （尚在进行中）
```

这段摘要由 `core/context-summarizer.js` 的 `summarize(plannerSession)` 生成。

## 5.5.4 完整代码调用链

```
MetaAgent.execute()
  │
  ├─ 创建 Planner Session (parentID=null, canDelegate=true)
  │    └─ sessionStore.persist()
  │
  ├─ Planner LLM 第 1 轮 → tool_call(task)
  │
  ├─ MetaAgent.delegateTask(args)
  │    ├─ summarize(this.plannerSession)    ← 把 Planner 历史压成摘要
  │    │
  │    └─ SubAgentRunner.run({
  │         agentRole: "产品经理",
  │         parentSession: this.plannerSession,  ← 父 Session 引用
  │         parentContextSummary: <摘要>,        ← 自动注入
  │       })
  │         ├─ new Session({ parentID: planner.id, canDelegate: false })  ← 关键
  │         │    └─ sessionStore.persist()
  │         ├─ session.addUser(`${prompt}\n\n${parentContextSummary}`)
  │         ├─ 子 Agent 的 ReAct 循环
  │         └─ sessionStore.persist()  ← 每轮都落盘
  │
  └─ ...（更多委派同理）
```

## 5.5.5 防递归：子 Session 为什么不能调 task

`SubAgentRunner` 在执行 `task` 工具时加了守卫：

```javascript
// core/sub-agent-runner.js
for (const call of toolCalls) {
  if (call.function.name === "task") {
    session.addToolResult(
      call.id,
      `❌ 子 Agent 不能调用 task 工具（OpenCode 默认 deny，防止无限递归）`,
    );
    continue;
  }
}
```

这是对齐 OpenCode 的默认权限规则：

```typescript
// 真实 OpenCode 的 SubAgentSession 创建逻辑
permission: [
  { permission: "task", pattern: "*", action: "deny" },  // ← 默认禁止嵌套
  ...
]
```

**为什么必须禁止？** 假如允许：

```
Planner → 产品经理 → UI 设计师 → 子 UI 设计师 → 子子 UI 设计师 → ...
```

会出现：

1. 无限递归（栈溢出 / token 爆炸）
2. 权限混乱（深层子 Agent 到底受谁的限制？）
3. 调试噩梦（不知道哪个 Agent 在干哪个活）

---

# 🎓 第 6 章：动手实验任务

光看不动手永远学不会。来做几个练习。

## 实验 1：跑起来看输出（5 分钟）

```bash
cd opencode-mock
npm run start
```

观察：

1. 总共几次"📞 第 N 次大模型调用"？
2. 每次的请求消息是什么？
3. 哪些次调用有 `tool_calls`？

## 实验 2：修改 Planner 的 system prompt（10 分钟）

打开 `config/skills.js`，找到 `plannerAgent.systemPrompt`，在末尾加一句：

```javascript
"另外，记住：每完成一个子任务后，要先简单总结一下该任务的产出。"
```

再跑一遍，看 Planner 行为有没有变化。

💡 这就是 Prompt Engineering——改 system prompt 就能改 Agent 行为。

## 实验 3：加一个新角色（30 分钟）⭐ 推荐

目标：加一个"测试工程师" Agent，负责"测试登录页"。

### 步骤 1：在 `config/agents.js` 加 Agent 定义

```javascript
测试工程师: {
  name: "测试工程师",
  description: "负责测试登录页功能，输出测试用例",
  systemPrompt: `你是一名资深测试工程师。

## 核心职责
1. 根据产品 PRD 设计测试用例
2. 输出 Markdown 格式的测试用例文档

## 输出规范
- 使用 Markdown 格式
- 包含：测试场景、输入数据、预期结果、实际结果
- 不输出与技术实现相关的内容`,
  tools: [],
  toolDefs: [],
  temperature: 0.4,
  maxTokens: 1500,
},
```

### 步骤 2：修改 Mock 响应

打开 `mock/llm-responses.js`，参考 `productManagerResponses` 加一组：

```javascript
const testEngineerResponses = [
  {
    id: "chatcmpl-test-1",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: `# 登录功能测试用例\n\n## 测试场景1：正常登录\n- 输入：admin / 123456\n- 预期：登录成功\n- 实际：...`,
        tool_calls: null,
      },
    }],
  },
];

module.exports = {
  ...,
  testEngineerResponses,
};
```

### 步骤 3：在 `mock/llm-client.js` 加上路由

```javascript
getResponsesForRole(agentRole) {
  switch (agentRole) {
    ...
    case "测试工程师":
      return testEngineerResponses;
    ...
  }
}
```

### 步骤 4：让 Planner 委派给测试工程师

打开 `mock/llm-responses.js`，修改 `plannerResponses[2]`（第 3 轮响应），让 Planner 在 UI 设计师完成后也委派测试工程师。

跑一遍，应该能看到 Planner 委派 3 个 Agent 了！

## 实验 4：debug 一次失败（15 分钟）

故意改坏一处，看错误信息怎么读：

1. 把 `config/agents.js` 里某个 Agent 的 `tools: ["write_file"]` 改成 `tools: ["non_exist_tool"]`
2. 跑 `npm run start`
3. 看错误栈能不能定位到问题

💡 这就是调试 Agent 系统最重要的技能——从错误栈反推是哪一层出了问题。

---

# 🎓 第 7 章：常见误区与进阶方向

## 7.1 新手最容易踩的 5 个坑

### ❌ 坑 1：把所有事都塞给一个 Agent

**症状**：把所有 systemPrompt 都写得很长，把所有工具都注册给一个 Agent。

**为什么错**：长 prompt 让 LLM 困惑，多工具让 Agent 不知道该用哪个。

**正确做法**：**单一职责**。一个 Agent 只干一件事，需要协作就加新 Agent。

### ❌ 坑 2：让 Agent 互相共享 Session

**症状**：让产品经理和 UI 设计师共享一个 messages 数组。

**为什么错**：角色混淆，LLM 不知道"我现在是谁"。

**正确做法**：**每个 Agent 一个独立 Session**，通过 MessageBus 通信。

### ❌ 坑 3：工具返回值塞进 systemPrompt

**症状**：把工具结果硬编码到 system prompt 里。

**为什么错**：工具结果是动态的，不应该出现在静态配置里。

**正确做法**：用 `role: "tool"` 的消息动态塞进 messages 数组。

### ❌ 坑 4：忘记设置 `maxTurns`

**症状**：ReAct 循环死循环，调了几百次 LLM。

**为什么错**：LLM 可能一直调工具不出最终答案。

**正确做法**：设置合理的 `maxTurns`（5-10 次），超过就强制结束。

### ❌ 坑 5：把 Mock 写得太脆弱

**症状**：用关键词匹配路由（如检测 messages 里有没有"产品经理"）。

**为什么错**：改个 prompt 关键词路由就失效。

**正确做法**：**显式路由**。我们这个项目用 `agentRole + turn` 路由就是这个思路。

## 7.2 真实生产 vs 这个 mock 的差距

| 维度           | opencode-mock         | 真实生产                                         |
| ------------ | --------------------- | -------------------------------------------- |
| LLM          | Mock 预设答案             | GPT-4o / Claude / Gemini                     |
| 工具           | 几个 Mock 工具            | 几十个真实工具（bash、编辑器、浏览器、Git...）                 |
| Session 存储   | 内存索引 + 单文件 JSON       | SQLite / PostgreSQL（支持跨进程、事务、回滚）             |
| Session 父子层级 | parentID 单层           | parentID 多层树 + session\_parent 导航 + forking  |
| 上下文继承        | summarize() 拼到 prompt | compaction Agent + 实时压缩 + 摘要回放               |
| 权限系统         | canDelegate 单字段       | 完整的 permission DSL（pattern + action + scope） |
| 错误处理         | 直接抛异常                 | 重试、回滚、降级                                     |
| 监控           | 控制台打印                 | OpenTelemetry / 日志系统                         |
| 安全           | 无                     | 沙箱、权限控制、路径白名单                                |

## 7.3 你可以接着探索的方向

1. **加真实 LLM 支持**：把 MockLLMClient 换成 OpenAI 客户端，看真实 LLM 怎么决策
2. **并行执行**：现在 Planner 是串行的，可以改成"无依赖的子任务并行"
3. **Plan 模式**：让 Planner 先输出一份完整计划再执行（对齐 OpenCode 的 /plan 命令）
4. **工具权限**：每个 Agent 配置 allowedTools 白名单
5. **多层级委派**：现在 Planner→子 Agent 是单层，可以尝试打开"子 Agent 再委派"的开关（OpenCode 的 task\_budget）
6. **Session 回放**：从磁盘加载一个旧 Session 的 messages，复现它的 ReAct 过程
7. **观测性**：加 token 计数、调用时长、成功率等 metrics

---


# 🎓 第 8 章：OpenAI Chat Completions 接口完全解析

本章讲解 **OpenAI 官方 Chat Completions API**——这是目前事实标准的大模型接口规范。所有大模型（OpenAI 官方、Azure OpenAI、vLLM 部署的任意模型、Ollama、DeepSeek、智谱、月之暗面、甚至 opencode-mock 这种伪 LLM）都号称 "OpenAI 兼容"，原因只有一个：**完全照搬下面这个接口形状**。

学完本章你能回答：
- 真实 OpenAI API 到底长什么样？只有一个接口还是好几个？
- `tools` 字段塞在 request body 里还是独立接口？
- `tool_calls` 是什么格式？`finish_reason` 为什么会有 `"tool_calls"` 这种奇怪值？
- 一次 ReAct 循环里，请求/响应来回几次？每次数据长什么样？
- opencode-mock 那 60 行 `mockLLM()` 为什么能"模拟" OpenAI？

---

## 8.1 一个接口走天下

OpenAI 提供的大模型对话 **只有一个 HTTP 接口**：

```
POST https://api.openai.com/v1/chat/completions
Content-Type: application/json
Authorization: Bearer sk-xxxxxxxxxxxxxx
```

**没有 `/v1/chat`、`/v1/tools`、`/v1/function-call`。** 一切功能（普通对话、流式输出、函数调用/工具调用、多轮对话、Vision 识图、JSON 强制输出、Structured Outputs）都通过 **这一个接口 + 不同请求字段** 完成。

| 需求 | 怎么用同一个接口解决 |
| --- | --- |
| 普通问答 | 请求只带 `messages` 字段 |
| 多轮对话 | 请求的 `messages` 数组里塞多轮历史 |
| 函数调用 | 请求多加一个 `tools` 字段 |
| 强制 JSON 输出 | 请求加 `response_format: { type: "json_object" }` |
| 流式输出（SSE） | 请求加 `"stream": true`，响应变成 `data: {...}` 多个 chunk |
| Vision（看图） | `messages` 里的 content 改成数组，含 `type: "image_url"` |
| Structured Outputs | 请求加 `response_format: { type: "json_schema", json_schema: {...} }` |

**这就是为什么 opencode-mock 可以假装"兼容 OpenAI"——只要接口形状对，调用方根本不在乎背后是 GPT-4 还是 5 行假代码。**

---

## 8.2 请求体（Request Body）

完整字段长这样（实际生产里你只需要关心前 5 个）：

```json
{
  "model": "gpt-4o",
  "messages": [
    {"role": "system",    "content": "你是一个登录页设计专家"},
    {"role": "user",      "content": "帮我设计一个登录页"},
    {"role": "assistant", "content": "我先规划一下任务..."},
    {"role": "user",      "content": "继续"}
  ],
  "tools": [...],           // 可选：可用工具列表（8.5 详解）
  "tool_choice": "auto",    // 可选：auto / none / {"type": "function","function":{"name":"x"}}
  "temperature": 0.7,       // 可选：0-2，越大越发散
  "top_p": 1.0,             // 可选：核采样
  "max_tokens": 4096,       // 可选：单次最多生成多少 token
  "stream": false,          // 可选：true 走 SSE 流式
  "response_format": {...}, // 可选：强制 JSON / JSON Schema
  "stop": ["\n\n"],         // 可选：碰到这些字符串就停
  "n": 1,                   // 可选：一次生成几个候选，默认 1
  "user": "user-id-123",    // 可选：帮你追踪滥用，留空也行
  "presence_penalty": 0,    // 可选：-2 到 2
  "frequency_penalty": 0,   // 可选：-2 到 2
  "seed": 42                // 可选：尽量复现相同输出
}
```

### 8.2.1 `messages` 字段——对话历史是一条数组

整个对话历史就是一个**有序数组**，每个元素是一条消息。这种设计的好处：**服务端无状态**——你可以随时切到别的服务器继续聊。

| `role` 取值 | 谁发的 | `content` 是什么 |
| --- | --- | --- |
| `system` | 你（开发者） | 设定 AI 人格、规则 |
| `user` | 最终用户 | 用户输入 |
| `assistant` | AI 自己 | AI 的回复 |
| `tool` | 工具执行结果（AI 视角） | 工具返回值 |
| `developer` | 等价 system | OpenAI o-series 模型专用 |

### 8.2.2 `assistant` 消息有两种形态

普通文字回复：

```json
{
  "role": "assistant",
  "content": "好的，我先规划一下：1. 写PRD 2. 设计UI 3. 写代码"
}
```

**调用工具时**（特殊形态——`content` 通常是 `null`，多了一个 `tool_calls` 字段）：

```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_abc123",
      "type": "function",
      "function": {
        "name": "task",
        "arguments": "{\"role\":\"product_manager\",\"task\":\"写PRD\"}"
      }
    }
  ]
}
```

> **关键点**：`tool_calls` 不是新接口，也不是新消息类型。它就是 assistant 消息上的一个数组字段。每次调用 LLM 都要把这个数组原封不动塞回去，让 LLM "记住" 自己刚才发了哪些工具调用。

### 8.2.3 `tool` 消息：把工具结果喂回给 LLM

工具执行完，得到返回值后，要构造一条 `role: "tool"` 的消息塞回去。**必须带上 `tool_call_id`** 关联到刚才那条 assistant 消息的 `id`：

```json
{
  "role": "tool",
  "tool_call_id": "call_abc123",
  "name": "product_manager",
  "content": "{\"prd\":\"已完成，登录页需求文档....\"}"
}
```

**强约束**：每一个 `tool` 消息 **必须** 紧跟在一个含 `tool_calls` 的 `assistant` 消息之后。OpenAI 校验会直接报错。

---

## 8.3 响应体（Response Body）

普通请求的响应长这样：

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1719740000,
  "model": "gpt-4o-2024-08-06",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "好的，我先规划...",
        "tool_calls": null
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 120,
    "completion_tokens": 85,
    "total_tokens": 205
  },
  "system_fingerprint": "fp_xxx"
}
```

### 8.3.1 关键字段速查

| 字段 | 含义 | 你要不要读它 |
| --- | --- | --- |
| `choices[0].message` | AI 这次的实际回复（内容或工具调用） | ✅ **必须** |
| `choices[0].finish_reason` | 为啥停了（见下表） | ✅ **必须** |
| `usage.prompt_tokens` | 你这次喂了多少 token | 💰 计费用 |
| `usage.completion_tokens` | AI 生成多少 token | 💰 计费用 |
| `id` | 本次响应唯一 ID（日志用） | 可选 |
| `system_fingerprint` | 模型版本指纹（监控后端切换） | 可选 |
| `choices[1..n]` | 候选（仅 `n>1` 时有） | 一般不用 |

### 8.3.2 `finish_reason` 枚举值

这个字段决定了你下一步该怎么走：

| `finish_reason` | 含义 | 你的下一步动作 |
| --- | --- | --- |
| `"stop"` | 自然停止（说完了或碰到 stop token） | 把 `content` 显示给用户，结束 |
| `"length"` | 达到 `max_tokens` 被截断 | 内容不完整，重试或告知用户 |
| `"tool_calls"` | LLM 想调用工具，`message.tool_calls` 非空 | 执行工具，把结果当 `role:tool` 塞回去，**再调一次 API** |
| `"content_filter"` | 内容被安全策略拦了 | 提示用户 |
| `"function_call"` | 旧版 function calling API，已废弃 | 当 `tool_calls` 处理 |

**ReAct 循环的核心就是这个判断**：

```
if finish_reason == "tool_calls":
    for tool_call in message.tool_calls:
        执行对应的工具
        把结果作为 role:tool 消息塞回 messages
    再发起一次 /v1/chat/completions 请求（携带累积后的 messages）
else:  // stop 或 length
    return message.content 给用户
```

---

## 8.4 一次完整 ReAct 循环的请求/响应时序

下面展示 Planner 调一次产品经理子 Agent 时，**OpenAI 视角**下到底发生了什么：

```
┌─────────────────────────┐                ┌─────────────────────────┐
│   你的程序（比如 Planner） │                │      OpenAI / vLLM      │
└─────────────────────────┘                └─────────────────────────┘
            │                                        │
            │─── 第 1 次请求 ────────────────────────▶│
            │    messages=[                          │
            │      {role:system, content:"你是..."},│
            │      {role:user,   content:"设计登录页"}│
            │    ]                                   │
            │    tools=[...]                         │
            │                                        │
            │◀──── 响应 1 ──────────────────────────│
            │    finish_reason: "tool_calls"         │
            │    tool_calls: [{                     │
            │      id:"call_1",                      │
            │      function.name: "task",            │
            │      function.arguments: '{"role":"product_manager"}'│
            │    }]                                  │
            │                                        │
            │  本地执行 task 工具                     │
            │  启动产品经理子 Agent → 它也会调 LLM    │
            │  （这里嵌套一次完整的 ReAct）            │
            │  收集子 Agent 的最终回复                │
            │                                        │
            │─── 第 2 次请求 ────────────────────────▶│
            │    messages=[                          │
            │      ...上面 2 条不变,                  │
            │      {role:"assistant", tool_calls:[{id:"call_1",...}]},│
            │      {role:"tool", tool_call_id:"call_1",│
            │       content:"PRD 已写好：..."}        │
            │    ]                                   │
            │                                        │
            │◀──── 响应 2 ──────────────────────────│
            │    finish_reason: "tool_calls"         │
            │    tool_calls: [{id:"call_2", function.name:"task", ...}]│
            │                                        │
            │  本地执行 task(UI设计师)                │
            │                                        │
            │─── 第 3 次请求 ────────────────────────▶│
            │    messages=[...]                      │
            │    （现在累积了所有 tool_calls 和 tool） │
            │                                        │
            │◀──── 响应 3 ──────────────────────────│
            │    finish_reason: "stop"               │
            │    content: "登录页已设计完成，文件在..."│
            │                                        │
            │  结束，输出给用户                       │
```

**要点**：
- LLM 端**完全无状态**——它看到的永远是 `messages` 这个完整数组
- `tool_call_id` 是会话内的"事物流水号"，保证 LLM 不会把工具返回值搞混
- 一次 ReAct 循环可能涉及 **N 次 API 调用**（N = 工具调用次数 + 1）
- 如果中途某一轮你给的消息里 `tool_calls` 和 `tool` 对不上号，OpenAI 会直接返回 400

---

## 8.5 `tools` 字段定义——告诉 LLM 有什么可用工具

`tools` 不是独立接口，它是 `request body` 里的一个数组字段，告诉 LLM："我有这些工具，你可以选一个调用"。

### 8.5.1 完整字段

```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "task",
        "description": "委派任务给指定角色 Agent，返回该 Agent 的输出",
        "parameters": {
          "type": "object",
          "properties": {
            "role": {
              "type": "string",
              "enum": ["product_manager", "ui_designer"],
              "description": "要委派的角色"
            },
            "task": {
              "type": "string",
              "description": "任务描述"
            }
          },
          "required": ["role", "task"]
        },
        "strict": true
      }
    }
  ],
  "tool_choice": "auto"
}
```

| 字段 | 含义 |
| --- | --- |
| `tools[].type` | 工具类型，目前官方只支持 `"function"` |
| `tools[].function.name` | 函数名（**必填**，就是 LLM 会在 `tool_calls[].function.name` 里吐出来的名字） |
| `tools[].function.description` | 描述（必填，LLM 据此决定调不调） |
| `tools[].function.parameters` | JSON Schema 格式的参数定义（可选但强烈建议填） |
| `tools[].function.strict` | 是否启用严格模式（true 之后参数必须严格匹配 schema） |
| `tool_choice` | `"auto"` 让模型自己决定、`"none"` 禁止调工具、`"required"` 强制调、`{"type":"function","function":{"name":"X"}}` 强制调指定的 |

### 8.5.2 LLM 怎么"决定"调不调工具

本质上是 LLM 在生成文本时，按概率决定下一个 token 是文本内容还是工具调用。  
**没有内置 if-else**——LLM 输出的就是一段文本，只是 OpenAI 后处理把满足工具格式的部分解析成结构化的 `tool_calls`。

所以你的 `description` 写得越好、参数 `description` 越清楚，LLM 选对工具的概率越大。

---

## 8.6 opencode-mock 的 Mock 策略

现在你懂了 OpenAI 真实 API 长什么样，回头看 opencode-mock 那 60 行 Mock LLM，就会觉得"也就那么回事"。

### 8.6.1 它模拟的对象

opencode-mock 的 `mockLLMClient` 模拟的就是 `/v1/chat/completions` 这个接口。**只模拟这一个**——没有 `/v1/embeddings`、没有 `/v1/images`，因为 Agent 模式只需要它。

### 8.6.2 它实现的东西 vs 真实接口

| 真实 OpenAI 字段 | opencode-mock 是怎么模拟的 |
| --- | --- |
| `POST /v1/chat/completions` | 一个 `chat({messages, tools})` 函数（内部用 `mockLLM()` 走 mock 响应表） |
| `messages` 数组 | 完整保留，**不**做任何处理 |
| `tools[].function.name` | 当 `system` 消息里的"可用工具列表"提取出来用于路由 |
| `tool_calls` 输出 | 不是从 LLM 推出来，而是从预定义的 467 行 `llm-responses.js` 表里查 |
| `finish_reason` | 写死 ——有工具时返回 `"tool_calls"`，否则 `"stop"` |
| `usage` | 不模拟（返回空对象），生产里你得自己计费 |

### 8.6.3 为什么这么简化也能跑通 Agent

ReAct 循环在 Agent 代码里是这样的伪代码：

```
while True:
    response = llm.chat(messages, tools)
    message = response.choices[0].message
    
    if response.choices[0].finish_reason == "tool_calls":
        for tool_call in message.tool_calls:
            args = JSON.parse(tool_call.function.arguments)
            result = tool_registry[tool_call.function.name](args)
            messages.push({
                role: "tool",
                tool_call_id: tool_call.id,
                name: tool_call.function.name,
                content: result
            })
    else:
        return message.content  // finish_reason == "stop"
```

**这一套循环是 Agent 代码写的，跟 LLM 是真是假完全无关。**

只要 `chat()` 函数长得像 OpenAI 那样返回：
```js
{
  id, model,
  choices: [{ message: { role, content, tool_calls }, finish_reason }],
  usage: {}
}
```

那不管是 `gpt-4o`、本地 `Qwen2.5`、还是 `mockLLM()`，Agent 都能用。**这就是 OpenAI 接口成为事实标准的根本原因——它是 Agent ↔ LLM 之间的通用语。**

### 8.6.4 想换成真实 LLM？改 3 行就行

打开 `mock/llm-client.js`，看里面的 `chat()` 方法签名是不是和上面那段伪代码长得一样？如果是，你只要把里面 `mockLLM()` 这一行改成：

```js
return await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: this.formatMessages(messages),  // 把项目内部格式转成 OpenAI 格式
  tools: this.formatTools(tools)            // 同上
});
```

你的所有 Agent、子 Agent、ReAct 循环都不用改——这就是解耦的魅力。

---

## 8.7 一张图总结

```
┌────────────────────────────────────────────────────────────┐
│  OpenAI Chat Completions API 真实结构                        │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  请求（POST /v1/chat/completions）                           │
│    ├─ model        : "gpt-4o"                              │
│    ├─ messages[]   : [{role, content/tool_calls}, ...]      │
│    ├─ tools[]      : [{type:"function", function:{...}}]    │  ← tools 不是接口，是字段
│    ├─ tool_choice  : auto / none / required / 指定函数       │
│    ├─ temperature  : 0~2                                    │
│    └─ ...其他 25 个字段                                    │
│                                                            │
│  响应                                                       │
│    ├─ choices[0].message      : {role, content, tool_calls} │
│    ├─ choices[0].finish_reason : "stop" | "tool_calls" | ... │
│    └─ usage                   : {prompt_tokens, ...}       │
│                                                            │
└────────────────────────────────────────────────────────────┘

                ↓ ReAct 循环的边界完全在客户端（你的代码）↓

┌────────────────────────────────────────────────────────────┐
│  Agent 循环伪代码                                            │
├────────────────────────────────────────────────────────────┤
│  while True:                                               │
│    resp = llm.chat(messages, tools)                         │
│    if resp.choices[0].finish_reason == "tool_calls":        │
│      for tc in resp.choices[0].message.tool_calls:          │
│        result = exec(tc.function.name, tc.function.args)    │
│        messages.push({role:"tool", tool_call_id:tc.id, ...})│
│    else:                                                    │
│      return resp.choices[0].message.content                 │
└────────────────────────────────────────────────────────────┘
```

**记住三句话**：
1. **只有一个接口**：`/v1/chat/completions`，`tools` 是字段不是接口。
2. **`finish_reason` 是 ReAct 循环的开关**：`"tool_calls"` 就续调工具，`"stop"` 就结束。
3. **`tool_call_id` 是串联工具调用的"事物流水号"**——assistant 的 `tool_calls` 和后面的 `tool` 消息靠它配对。
