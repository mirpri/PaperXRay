# 03 · 本地开发环境

## 依赖

- Node.js ≥ 20，pnpm（`corepack enable` 或 `npm i -g pnpm`）
- MariaDB（本地安装或容器均可，10.x/11.x/12.x 皆可，需 utf8mb4 + InnoDB 支持）

## 安装与启动

```bash
pnpm install

# 首次启动前配置数据库连接、SSO、模型 key
cp apps/server/.env.example apps/server/.env
# 编辑 apps/server/.env：
#   - DB_HOST/DB_USER/DB_PASSWORD/DB_NAME 填本机 MariaDB
#   - MIRPASS_CLIENT_ID 留空则 SSO 登录会报「未配置」，见下方「SSO」一节
#   - 组织 Lens 的 API 地址、模型和密钥统一在 /admin 中逐 Lens 配置

# 直接安装最新完整数据库（自动建库、建表并写入 SSO 配置和四个预置 lens）
# DB_USER 须已有目标数据库的建库、建表、读写权限；也可以由管理员预先建好空库并授权。
pnpm db:install

# 两个终端分别起服务
pnpm dev:server   # http://localhost:3001
pnpm dev          # http://localhost:5173
```

数据库安装只支持全新或空数据库，非空库会被拒绝且不会删除现有数据。已有旧库请另设一个新的 `DB_NAME` 安装；本命令不升级旧库。MariaDB 的 DDL 会自动提交，若中途失败可能留下部分表，修复错误后请使用新的空数据库重试。`pnpm install` 仅安装依赖，数据库由 `pnpm db:install` 显式安装。

打开 `http://localhost:5173`，上传一个有文本层的 PDF（扫描版无文本层的 PDF 不支持，见 01 文档「风险与降级」）。页面会渲染出 PDF 本身（`pdfjs-dist` 客户端渲染）并把标注反向映射为原文上的高亮色块，右侧栏同步列出 agent 标注（黄色）与人类标注（蓝色）。

## 已有数据库切换到文件存储

已有数据库含 `documents.normalized_text` / `documents.char_map` 时，先停止后端（包括开发模式），然后在根目录运行：

```bash
pnpm db:externalize
pnpm dev:server
```

该一次性工具会锁定文档表，逐批将全文和 CharMap 原样导出到 `UPLOADS_DIR`，读取校验全部通过后才删除两个旧字段。文档 ID、段落索引、用户和标注保留；已有 PDF 文件保持原路径。导出或校验失败不会删除旧字段，修复后可重跑；已转换的数据库再次执行会直接退出。该工具需要文档表的 SELECT、LOCK TABLES、ALTER 权限；不会重新解析论文或改变字符锚点。全新数据库直接 `pnpm db:install`，无需执行此工具。

## 现状与已知局限（写给接手这段代码的人）

