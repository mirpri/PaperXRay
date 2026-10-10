import { Router, type Router as RouterType } from "express";
import { requireAuth } from "../auth/middleware.js";
import { countUnreadNotifications, listNotifications, markAllNotificationsRead, markNotificationRead, parseNotificationCursor } from "../db/notifications.js";
import { broadcastNotificationsChanged } from "../realtime/socket.js";
export const notificationsRouter: RouterType = Router();
notificationsRouter.use("/notifications", requireAuth);
notificationsRouter.get("/notifications/unread-count", async (req, res, next) => {
  try { res.json({ unreadCount: await countUnreadNotifications(req.user!.id) }); } catch (err) { next(err); }
});
notificationsRouter.get("/notifications", async (req, res, next) => {
  try {
    const cursor = req.query.before === undefined ? null : parseNotificationCursor(req.query.before);
    if (req.query.before !== undefined && !cursor) { res.status(400).json({ error: "Invalid notification cursor" }); return; }
    res.json(await listNotifications(req.user!.id, cursor));
  } catch (err) { next(err); }
});
notificationsRouter.patch("/notifications/:id/read", async (req, res, next) => {
  try {
    if (!(await markNotificationRead(req.user!.id, req.params.id))) { res.status(404).json({ error: "Message not found" }); return; }
    broadcastNotificationsChanged(req.user!.id); res.status(204).end();
  } catch (err) { next(err); }
});
notificationsRouter.post("/notifications/read-all", async (req, res, next) => {
  try { await markAllNotificationsRead(req.user!.id); broadcastNotificationsChanged(req.user!.id); res.status(204).end(); } catch (err) { next(err); }
});
