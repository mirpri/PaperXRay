export interface AnnotationNotification {
  id: string;
  kind: "reply" | "upvote" | "downvote" | "cancel_upvote" | "cancel_downvote";
  actorId: string;
  actorName: string;
  docId: string;
  documentTitle: string | null;
  targetId: string;
  targetKind: "human" | "agent";
  threadRootId: string;
  threadRootKind: "human" | "agent";
  preview: string;
  parentPreview: string | null;
  createdAt: string;
  readAt: string | null;
}
export interface NotificationPage {
  notifications: AnnotationNotification[];
  nextCursor: string | null;
}