- **重组层（`apps/server/src/reassembly/`）已支持单栏与双栏 PDF。** 双栏检测（`columns.ts`）对页面（或 `bands.ts` 切出的纵向区块）里字号等于页面「众数字号」（近似正文字号）、宽度小于半页宽的条目做 x 坐标中心直方图，找两个主峰后取中点作为栏分界；再按**整行**（而非逐 item）与分界的相对位置分类为左栏/右栏/跨栏（标题、页眉页脚），跨栏行还要求行内在分界附近确实有空隙，否则整行保留不拆——这是为了处理 pdfjs 常把一行文字按字体/样式切成多个 item 的情况（例如页脚被切成 3 段，若逐 item 分类会把同一行拆散到三个不同位置，已通过真实论文验证并修复，见 `columns.test.ts` 的 footer 回归用例）。已知局限：**图表（尤其是由分散文字标签拼成的流程图/示意图）无法与正文区分**——图内标签常与正文同字号，直方图会把它们当作正文数据点，导致图表区域内部顺序错乱；这不是布局算法能解决的，需要真正的图形/图像版面分析（有 image/vector 数据可用时才可行），已在真实论文（USENIX 双栏论文）上验证：**纯正文段落**（无嵌入图表）的重组顺序完全正确，图表干扰仅限图表所在的局部区域。三栏及以上不支持。页眉页脚剔除（`header-footer.ts`，至少 3 页才生效，且要求跨页文字完全一致——页码这类逐页变化的页脚不会被剔除）、段落切分（`paragraphs.ts`）、跨页续接（`cross-page.ts`）都是启发式规则，各自有单测但只覆盖典型情况。
- **重组层在字体切换处会多插空格**（例如斜体词后出现 `Agentix , an`），双栏论文的摘要还会被逐行切成段落。由 `eval/` 的阅读顺序检查发现，修复会移动已有锚点，需要配合迁移一起做。
- **`apps/server/src/reassembly/build-document.ts` 只产出 `paragraph` 类型的 Node。** `section` / `equation` / `figure` / `table` / `caption` 的识别还没做，属于后续工作。
- **`packages/contracts/src/ir.ts` 里的 `CharMapRun`** 是反向映射表示形式的第一版实现，已在 `buildDocument` 中跑通并有往返正确性测试（`reassembly/build-document.test.ts`）。**反向映射算法本身也已实现**（`apps/web/src/anchoring/reverse-map.ts`，纯函数、无 DOM 依赖、有单测）：给定 CharRange + CharMap + 一个 `(page,itemIndex)=>bbox` 查询函数，按 CharMap run 与目标区间的重叠比例对 item bbox 取子矩形。`apps/web/src/pdf/useItemGeometries.ts` 用 `pdfjs-dist`（与服务端提取层同版本，保证 `itemIndex` 语义一致，见 02 文档第 12 节）在客户端渲染 PDF、取每个 item 的 bbox，再调用反向映射把标注画成高亮色块叠层。正向映射（在 PDF 上选中文字 → CharRange）由 `apps/web/src/anchoring/find-text-range.ts` 实现，按空白折叠后匹配。**没有做的**：反向映射矩形精度的 golden set。
- **lens 运行时是真的模型驱动了**，不再只是硬编码规则。`apps/server/src/lenses/presets.ts` 声明四个预置 LensSpec（方法审查/实验统计/可复现性/新颖性），`run-model-lens.ts` 用声明式 prompt 调用模型，要求模型只返回 `{evidenceText, comment, severity, confidence}` 的 JSON，`evidenceText` 必须是原文的逐字子串——服务端用它在 `normalizedText` 里做字面查找算出真实 `evidenceSpan`（模型自己不产出坐标/区间，避免模型编造区间）。`model-client.ts` 是一个不依赖任何 SDK 的 OpenAI 兼容 `chat/completions` 调用，使用管理员在 `/admin` 为该 Lens 选择的 Provider 和模型；未配置会明确报错，运行时不会生成 fake-lens 结果。lens 定义现在存在 `lenses` 表里，四个预置 lens 在启动时补种但不覆盖。curator/admin 可以在 `/lenses` 页编辑组织 lens，每次保存版本号加一；任何成员都能建个人 lens。个人 lens 在浏览器里直连用户自己的 OpenAI 兼容端点，端点和 key 只存在 localStorage，不经过服务端。浏览器只把模型输出的引文 POST 到 `/api/documents/:id/lenses/:lensId/client-run`，服务端自己定位、复核，不接受客户端给的区间。prompt 构造与输出解析在 `packages/contracts/src/lens-output.ts`，前后端共用。已用真实论文（AgentSpec.pdf）跑通全链路验证（extraction → reassembly → 模型调用 → 证据校验 → 入库 → 前端展示）。
- **证据校验（`apps/server/src/evidence/`）只做了三件事里的两件。** 评测 harness 已经就位，见 `eval/README.md`：`pnpm eval` 报告阅读顺序、CharMap 覆盖率、锚点稳定性、lens 证据通过率，以及有人工标注时的准确率和召回率；锚点回归检查也跑在 `pnpm test` 里。lens 的金标准还没人标。 `verify-evidence.ts` 检查 evidenceSpan 是否真实落在 normalizedText 范围内、是否落在 lens 声明的 scope 内；`apply-verification.ts` 把结果接到写库前——存在性不达标直接丢弃，scope 不达标降级为 `info`/低置信度但保留。**第三件事（区间内容与 comment 语义是否相符）没有实现**，因为诚实地做这件事需要独立于产出 lens 的第二次模型调用去核对，属于没做过的新工作，不是"顺手"能加的；用字符串相似度之类的启发式伪造会比不做还糟——它会在未来的评测里冒充"已验证"。`EvidenceVerification.semanticMatch` 字段固定为 `null`，不要读成通过。
- **SSO 已接入**（标准 OAuth2 Authorization Code + PKCE，默认 mirpass，见 02 文档第 11 节）。`apps/server/src/auth/` 是核心：`pkce.ts` 生成 state/code_verifier/code_challenge；`oauth-state.ts` 用一个签名、httpOnly、10 分钟过期的 cookie 在 `/api/auth/login` → IdP → `/api/auth/callback` 这段跳转之间带 state+verifier（无服务端内存态，重启/多实例都不受影响）；`session.ts` 用同样的签名 cookie（`sign()`/`verify()` 在 `signed-value.ts`，纯函数，有单测）保存登录会话，不是 JWT，只是一个签了名的 userId。`GET /api/auth/login`、`GET /api/auth/callback`、`GET /api/auth/me`、`POST /api/auth/logout` 四个路由；`sso_config` 表存端点与 client 凭据（安装脚本用 `MIRPASS_CLIENT_ID` / `MIRPASS_CLIENT_SECRET` 环境变量写入初始配置，之后以表里的值为准），`GET/PUT /api/admin/sso-config`（仅 `admin` 角色）是管理面板要调的接口，`clientSecret` 只写不读（GET 只返回 `hasClientSecret` 布尔值）。**`authorId` 现在只来自已认证会话**——`ensureDemoUser` 占位函数已删除，`POST/PATCH/DELETE .../human-annotations` 现在都要求登录（`requireAuth`），编辑仅限作者；删除允许作者本人，或管理员删除非管理员的评论。第一个 admin 从 `.env` 的 `ADMIN_EMAILS`（逗号分隔）读取，SSO 回调第一次见到该邮箱时把这个新建用户设为 `admin`；之后角色只能通过系统自己的表改，SSO 不再提供角色。**验证情况**：`/api/auth/login` 的跳转 URL、client_id、PKCE 参数已核对无误；完整的登录往返（跳到 mirpass、真人登录、回调换 token）需要打开浏览器手动走一遍——这是我没有浏览器工具能做的部分，麻烦手动登录验证一次。
- **人类标注 CRUD 已实现并跑通乐观锁**（`apps/server/src/routes/human-annotations.ts` + `db/repositories.ts`）：`POST /api/documents/:docId/human-annotations` 创建；`PATCH .../:id` 需要带 `version`，版本不匹配返回 409 + 当前行；`DELETE .../:id?version=N` 同理，软删除（`deleted_at`），已过手动并发冲突测试。`GET /api/documents/:id/annotations` 现在合并返回 agent 标注与人类标注（软删除的评论返回空正文占位，前端仅保留有未删除后代的讨论）——这个合并列表按 visibility 过滤（02 文档 #5）：只返回 `org` 的，加上当前用户自己的 `private` 的。agent 标注和 `lens_runs` 都记录 `owner_id`，组织 lens 为 NULL；个人 lens 的 run 可以由 owner 整组切换 private/org（`PATCH /api/documents/:id/runs/:runId/visibility`）。所有标注变更（lens 产出新一批、人类标注增删改）统一广播 `annotations:changed` socket 事件，前端收到后整体 refetch，不做增量 diff。
- **PDF、归一化全文与 CharMap 都使用文件存储。** 默认分别保存在 `apps/server/uploads/<contentHash>.pdf`、`<contentHash>.txt`、`<contentHash>.charmap.json`，可通过 `UPLOADS_DIR` 配置目录。数据库只存文档元数据、段落索引和标注；`GET /api/documents/:id` 仍返回 `normalizedText`，`GET /api/documents/:id/charmap` 仍返回 CharMap，服务端从文件读取，Lens 与高亮接口不变。上传先保存文件再提交数据库记录，段落批量入库；失败后可能保留尚未被数据库引用的文件，便于重试。备份或多实例部署时必须同时备份/共享整个 `UPLOADS_DIR`。
- **所有 `/api/documents*`、`/api/lenses*` 路由和 socket.io 握手都要求登录。** 角色管理在 `/admin`（`GET /api/admin/users`、`PATCH /api/admin/users/:id/role`），不允许降级最后一个 admin。
- **URL 导入**（`POST /api/documents/import`，`apps/server/src/import/`）：arXiv 的 abs/pdf/html 链接和镜像都归一到同一个 PDF URL，OpenReview 的 forum 链接归一到 pdf。只允许 https、默认端口、白名单域名（`IMPORT_ALLOWED_HOSTS`）。内网、回环、链路本地、CGNAT 以及嵌入 IPv4 的 IPv6 段在连接自身的 DNS lookup 里拒绝，所以检查的地址就是实际连接的地址，没有 DNS rebinding 窗口；重定向手动跟随、逐跳复核；50 MB、30 秒上限，并校验 `%PDF-` 文件头。
- **防刷屏**（阅读页侧栏）：agent 标注默认只显示置信度 ≥ 0.5 的，每个 lens 最多 5 条（先按严重度、再按置信度排）；各 lens 和人类标注可以整组开关，PDF 右侧有页边密度条，高亮层和列表使用同一个过滤结果。
- **数据库直接安装最新完整结构**（`apps/server/src/db/schema.sql` + `install.ts`）。在项目根目录运行 `pnpm db:install`，无需执行历史迁移，也不创建迁移记录表；后续表结构调整直接修改 `schema.sql`，供新数据库安装使用。

