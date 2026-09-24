import type {
  Anchor,
  Annotation,
  CharMap,
  Document,
  DocumentSummary,
  LensDraft,
  LensOutputItem,
  LensSpec,
  Node as IrNode,
  Role,
  SsoConfigPublic,
  User,
  Visibility,
} from "@paper-xray/contracts";

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

/** Server fetches the PDF itself (arXiv /abs/ links are canonicalized to the PDF), under its host allowlist + SSRF policy. */
export async function importDocumentFromUrl(url: string): Promise<Document> {
  const res = await fetch(`${API_BASE}/documents/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Import failed: ${res.status}`);
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

/** Throws with the server's `error` message when there is one. */
async function jsonOrThrow<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `${fallback}: ${res.status}`);
  }
  return (await res.json()) as T;
}

function sendJson(method: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
}

/** Org lenses plus the caller's own personal lenses. */
export async function fetchLenses(): Promise<LensSpec[]> {
  const res = await fetch(`${API_BASE}/lenses`, { credentials: "include" });
  return (await jsonOrThrow<{ lenses: LensSpec[] }>(res, "Failed to load lens catalog")).lenses;
}

export async function createLens(draft: LensDraft, org: boolean): Promise<LensSpec> {
  const res = await sendJson("POST", "/lenses", { ...draft, org });
  return (await jsonOrThrow<{ lens: LensSpec }>(res, "Failed to create lens")).lens;
}

export async function updateLens(id: string, draft: LensDraft): Promise<LensSpec> {
  const res = await sendJson("PUT", `/lenses/${id}`, draft);
  return (await jsonOrThrow<{ lens: LensSpec }>(res, "Failed to save lens")).lens;
}

export async function deleteLens(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/lenses/${id}`, { method: "DELETE", credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to delete lens: ${res.status}`);
  }
}

export interface LensRunResult {
  producedCount: number;
  submittedCount: number;
}

/** Hands a personal lens's raw model output to the server, which locates and re-verifies every quote itself. */
export async function submitClientLensRun(docId: string, lensId: string, items: LensOutputItem[]): Promise<LensRunResult> {
  const res = await sendJson("POST", `/documents/${docId}/lenses/${lensId}/client-run`, { items });
  return jsonOrThrow<LensRunResult>(res, "Failed to submit lens results");
}

export async function setRunVisibility(docId: string, runId: string, visibility: Visibility): Promise<void> {
  const res = await sendJson("PATCH", `/documents/${docId}/runs/${runId}/visibility`, { visibility });
  await jsonOrThrow<unknown>(res, "Failed to change run visibility");
}

export async function fetchUsers(): Promise<User[]> {
  const res = await fetch(`${API_BASE}/admin/users`, { credentials: "include" });
  return (await jsonOrThrow<{ users: User[] }>(res, "Failed to load users")).users;
}

export async function setUserRole(userId: string, role: Role): Promise<User> {
  const res = await sendJson("PATCH", `/admin/users/${userId}/role`, { role });
  return (await jsonOrThrow<{ user: User }>(res, "Failed to change role")).user;
}

export async function fetchSsoConfig(): Promise<SsoConfigPublic> {
  const res = await fetch(`${API_BASE}/admin/sso-config`, { credentials: "include" });
  return (await jsonOrThrow<{ ssoConfig: SsoConfigPublic }>(res, "Failed to load SSO settings")).ssoConfig;
}

/** `clientSecret`: a string sets it, null clears it, undefined leaves it unchanged (it's write-only). */
export async function saveSsoConfig(
  config: Omit<SsoConfigPublic, "hasClientSecret"> & { clientSecret?: string | null },
): Promise<SsoConfigPublic> {
  const res = await sendJson("PUT", "/admin/sso-config", config);
  return (await jsonOrThrow<{ ssoConfig: SsoConfigPublic }>(res, "Failed to save SSO settings")).ssoConfig;
}

/** Runs an org lens on the server. */
export async function runLens(docId: string, lensId: string): Promise<LensRunResult> {
  const res = await fetch(`${API_BASE}/documents/${docId}/lenses/${lensId}/run`, {
    method: "POST",
    credentials: "include",
  });
  return jsonOrThrow<LensRunResult>(res, "Lens run failed");
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
