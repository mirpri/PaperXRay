# 论文订阅

阅读页标题旁提供 `Subscribe` / `Subscribed` 按钮。订阅属于当前用户，持久保存；取消订阅不删除历史消息。

- `GET /api/documents/:docId/subscription` 查询自己的订阅。
- `PUT /api/documents/:docId/subscription` 接收 `{ "subscribed": true | false }`，幂等更新自己的订阅。
- 接口要求已通过审核的登录用户；组织文献库中的论文均可订阅。

`paper_subscriptions` 以 `(doc_id, user_id)` 为主键。`paper_comment_notifications` 保存订阅通知，以 `(recipient_id, annotation_id)` 去重。两张表均在全量安装结构中定义，现有部署启动时自动补建，无需重装数据库。

真人新建标注或回复时，在同一事务中写入评论和通知。排除评论作者、待审核用户和无法访问当前讨论根节点的订阅者。被回复者已经收到直接回复通知时，不重复发送订阅通知。AI 回复和 Lens 输出不经过真人评论写入路径，因此不触发订阅通知。编辑、删除、投票也不新增订阅通知。

订阅通知复用 Messages 页的游标分页、未读数、标记已读和实时通知；点击跳转到相应论文的评论。读取时再次按讨论当前可见性过滤，评论被删除或讨论变为不可见后，对应通知不再出现在收件箱或未读数中。删除用户、论文或评论时通过外键清理对应数据。