## 已定的技术选型（补充 02 文档第 12 节的"候选"）

02 文档把 HTTP 框架、WebSocket 库、数据访问方式列为"候选，动手时定"。已定：

| 用途 | 选型 | 理由 |
| --- | --- | --- |
| 包管理 / monorepo | pnpm workspaces | 前后端共用 `@paper-xray/contracts` 包，无需额外的任务编排工具 |
| HTTP 框架 | Express | 团队熟悉度优先 |
| WebSocket | socket.io | 房间抽象直接对应「文档房间」概念，服务端广播场景够用 |
| 数据访问 | mysql2 + 手写 SQL | 匹配 02 文档对 JSON 列、乐观锁 `UPDATE...WHERE version=?` 的精确控制要求 |
| 测试框架 | Vitest | 前端已用 Vite，配置复用，无需处理 ts-jest 的 ESM 摩擦 |

## Provider 与 Lens 模型选择

在 `/admin` 管理 Provider，在 `/lenses` 的 **PROVIDER / MODEL** 控件为每个 Lens 选择模型。Provider 填写名称、OpenAI 兼容 Base URL、建议模型列表（可留空，一行一个）和密钥；多个 Lens 可以共用同一个 Provider，并分别选择或直接输入不同模型；模型名称不受建议列表限制。`.env` 不保存模型配置。

