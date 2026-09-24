import type { Anchor, Annotation, CharMap, Document, DocumentSummary, Node as IrNode, User, Visibility } from "@paper-xray/contracts";

export interface LensInfo {
  id: string;
  name: string;
  description: string;
}

export interface LensRun {
  lensId: string;
  producedCount: number;
  ranAt: string;
}

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3001/api";

export function documentFileUrl(docId: string): string {
  return `${API_BASE}/documents/${docId}/file`;
}

export function loginUrl(): string {
  return `${API_BASE}/auth/login`;
}

export async function uploadDocument(file: File): Promise<Document> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/documents`, { method: "POST", body: form, credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Upload failed: ${res.status}`);
  }
  const body = (await res.json()) as { document: Document };
  return body.document;
}

export async function fetchDocuments(): Promise<DocumentSummary[]> {
  const res = await fetch(`${API_BASE}/documents`, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Failed to load documents: ${res.status}`);
  }
  const body = (await res.json()) as { documents: DocumentSummary[] };
  return body.documents;
}

export async function fetchDocument(docId: string): Promise<Document> {
  const res = await fetch(`${API_BASE}/documents/${docId}`, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Failed to load document: ${res.status}`);
  }
  const body = (await res.json()) as { document: Document };
  return body.document;
}

export async function fetchAnnotations(docId: string): Promise<Annotation[]> {
  const res = await fetch(`${API_BASE}/documents/${docId}/annotations`, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Failed to load annotations: ${res.status}`);
  }
  const body = (await res.json()) as { annotations: Annotation[] };
  return body.annotations;
}

export async function fetchCharMap(docId: string): Promise<CharMap> {
  const res = await fetch(`${API_BASE}/documents/${docId}/charmap`, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Failed to load CharMap: ${res.status}`);
  }
  const body = (await res.json()) as { charMap: CharMap };
  return body.charMap;
}

export async function fetchNodes(docId: string): Promise<IrNode[]> {
  const res = await fetch(`${API_BASE}/documents/${docId}/nodes`, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Failed to load nodes: ${res.status}`);
  }
  const body = (await res.json()) as { nodes: IrNode[] };
  return body.nodes;
}

export async function fetchLenses(): Promise<LensInfo[]> {
  const res = await fetch(`${API_BASE}/lenses`, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Failed to load lens catalog: ${res.status}`);
  }
  const body = (await res.json()) as { lenses: LensInfo[] };
  return body.lenses;
}

export async function runLens(docId: string, lensId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/documents/${docId}/lenses/${lensId}/run`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Lens run failed: ${res.status}`);
  }
}

export async function fetchLensRuns(docId: string): Promise<LensRun[]> {
  const res = await fetch(`${API_BASE}/documents/${docId}/lens-runs`, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Failed to load lens run status: ${res.status}`);
  }
  const body = (await res.json()) as { lensRuns: LensRun[] };
  return body.lensRuns;
}

export async function createHumanAnnotation(
  docId: string,
  params: { anchor: Anchor; body: string; visibility?: Visibility },
): Promise<void> {
  const res = await fetch(`${API_BASE}/documents/${docId}/human-annotations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to create annotation: ${res.status}`);
  }
}

export async function fetchMe(): Promise<User | null> {
  const res = await fetch(`${API_BASE}/auth/me`, { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Failed to load current user: ${res.status}`);
  const body = (await res.json()) as { user: User };
  return body.user;
}

export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/auth/logout`, { method: "POST", credentials: "include" });
}
