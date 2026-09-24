# 02 · 决策变更记录

> `01-nabcd-architecture.md` 写于选题早期。以下决策在其之后作出，**与该文档冲突时以本文件为准**。

## 1. 产品名

**Paper X-Ray**（中文「论文透视」）。代码中的标识符统一用 `paper-xray` / `paperXray`。

界面术语：一个 agent 对用户称为一个 **lens**。代码内部两个词都可以，但面向用户的文案统一用 lens。

## 2. 不做文档版本管理

同一篇论文的不同版本（arXiv v1/v2、期刊版）**一律当作不同文档**，互不共享标注。

因此以下内容从 01 文档中作废：

- 作废指标：「换版本后锚点存活率 ≥ 90%」
- 作废设计：`workId` / 学术同一性层、跨版本标注迁移

文档同一性**只有一层**：`contentHash`（PDF 字节的哈希）。同一个 PDF 无论谁上传、URL 抓取还是本地上传，库中只存一份，标注自然汇聚。

锚定层仍然必须做，但它的正确性要求收窄为一条：**解析器版本升级后，已有标注的 charRange 仍然有效**。回归测试针对这一条。

## 3. 部署形态：组织自托管

- 一个部署实例 = 一个组织（学校 / 学院 / 实验室），**没有 public、没有跨组织共享**
- 认证走组织已有 **SSO**
- SSO 只提供身份。角色由系统自己的表存储，由管理员指定；第一个 admin 从部署配置项读取
- 不做注册、密码、找回密码

## 4. 权限模型

三角色，不做细粒度 ACL：

| 角色 | 权限 |
| --- | --- |
| `admin` | 用户与角色管理、组织设置 |
| `curator` | 创建 / 修改组织公用 lens |
| `member` | 使用组织 lens、创建个人 lens、读写自己的标注 |

## 5. 可见性：两值

`private` / `org`。取值规则：

- 组织公用 lens 的 run → 自动 `org`
- 个人 lens 的 run → 默认 `private`，用户可整组切换为 `org`
- 人类标注 → 单独控制，默认 `org`

**共享的最小单位是 run（一次 lens 运行产出的一组标注），不是单条标注。**

## 6. 个人 lens 在客户端执行

用户可接入自己的模型：自己的 API key，或本地模型（如 `http://localhost:11434`）。

**硬性约束：API key 绝不进入服务端，也绝不进数据库。**

实现方式：个人 lens 一律在浏览器中执行，前端直连模型端点，服务端只接收产出的标注。

由此推出一条必须实现的规则：

> **服务端不能信任客户端声称的校验结果。** `evidenceSpan` 是否真实存在于 `normalizedText`、是否落在声明的 `scope` 内，必须在服务端独立复核。客户端可以先校验一遍图交互快，但服务端那遍才算数。

组织公用 lens 在服务端执行，用组织配置的端点。

## 7. 文档导入

两种方式：**URL 抓取** 与 **本地上传**。

URL 抓取必须处理两件事：

1. **归一化**：arXiv 的 `/abs/` 与 `/pdf/` 链接指向同一篇，需归一到 PDF 后再抓取，否则同一篇会重复入库
2. **SSRF 防护**：服务端按用户提供的 URL 发起请求，等于开了一个内网探测口。必须做域名白名单 + 拒绝内网地址段（127/8、10/8、172.16/12、192.168/16、169.254/16、::1 等）。自托管在校园网内尤其要注意

## 8. 配额

**本期不做**。不实现存储配额、引用计数、用户自助清理。列为 future work。

## 9. 视觉

见 `../design/`。要点：

- 浅色为主，背景用**纯中性灰**（无色相偏移），不要带蓝
- agent 标记色 `#D4A017`（黄），人类标记色 `#40628C`（蓝）
- UI 字体 IBM Plex Sans + Noto Sans SC；数字、ID、状态读数用 IBM Plex Mono；衬线（Spectral）**只用于 PDF 正文内容**，不用于 UI
- 圆角 2–4px，不用大圆角和柔和阴影