- **组织 Provider**：admin 创建和编辑，全体成员可选择使用；密钥保存在服务端，只写入不回显。curator 可为组织 Lens 选择组织 Provider，但不能读取或修改密钥。
- **个人 Provider**：每个成员都能在 `/admin` 的 Settings 页面维护自己的 Provider；服务端只保存名称、地址、模型列表等元数据，密钥按用户和 Provider 保存在当前浏览器，不上传。其他用户看不到个人 Provider。使用新浏览器时需要重新输入个人密钥，个人端点需允许本站 CORS。
- **组织 Lens**只能选择组织 Provider。**个人 Lens**可以选择自己的或组织的 Provider：个人 Provider 在浏览器执行，组织 Provider 在服务端执行；两种情况的结果都属于 Lens 的拥有者，默认 private，是否分享由 Lens 设置决定。

修改 Provider 会更新引用它的 Lens 版本，下次调用生效；不能删除仍被 Lens 使用的 Provider，修改或清空模型建议列表不会改变 Lens 已保存的模型。Lens 未选择可用 Provider/模型时明确报错，不生成假结果。

新数据库直接 `pnpm db:install`。旧的逐 Lens API 设置可通过 `pnpm db:providers` 转换：合并相同地址和密钥为组织 Provider、保留每个 Lens 的模型选择，验证后移除旧表。

