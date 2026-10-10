# 评测 harness 与 golden set

对应 `docs/02-decisions.md` 第 10 节 W4「证据校验 + golden set + 评测 harness」。

```bash
pnpm eval                      # 对 eval/golden/*.json 逐篇出报告
pnpm eval --out eval/report.md # 同时写入文件
pnpm eval --update-snapshots   # 有意改动解析器后，重新生成锚点快照（见下）
pnpm eval --record-runs        # 用管理面板中为各 Lens 配置的模型跑四个预置 lens，把原始输出存进 eval/runs/
```

`pnpm test` 里的 `apps/server/src/eval/golden.test.ts` 会跑同一套锚点与阅读顺序检查，所以解析器的回归会直接让测试变红。

## 测的是什么

| 指标 | 含义 | 数据来源 |
| --- | --- | --- |
| 阅读顺序 | 人工转录的句子能否在 `normalizedText` 里找到，且先后顺序正确 | `readingOrder.snippets`，人工照着渲染出的页面图片逐行抄写，**不取自 pdf.js 的输出** |
| CharMap 覆盖率 | 非空白字符里有多少能映射回 PDF text item（映射不回去的就画不出高亮） | 自动 |
| 锚点稳定性 | 已存的 `charRange` 在解析器改动后是否仍指向同一段文字（第 2 节要求的回归） | `eval/snapshots/*.anchors.json`，自动生成 |
| 证据通过率 | lens 输出的引文有多少能逐字找到、有多少通过服务端校验 | `eval/runs/`（录下来的 lens 原始输出） |
| 准确率 / 召回率 / F1 | lens 找出的证据与人工标注的重叠情况（与较短一段重叠 ≥ 50% 算命中，一对一匹配） | `lensGold.annotations`，**需要人工标注** |

「证据与 comment 语义是否相符」这项没有实现，所以报告里也不测它，`semanticMatch` 一直是 null。

## 锚点快照

快照记录 40 个均匀分布的 `charRange` 及其文字、前后文。改动提取层或重组层后：

- 全部 `stable`：可以合入。
- 出现 `relocated` / `lost`：库里已有标注会指错位置。如果这个改动是有意的，要先规划已有标注的迁移，再跑 `pnpm eval --update-snapshots` 更新基线。

## 加一篇论文

1. 把 PDF 放进仓库，在 `eval/golden/` 新建 `<名字>.json`，照 `agentix.json` 的结构填 `pdf`（相对仓库根目录）和 `contentHash`（`sha256sum` 的结果）。
2. 把页面渲染成图片，按真实阅读顺序（双栏先左后右）抄 15–25 句。每句只取印刷上的同一行，避开跨行连字符；图表内部文字不要选。
3. 跑一次 `pnpm eval` 生成锚点快照，连同 JSON 一起提交。

单栏、双栏、图表多的论文各至少一篇，指标才有代表性。

## 标注 lens 的金标准

`lensGold.annotations` 里每条写一个 lens 应该发现的问题：

```json
{ "lensId": "preset-reproducibility", "evidenceText": "We train for 3 epochs on a single node.", "note": "没写学习率与 batch size" }
```

`evidenceText` 必须是原文逐字摘录。每个 lens 至少标 5–10 条，并在 `labelledBy` 写上标注人。只有标过的 lens 才会报准确率和召回率。

## 当前发现（agentix）

- 20 句里找到 18 句，找到的全部顺序正确，CharMap 覆盖率 100%。
- 漏掉的两句都含斜体的 “Agentix”：重组层在字体切换处给整词前后都加了空格，逗号前也多出一个（`Agentix , an`）。摘要里每一行还被切成了单独的段落（行间是 `\n\n`）。这两处修掉之后，快照需要重新生成，已有标注也要迁移。
