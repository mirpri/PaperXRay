# Lens 后台运行与状态恢复

组织 Provider 的 Lens 在服务端后台执行。个人 Provider 的密钥仍保留在浏览器，个人客户端执行方式不变。

## 接口

- `POST /api/documents/:id/lenses/:lensId/run`：立即返回 HTTP 202 和 `{ "status": "queued" }` 或 `{ "status": "running" }`，不返回任务 ID。
- `GET /api/documents/:id/lens-runs`：保留原 `lensRuns` 完成记录，并新增 `activity`，返回各 Lens 的当前状态、阶段、结果数量、错误和更新时间。
- 状态为 `queued / running / succeeded / failed`；阶段为 `queued / model / verifying / completed / failed`。模型调用无法提供真实的完成百分比，因此显示阶段，不模拟百分比。
- 状态权限与原 Lens 查询一致：组织 Lens 对已批准成员可见，个人 Lens 仅其所有者可见。

前端每 2.5 秒查询状态，并监听 `lens-runs:changed` 和 `annotations:changed` Socket 事件立即更新。刷新阅读页后重新读取服务端状态，完成后加载新标注。Socket 只发送重新查询的信号，不发送个人 Lens 的运行详情。

## 持久化及执行

`lens_run_state` 每个 `(doc_id, lens_id)` 保存一条当前状态。数据库原子 upsert 防止同一 Lens 重复排队；已完成或失败后可重新运行。结果、完成记录及成功状态在同一事务提交，避免出现“显示完成但标注未落库”。

服务端启动时自动以 `CREATE TABLE IF NOT EXISTS` 添加状态表，无需重建已有数据库；新安装的 `schema.sql` 也包含该表。数据库账号需要建表权限。

每个服务器进程最多并行执行两个 Lens，通过数据库事务领取排队项。模型请求上限为 8 分钟；运行期间每 30 秒续租一次，租约为 90 秒。执行进程崩溃后，过期运行会显示失败，可手动重试；尚未领取的排队项会在服务恢复后继续执行。内部领取令牌只用于防止过期 worker 写入结果，不暴露给前端。

此改动消除浏览器到应用服务器之间等待整个模型调用导致的网关超时。模型 Provider 自身返回的 504 仍会作为运行失败显示。