## 10. 排期调整

01 文档把证据校验与评测 harness 放在 W6。由于不再做跨版本锚定，**证据校验成为本项目唯一的核心技术亮点**，因此提前：

| 周 | 目标 |
| --- | --- |
| W1 | 定死三份契约（IR / Annotation / LensSpec）；打通最小垂直切片：一个假 lens 的标注显示在侧栏 |
| W2–3 | 重组层与 CharMap；锚定层；标注 CRUD；SSO 接入 |
| W4 | **证据校验 + golden set + 评测 harness**；Lens 运行时 |
| W5 | 四个预置 lens；块高亮；实时广播 |
| W6 | 个人 lens 客户端执行；lens 配置界面；权限与可见性 |
| W7 | 真实使用，读本组论文，修 bug，测指标 |
| W8 | 补测试、写文档、准备演示 |

## 11. SSO：标准 OAuth2（Authorization Code + PKCE），默认 mirpass，管理面板可配置

01 文档与本文件第 3 节只定了"认证走组织已有 SSO"，未定具体协议。现补充：

- 协议采用标准 **OAuth 2.0 Authorization Code Flow + PKCE**（不绑定 mirpass 私有协议），服务端按 `authorizationEndpoint` / `tokenEndpoint` / `userinfoEndpoint` / `clientId` / `clientSecret`（confidential client 场景可选）/ `scopes` 这套通用字段对接，任何遵循同一协议的 IdP 都可接入，不只是 mirpass。
- **默认值指向 mirpass**（<https://github.com/mirpri/mirpass>，端点 `https://api.pass.mirpri.com`），未额外配置时开箱可用。
- 这套 OAuth 配置是**组织级设置，在管理面板（admin）里可改**，不写死在代码里——即 `admin` 角色（见本文件第 4 节）可以把默认的 mirpass 替换成组织自己的 OAuth IdP，只要该 IdP 支持同一套标准端点。
- 落地方式：服务端存一张组织级 `sso_config` 表（或等价的单例配置行），记录上述端点与 client 凭据；`clientSecret` 与其他敏感凭据同 API key 类似不应明文回显给前端。PKCE 用于降低泄漏 client_secret 的必要性，confidential client 场景（有可信后端）可选 `client_secret`。
- **SSO 只提供身份，不提供角色**——这条第 4 节已经定过，这里重申：OAuth 回调换到 `userinfo` 后，按邮箱/`sub` 关联或新建 `users` 表记录，角色仍由系统自己的表管理，第一个 admin 从部署配置项读取。
- 排期不变：本节内容属于第 10 节排期表 W2–3 "SSO 接入"的具体化，不提前实现。

## 12. 后端技术栈：Node.js + MariaDB

**变更**：后端由 Go 改为 **Node.js + TypeScript**，数据库保持 **MariaDB**。前端栈不变（React + TypeScript + Vite，`pdfjs-dist` 渲染）。与 01 文档冲突处以本节为准。

### 理由

- **前后端共享处理逻辑**。重组层、CharMap、IR 构建等核心逻辑可以用 TypeScript 写一次，前后端共用，减少重复实现和维护成本。
- **降低开发门槛**。团队对 JavaScript/TypeScript 更熟悉，开发效率更高，调试工具更完善。
- **PDF 提取统一**。前后端都用 `pdfjs-dist`，text item 切分方式一致，**CharMap 可以直接复用 item 下标**，大幅简化反向映射的实现难度。
- **生态丰富**。npm 包生态完善，WebSocket、数据库驱动、认证库等都有成熟方案。

### 诚实的性能说明

端到端耗时由两件事主导：模型调用（秒级）与 PDF 解析（百毫秒级）。Web 层与数据库在这条链路上占比很小，**换栈不会让用户感知到变快**。Node.js 的单线程模型在 CPU 密集的重组层可能不如 Go 的多核并行，但可以用 Worker Threads 或子进程分担。真实收益在开发效率、代码复用和团队熟悉度，不在吞吐。

