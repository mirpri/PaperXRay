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
#   - PPIO_API_KEY 留空则退回确定性的 fake-lens（见下方「lens 运行时」一节）

# 建库建表
mysql -u root -e "CREATE DATABASE paperxray CHARACTER SET utf8mb4;"
pnpm --filter @paper-xray/server migrate

# 两个终端分别起服务
pnpm dev:server   # http://localhost:3001
pnpm dev:web      # http://localhost:5173
```

打开 `http://localhost:5173`，上传一个有文本层的 PDF（扫描版无文本层的 PDF 不支持，见 01 文档「风险与降级」）。页面会渲染出 PDF 本身（`pdfjs-dist` 客户端渲染）并把标注反向映射为原文上的高亮色块，右侧栏同步列出 agent 标注（黄色）与人类标注（蓝色）。

## 现状与已知局限（写给接手这段代码的人）

- **重组层（`apps/server/src/reassembly/`）已支持单栏与双栏 PDF。** 双栏检测（`columns.ts`）对页面（或 `bands.ts` 切出的纵向区块）里字号等于页面「众数字号」（近似正文字号）、宽度小于半页宽的条目做 x 坐标中心直方图，找两个主峰后取中点作为栏分界；再按**整行**（而非逐 item）与分界的相对位置分类为左栏/右栏/跨栏（标题、页眉页脚），跨栏行还要求行内在分界附近确实有空隙，否则整行保留不拆——这是为了处理 pdfjs 常把一行文字按字体/样式切成多个 item 的情况（例如页脚被切成 3 段，若逐 item 分类会把同一行拆散到三个不同位置，已通过真实论文验证并修复，见 `columns.test.ts` 的 footer 回归用例）。已知局限：**图表（尤其是由分散文字标签拼成的流程图/示意图）无法与正文区分**——图内标签常与正文同字号，直方图会把它们当作正文数据点，导致图表区域内部顺序错乱；这不是布局算法能解决的，需要真正的图形/图像版面分析（有 image/vector 数据可用时才可行），已在真实论文（USENIX 双栏论文）上验证：**纯正文段落**（无嵌入图表）的重组顺序完全正确，图表干扰仅限图表所在的局部区域。三栏及以上不支持。页眉页脚剔除（`header-footer.ts`，至少 3 页才生效，且要求跨页文字完全一致——页码这类逐页变化的页脚不会被剔除）、段落切分（`paragraphs.ts`）、跨页续接（`cross-page.ts`）都是启发式规则，各自有单测但只覆盖典型情况。
- **`apps/server/src/reassembly/build-document.ts` 只产出 `paragraph` 类型的 Node。** `section` / `equation` / `figure` / `table` / `caption` 的识别还没做，属于后续工作。
- **`packages/contracts/src/ir.ts` 里的 `CharMapRun`** 是反向映射表示形式的第一版实现，已在 `buildDocument` 中跑通并有往返正确性测试（`reassembly/build-document.test.ts`）。**反向映射算法本身也已实现**（`apps/web/src/anchoring/reverse-map.ts`，纯函数、无 DOM 依赖、有单测）：给定 CharRange + CharMap + 一个 `(page,itemIndex)=>bbox` 查询函数，按 CharMap run 与目标区间的重叠比例对 item bbox 取子矩形。`apps/web/src/pdf/PdfViewer.tsx` 用 `pdfjs-dist`（与服务端提取层同版本，保证 `itemIndex` 语义一致，见 02 文档第 12 节）在客户端渲染 PDF、取每个 item 的 bbox，再调用反向映射把标注画成高亮色块叠层。**没有做的**：正向映射（在 PDF 上选中文字 → 生成 CharRange，即"新建标注"的前置功能）、golden set 精度验证——按当前决定，这两项本轮不做。
- **lens 运行时是真的模型驱动了**，不再只是硬编码规则。`apps/server/src/lenses/presets.ts` 声明四个预置 LensSpec（方法审查/实验统计/可复现性/新颖性），`run-model-lens.ts` 用声明式 prompt 调用模型，要求模型只返回 `{evidenceText, comment, severity, confidence}` 的 JSON，`evidenceText` 必须是原文的逐字子串——服务端用它在 `normalizedText` 里做字面查找算出真实 `evidenceSpan`（模型自己不产出坐标/区间，避免模型编造区间）。`model-client.ts` 是一个不依赖任何 SDK 的 OpenAI 兼容 `chat/completions` 调用，默认打 PPIO（`https://api.ppio.com/openai`，`.env` 的 `PPIO_BASE_URL`/`PPIO_MODEL` 可换）。`PPIO_API_KEY` 留空时 `run-all-lenses.ts` 退回 `fake-lens.ts`（保留用于无 key 的开发/CI）。**没有做的**：个人（client-side）lens——02 文档 #6 说 org lens 服务端跑、个人 lens 客户端跑用用户自己的 key，本轮只做了前者；prompt/输出没有针对任何 golden set 调过质量，按当前决定这轮不做。已用真实论文（AgentSpec.pdf）跑通全链路验证（extraction → reassembly → 模型调用 → 证据校验 → 入库 → 前端展示）。
- **证据校验（`apps/server/src/evidence/`）只做了三件事里的两件。** `verify-evidence.ts` 检查 evidenceSpan 是否真实落在 normalizedText 范围内、是否落在 lens 声明的 scope 内；`apply-verification.ts` 把结果接到写库前——存在性不达标直接丢弃，scope 不达标降级为 `info`/低置信度但保留。**第三件事（区间内容与 comment 语义是否相符）没有实现**，因为诚实地做这件事需要独立于产出 lens 的第二次模型调用去核对，属于没做过的新工作，不是"顺手"能加的；用字符串相似度之类的启发式伪造会比不做还糟——它会在未来的评测里冒充"已验证"。`EvidenceVerification.semanticMatch` 字段固定为 `null`，不要读成通过。
- **SSO 已接入**（标准 OAuth2 Authorization Code + PKCE，默认 mirpass，见 02 文档第 11 节）。`apps/server/src/auth/` 是核心：`pkce.ts` 生成 state/code_verifier/code_challenge；`oauth-state.ts` 用一个签名、httpOnly、10 分钟过期的 cookie 在 `/api/auth/login` → IdP → `/api/auth/callback` 这段跳转之间带 state+verifier（无服务端内存态，重启/多实例都不受影响）；`session.ts` 用同样的签名 cookie（`sign()`/`verify()` 在 `signed-value.ts`，纯函数，有单测）保存登录会话，不是 JWT，只是一个签了名的 userId。`GET /api/auth/login`、`GET /api/auth/callback`、`GET /api/auth/me`、`POST /api/auth/logout` 四个路由；`sso_config` 表存端点与 client 凭据（迁移 `0002_sso_and_storage.sql` 用 `MIRPASS_CLIENT_ID` 环境变量做首启种子值，之后以表里的值为准），`GET/PUT /api/admin/sso-config`（仅 `admin` 角色）是管理面板要调的接口，`clientSecret` 只写不读（GET 只返回 `hasClientSecret` 布尔值）。**`authorId` 现在只来自已认证会话**——`ensureDemoUser` 占位函数已删除，`POST/PATCH/DELETE .../human-annotations` 现在都要求登录（`requireAuth`），且编辑/删除标注要求 `req.user.id === existing.authorId`（02 文档第 4 节："member 读写自己的标注"，没有 admin/curator 越权改别人标注的例外）。第一个 admin 从 `.env` 的 `ADMIN_EMAILS`（逗号分隔）读取，SSO 回调第一次见到该邮箱时把这个新建用户设为 `admin`；之后角色只能通过系统自己的表改，SSO 不再提供角色。**验证情况**：`/api/auth/login` 的跳转 URL、client_id、PKCE 参数已核对无误；完整的登录往返（跳到 mirpass、真人登录、回调换 token）需要打开浏览器手动走一遍——这是我没有浏览器工具能做的部分，麻烦手动登录验证一次。
- **人类标注 CRUD 已实现并跑通乐观锁**（`apps/server/src/routes/human-annotations.ts` + `db/repositories.ts`）：`POST /api/documents/:docId/human-annotations` 创建；`PATCH .../:id` 需要带 `version`，版本不匹配返回 409 + 当前行；`DELETE .../:id?version=N` 同理，软删除（`deleted_at`），已过手动并发冲突测试。`GET /api/documents/:id/annotations` 现在合并返回 agent 标注与人类标注（已排除软删除）——**注意这个合并列表目前没做 visibility 过滤**（02 文档 #5 的 private/org 区分），任何登录用户都能看到同文档下所有人的标注，这是已知但还没补的口子。所有标注变更（lens 产出新一批、人类标注增删改）统一广播 `annotations:changed` socket 事件，前端收到后整体 refetch，不做增量 diff。
- **PDF 原文件与 CharMap 现在会持久化。** 上传的 PDF 字节存在 `apps/server/uploads/<contentHash>.pdf`（磁盘，已 gitignore），`GET /api/documents/:id/file` 原样吐出，供前端 `pdfjs-dist` 渲染用；CharMap 存进 `documents.char_map`（LONGTEXT/JSON），`GET /api/documents/:id/charmap` 单独取，因为大多数调用方（证据校验、标注列表）都不需要它。
- **迁移是手写 SQL + 自制 runner**（`apps/server/src/db/migrate.ts`），因为 02 文档列的候选 `node-pg-migrate` 只支持 Postgres，不适用于 MariaDB；新增迁移直接在 `apps/server/src/db/migrations/` 下加下一个编号的 `.sql` 文件。

## 已定的技术选型（补充 02 文档第 12 节的"候选"）

02 文档把 HTTP 框架、WebSocket 库、数据访问方式列为"候选，动手时定"。已定：

| 用途 | 选型 | 理由 |
| --- | --- | --- |
| 包管理 / monorepo | pnpm workspaces | 前后端共用 `@paper-xray/contracts` 包，无需额外的任务编排工具 |
| HTTP 框架 | Express | 团队熟悉度优先 |
| WebSocket | socket.io | 房间抽象直接对应「文档房间」概念，服务端广播场景够用 |
| 数据访问 | mysql2 + 手写 SQL | 匹配 02 文档对 JSON 列、乐观锁 `UPDATE...WHERE version=?` 的精确控制要求 |
| 测试框架 | Vitest | 前端已用 Vite，配置复用，无需处理 ts-jest 的 ESM 摩擦 |
