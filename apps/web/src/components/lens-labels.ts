import type { AgentAnnotation, Annotation, LensSpec } from "@paper-xray/contracts";

export function annotationLensLabel(annotation: AgentAnnotation, viewerId: string | null): string {
  const name = annotation.lensName ?? "Lens";
  const isForeignOwner = annotation.ownerId && annotation.ownerId !== viewerId;
  return isForeignOwner
    ? `${name} (${annotation.ownerName ?? "Member"})`
    : name;
}

/** Shared runs carry their display metadata even when their Lens is outside the viewer's catalog. */
export function readerLensLabels(annotations: Annotation[], catalog: Pick<LensSpec, "id" | "name">[], viewerId: string | null): Map<string, string> {
  const labels = new Map<string, string>();
  for (const annotation of annotations) {
    if ("agentId" in annotation) labels.set(annotation.agentId, annotationLensLabel(annotation, viewerId));
  }
  for (const lens of catalog) labels.set(lens.id, lens.name);
  return labels;
}
