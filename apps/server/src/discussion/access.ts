import type { Annotation } from "@paper-xray/contracts";
import { findAgentAnnotationById, findHumanAnnotationById } from "../db/repositories.js";

/** Replies follow the thread root's current visibility, including run sharing changes. */
export async function visibleRoot(annotation: Annotation, viewerId: string): Promise<Annotation | null> {
  let root: Annotation | null = annotation;
  if ("authorId" in annotation && annotation.parentId) {
    root = annotation.threadRootKind === "agent"
      ? await findAgentAnnotationById(annotation.threadRootId!)
      : await findHumanAnnotationById(annotation.threadRootId!);
  }
  if (!root || root.docId !== annotation.docId) return null;
  const owner = "authorId" in root ? root.authorId : root.ownerId;
  return root.visibility === "org" || owner === viewerId ? root : null;
}
