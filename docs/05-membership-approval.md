# 新成员审批

首次 SSO 登录创建 `pending` 成员，并在同一事务内为所有当前有效管理员写入 `membership_requested` 消息。重复登录复用原账号，不重复发送申请。消息可从 Messages 进入 Admin 审批。

`pending` 用户可以读取自己的登录状态或退出登录，但不能调用受保护的业务 API，也不能连接文献实时频道。前端显示等待审批页面，通过 Check approval 重新读取状态。

管理员在 Admin 的用户列表点击 Approve 后，用户状态变为 `active`，所有该申请的管理员通知标为已读。其他管理员的未读数和用户列表通过现有通知事件刷新。调整角色不能绕过审批。

全新安装使用 `schema.sql`。已有部署运行 `pnpm db:membership`：为已有用户保留 `active`，新增用户默认 `pending`，创建 `membership_notifications` 表。此命令可重复运行。

只有尚无有效管理员时，配置的 bootstrap 管理员邮箱可以初始化首个有效管理员。已有管理员之后，新账号仍按普通成员申请加入。
