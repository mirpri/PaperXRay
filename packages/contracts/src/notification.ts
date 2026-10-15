export interface AnnotationNotification {
  id: string;
  kind: "reply" | "upvote" | "downvote" | "cancel_upvote" | "cancel_downvote" | "collection_shared" | "collection_left" | "membership_requested" | "paper_comment";
  actorId: string;
  actorName: string;
  docId: string | null;
  documentTitle: string | null;
  targetId: string;
  targetKind: "human" | "agent" | null;
  threadRootId: string | null;
  threadRootKind: "human" | "agent" | null;
  collectionId?: string | null;
  preview: string;
  parentPreview: string | null;
  createdAt: string;
  readAt: string | null;
}
export interface NotificationPage {
  notifications: AnnotationNotification[];
  nextCursor: string | null;
}
