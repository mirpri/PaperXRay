import type { Annotation, HumanAnnotation, Role } from "@paper-xray/contracts";

export function canDeleteComment(comment: HumanAnnotation, userId: string | null, role?: Role): boolean {
  return !!userId && (comment.authorId === userId || role === "admin");
}

/** Ancestors of live replies remain as tombstones; deleted leaves disappear. */
export function commentThreads(annotations: Annotation[]) {
  const replies = annotations.filter((a): a is HumanAnnotation => "authorId" in a && !!a.parentId);
  const humans = new Map(annotations.filter((a): a is HumanAnnotation => "authorId" in a).map(a => [a.id, a]));
  const retained = new Set<string>();
  for (const a of humans.values()) {
    if (a.deletedAt) continue;
    let node: HumanAnnotation | undefined = a;
    while (node && !retained.has(node.id)) {
      retained.add(node.id);
      node = node.parentKind === "human" && node.parentId ? humans.get(node.parentId) : undefined;
    }
  }
  const byParent = new Map<string, HumanAnnotation[]>();
  for (const reply of replies) {
    if (!retained.has(reply.id)) continue;
    const key = `${reply.parentKind}:${reply.parentId}`;
    const siblings = byParent.get(key) ?? [];
    siblings.push(reply); byParent.set(key, siblings);
  }
  const roots = annotations.filter(a => !("authorId" in a) || (!a.parentId && retained.has(a.id)));
  return { roots, byParent };
}