### 评论与回复

阅读页中的人工评论提供 Edit / Delete / Reply，Lens 批注也可以回复。回复支持任意层级。`POST /api/documents/:docId/annotations/:parentId/replies` 接收 `body` 与 `parentKind`（human / agent）；服务端继承原讨论的锚点和可见性。编辑、删除通过版本号检查并发冲突（409），不会覆盖其他标签页的修改。

新数据库直接 `pnpm db:install` 包含完整评论结构；已有数据库运行一次 `pnpm db:comments`，只补充回复字段和索引，保留现有数据。当前开发数据库已执行。

### Lens 颜色

Lens 配置页可从系统 12 种预设颜色中选择，组织与个人 Lens 均支持。颜色存于 `lenses.color`；筛选标签、批注卡片、PDF 高亮和页边密度条使用同一颜色。改变颜色会应用到该 Lens 的已有批注。共享个人 Lens 或已删除 Lens 的历史批注仍通过批注 API 获取对应颜色。

新库直接 `pnpm db:install`；已有库运行一次 `pnpm db:lens-colors` 补字段和初始配色，保留已选颜色。当前开发数据库已执行。

### 回复消息

`/messages` 展示别人直接回复自己的评论或回复；自回复不产生通知。`notifications` 与回复在一个事务内写入，消息正文预览读取当前评论内容。消息与未读计数均按收件人和讨论根节点的当前可见性过滤，已删除回复不再展示。顶部 Messages 入口显示未读圆点与数量；点击查看回复会标记已读并定位对应讨论，也可单条或全部标记已读。

登录后的 Socket.IO 连接自动加入由签名会话确定的用户房间，通知变化会刷新所有已登录标签页；重新连接、窗口聚焦和定时轮询补齐遗漏的未读计数。接口：`GET /api/notifications`（可用 before 游标分页）、`GET /api/notifications/unread-count`、`PATCH /api/notifications/:id/read`、`POST /api/notifications/read-all`。

新库 `pnpm db:install` 已包含消息表；已有库执行 `pnpm db:notifications`，仅补建消息表，保留现有数据。当前开发数据库已执行。

### Annotation 投票

评论、回复和 Lens annotation 均支持 upvote/downvote。每人每条只有一票，点击已选项取消，点击另一项切换；数量和当前用户的投票随 annotations API 返回，并通过原有实时事件刷新。

新安装使用 `pnpm db:install`；已有数据库运行 `pnpm db:votes`，只创建缺失的投票表、保留已有数据。投票 API 为 `PUT /api/documents/:docId/annotations/:id/vote`，请求 `{ kind: "human" | "agent", value: -1 | 0 | 1 }`。

他人投票会通知评论作者或个人 Lens run 所有者；组织 Lens 没有个人收件人。投票消息独立保留历史和已读状态，重复提交同一票不增加消息、不重置已读；切换生成新消息，取消保留原消息并新增取消点赞或取消点踩消息。重复取消不发送消息。已有数据库再次运行 `pnpm db:votes` 创建消息历史表并保留现有消息的 ID、时间及已读状态。自己投票不提醒。消息列表、未读数及已读接口统一处理回复和投票，继续按当前讨论权限过滤。

### SSO JSON 导入与导出

Admin 的 SSO 设置区提供 Import JSON / Export JSON。配置仍保存在数据库。导出下载当前已保存的 `sso-config.json`，包含端点、clientId、clientSecret、scopes 和 accountManagementUrl；`GET /api/admin/sso-config/export` 仅管理员可访问，响应禁止缓存。普通设置读取仍只返回 hasClientSecret。

导入会校验 JSON 后填入表单，点击 Save SSO settings 才写入数据库。clientSecret 缺失时保留已有密钥，null 或空字符串会清空密钥。accountManagementUrl 可为字符串或 null。导出不包含尚未保存的表单改动，也不包含部署环境中的 redirect URI、ADMIN_EMAILS 或 session secret。