### 连带影响：提取层可以用 pdfjs

01 文档原写「提取层：调 MuPDF 拿每页的 text item」，该设计作废——现在后端是 Node.js，可以直接用 `pdfjs-dist`。优势：

- **前后端统一**：前后端都用 `pdfjs-dist`，text item 切分方式一致，**CharMap 可以直接假设前端认得后端的 item 下标**，反向映射实现大幅简化。
- **无 cgo 依赖**：不需要编译 C 库，部署更简单，CI/CD 更顺畅。
- **许可证**：pdfjs-dist 是 Apache 2.0，无 AGPL 风险。
- **兜底方案**：若 `pdfjs-dist` 的文本项粒度不足以支撑重组层（连字、数学符号切分过碎等），可考虑引入 MuPDF 作为备选，但优先用 pdfjs 验证。

### 必须定死：charRange 的计数单位

前后端都是 JS/TS，字符串索引是 **UTF-16 code unit**。归一化全文里有 CJK、数学符号、连字，遇到 BMP 外字符（代理对）时 `str[i]` 会错位。

**契约：`charRange` 一律以 Unicode 码点计数，`[start, end)` 左闭右开。** 前后端都用 `Array.from(str)` 按码点索引，禁止直接用 `str[i]`。这条不写死，CharMap 会出现只在含特殊字符的论文上复现的错位 bug，极难定位——而 CharMap 本来就是全项目枢纽。

### MariaDB 使用约定

- 引擎 **InnoDB**，行格式 `DYNAMIC`，字符集 **`utf8mb4`**。归一化全文含 CJK 与数学符号，三字节 `utf8` 不够。
- MariaDB 的 `JSON` 只是 `LONGTEXT` 的别名，**不是二进制 JSON**，没有 PostgreSQL JSONB 那种可索引存储。因此 `anchor`、`evidenceSpan` 可以整体存 JSON 文本，但**任何用于过滤或连接的字段必须提升为独立列**：`docId`、`runId`、`agentId`、`agentVersion`、`severity`、`visibility`。确需按 JSON 内字段查询时用虚拟生成列加索引。
- 乐观锁（见 01 文档「实时协作」）用 `UPDATE ... WHERE id = ? AND version = ?`，以 RowsAffected 为 0 判定冲突，不需要行锁或事务重试。
- 驱动用 `mysql2`（支持 Promise），迁移用 `node-pg-migrate` 或手写 SQL。
- 术语检索（01 文档 N 节「定义式检索与跳转」）若需全文搜索：InnoDB FULLTEXT 对英文可用，对中文需额外分词。本期先用前缀索引加 `LIKE`，全文搜索列入 future work。

### Node.js 侧候选选型

以下是当前倾向而非最终决定，动手时按实际情况调整。

| 用途 | 候选 |
| --- | --- |
| HTTP 框架 | Express 或 Fastify（Fastify 性能更好，Express 生态更成熟） |
| WebSocket | `ws`（轻量）或 `socket.io`（功能更全，自动重连、房间管理） |
| 数据访问 | `mysql2` + 手写查询，或 `Knex.js`（查询构建器，不引 ORM） |
| PDF 提取 | `pdfjs-dist`（前后端统一） |
| 迁移 | `node-pg-migrate` 或手写 SQL 脚本 |
| 测试 | `Jest` 或 `Vitest`；重组层每个纯函数单独测 |

三份契约现在只需要**一份定义**：TypeScript 类型，前后端共用。W1 一并定死。JSON 字段名统一 camelCase。

### 排期影响

W1 减少一项：不再需要验证 MuPDF 提取质量和 cgo 构建链。W2 的重组层直接用 `pdfjs-dist`，工作量不变，但 CharMap 实现会因前后端 item 下标一致而简化。
