import type {
  Anchor,
  Annotation,
  CharMap,
  Document,
  DocumentSummary,
  DocumentListQuery,
  DocumentPage,
  CollectionPage,
  CollectionSummary,
  CollectionMember,
  CollectionUserOption,
  LensDraft,
  LensRunActivity,
  AiReplyStarted,
  LensOutputItem,
  LensSpec,
  Node as IrNode,
  ModelProvider,
  NotificationPage,
  ProviderDraft,
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

export async function fetchPaperSubscription(docId: string): Promise<{ subscribed: boolean }> {
  return jsonOrThrow(await fetch(`${API_BASE}/documents/${docId}/subscription`, { credentials: "include" }), "Failed to load subscription");
}

export async function setPaperSubscription(docId: string, subscribed: boolean): Promise<{ subscribed: boolean }> {
  return jsonOrThrow(await fetch(`${API_BASE}/documents/${docId}/subscription`, {
    method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscribed }),
  }), "Failed to update subscription");
}

export function documentFileUrl(docId: string): string {
  return `${API_BASE}/documents/${docId}/file`;
}

export function loginUrl(): string {
  return `${API_BASE}/auth/login`;
}

export type UploadProgress =
  | { phase: "uploading"; percent: number | null }
  | { phase: "processing" };

export function uploadDocument(file: File, onProgress?: (progress: UploadProgress) => void): Promise<Document> {
  const form = new FormData();
  form.append("file", file);
  return new Promise((resolve, reject) => {
    // Fetch does not expose upload progress; XHR reports actual bytes sent.
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/documents`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      onProgress?.({
        phase: "uploading",
        percent: event.lengthComputable && event.total > 0
          ? Math.min(99, Math.floor((event.loaded / event.total) * 100))
          : null,
      });
    };
    xhr.upload.onload = () => onProgress?.({ phase: "processing" });
    xhr.onload = () => {
      let body: { document?: Document; error?: string };
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error(`Upload failed: ${xhr.status}`));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(body.error ?? `Upload failed: ${xhr.status}`));
      } else if (!body.document) {
        reject(new Error("Upload failed: invalid server response"));
      } else {
        resolve(body.document);
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed: network error"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.ontimeout = () => reject(new Error("Upload timed out"));
    xhr.send(form);
  });
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

export async function fetchCollections(): Promise<CollectionSummary[]> {
  const res = await fetch(`${API_BASE}/collections`, { credentials: "include" });
  return (await jsonOrThrow<{ collections: CollectionSummary[] }>(res, "Failed to load collections")).collections;
}

export async function createCollection(input: { name: string; description: string }): Promise<CollectionSummary> {
  const res = await sendJson("POST", "/collections", input);
  return (await jsonOrThrow<{ collection: CollectionSummary }>(res, "Failed to create collection")).collection;
}

export async function fetchCollection(id: string, query: DocumentListQuery, signal?: AbortSignal): Promise<CollectionPage> {
  const params = new URLSearchParams({ sort: query.sort, page: String(query.page), pageSize: String(query.pageSize) });
  if (query.search) params.set("q", query.search);
  const res = await fetch(`${API_BASE}/collections/${encodeURIComponent(id)}?${params}`, { credentials: "include", signal });
  return jsonOrThrow<CollectionPage>(res, "Failed to load collection");
}

export async function saveCollection(id: string, input: { name: string; description: string }): Promise<CollectionSummary> {
  const res = await sendJson("PUT", `/collections/${encodeURIComponent(id)}`, input);
  return (await jsonOrThrow<{ collection: CollectionSummary }>(res, "Failed to update collection")).collection;
}

export async function deleteCollection(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/collections/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" });
  if (!res.ok) await jsonOrThrow(res, "Failed to delete collection");
}

export async function fetchCollectionUsers(id: string): Promise<CollectionUserOption[]> {
  const res = await fetch(`${API_BASE}/collections/${encodeURIComponent(id)}/users`, { credentials: "include" });
  return (await jsonOrThrow<{ users: CollectionUserOption[] }>(res, "Failed to load users")).users;
}

export async function saveCollectionMembers(id: string, userIds: string[]): Promise<CollectionMember[]> {
  const res = await sendJson("PUT", `/collections/${encodeURIComponent(id)}/members`, { userIds });
  return (await jsonOrThrow<{ members: CollectionMember[] }>(res, "Failed to update sharing")).members;
}

export async function leaveCollection(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/collections/${encodeURIComponent(id)}/membership/me`, { method: "DELETE", credentials: "include" });
  if (!res.ok) await jsonOrThrow(res, "Failed to leave collection");
}

export async function addDocumentToCollection(id: string, docId: string): Promise<boolean> {
  const res = await sendJson("POST", `/collections/${encodeURIComponent(id)}/documents`, { docId });
  return (await jsonOrThrow<{ added: boolean }>(res, "Failed to add paper")).added;
}

export async function removeDocumentFromCollection(id: string, docId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/collections/${encodeURIComponent(id)}/documents/${encodeURIComponent(docId)}`, { method: "DELETE", credentials: "include" });
  if (!res.ok) await jsonOrThrow(res, "Failed to remove paper");
}

export async function importDocumentToCollection(id: string, url: string): Promise<{ document: Document; added: boolean }> {
  const res = await sendJson("POST", `/collections/${encodeURIComponent(id)}/import`, { url });
  return jsonOrThrow<{ document: Document; added: boolean }>(res, "Failed to import paper");
}

export async function fetchDocuments(query: DocumentListQuery, signal?: AbortSignal): Promise<DocumentPage> {
  const params = new URLSearchParams({ sort: query.sort, page: String(query.page), pageSize: String(query.pageSize) });
  if (query.search) params.set("q", query.search);
  const res = await fetch(`${API_BASE}/documents?${params}`, { credentials: "include", signal });
  return jsonOrThrow<DocumentPage>(res, "Failed to load documents");
}

export async function updateDocumentTitle(docId: string, title: string): Promise<DocumentSummary> {
  const res = await sendJson("PATCH", `/documents/${encodeURIComponent(docId)}`, { title });
  return (await jsonOrThrow<{ document: DocumentSummary }>(res, "Failed to update title")).document;
}

export async function deleteDocument(docId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/documents/${encodeURIComponent(docId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    await jsonOrThrow(res, "Failed to delete document");
  }
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

export async function approveUser(userId: string): Promise<User> {
  const res = await sendJson("POST", `/admin/users/${encodeURIComponent(userId)}/approve`, {});
  return (await jsonOrThrow<{ user: User }>(res, "Failed to approve member")).user;
}

export interface UserDeletionPreview {
  user: User;
  ownedCollections: number;
  annotations: number;
  personalLenses: number;
  personalProviders: number;
  privateLensAnnotations: number;
  sharedLensAnnotations: number;
}
export async function fetchUserDeletionPreview(userId: string): Promise<UserDeletionPreview> {
  const res = await fetch(`${API_BASE}/admin/users/${encodeURIComponent(userId)}/deletion-preview`, { credentials: "include", cache: "no-store" });
  return jsonOrThrow<UserDeletionPreview>(res, "Failed to load deletion preview");
}
export async function deleteUser(userId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE", credentials: "include" });
  if (!res.ok) await jsonOrThrow(res, "Failed to delete user");
}

export interface Invitation {
  id: string;
  code: string;
  email: string | null;
  role: Role;
  expiresAt: string | null;
  usedAt: string | null;
  usedBy: string | null;
  usedByName: string | null;
  createdAt: string;
}

export type RegistrationMode = "invite_only" | "approval_required" | "open";

export async function fetchInvitations(): Promise<Invitation[]> {
  const res = await fetch(`${API_BASE}/admin/invitations`, { credentials: "include" });
  return jsonOrThrow<Invitation[]>(res, "Failed to load invitations");
}

export async function createInvitation(params: {
  email?: string;
  role: Role;
  expiresInDays?: number;
}): Promise<Invitation> {
  const res = await fetch(`${API_BASE}/admin/invitations`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return jsonOrThrow<Invitation>(res, "Failed to create invitation");
}

export async function deleteInvitation(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/invitations/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) await jsonOrThrow(res, "Failed to delete invitation");
}

export async function fetchRegistrationMode(): Promise<RegistrationMode> {
  const res = await fetch(`${API_BASE}/admin/registration-mode`, { credentials: "include" });
  const data = await jsonOrThrow<{ mode: RegistrationMode }>(res, "Failed to load registration mode");
  return data.mode;
}

export async function setRegistrationMode(mode: RegistrationMode): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/registration-mode`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) await jsonOrThrow(res, "Failed to set registration mode");
}

export async function validateInvitationCode(code: string): Promise<{
  valid: boolean;
  role?: Role;
  email?: string | null;
  error?: string;
}> {
  const res = await fetch(`${API_BASE}/public/invitations/validate/${encodeURIComponent(code)}`);
  return jsonOrThrow(res, "Failed to validate invitation");
}

export const ACCOUNT_MANAGEMENT_URL_CHANGED = "pxr:account-management-url-changed";
export async function fetchAccountManagementUrl(): Promise<string | null> {
  const res = await fetch(`${API_BASE}/auth/account-management`, { credentials: "include", cache: "no-store" });
  return (await jsonOrThrow<{ accountManagementUrl: string | null }>(res, "Failed to load account management link")).accountManagementUrl;
}

export async function fetchSsoConfig(): Promise<SsoConfigPublic> {
  const res = await fetch(`${API_BASE}/admin/sso-config`, { credentials: "include" });
  return (await jsonOrThrow<{ ssoConfig: SsoConfigPublic }>(res, "Failed to load SSO settings")).ssoConfig;
}

export async function exportSsoConfigJson(): Promise<Blob> {
  const res = await fetch(`${API_BASE}/admin/sso-config/export`, { credentials: "include", cache: "no-store" });
  if (!res.ok) await jsonOrThrow(res, "Failed to export SSO settings");
  return res.blob();
}

/** `clientSecret`: a string sets it, null clears it, undefined leaves it unchanged (it's write-only). */
export async function saveSsoConfig(
  config: Omit<SsoConfigPublic, "hasClientSecret"> & { clientSecret?: string | null },
): Promise<SsoConfigPublic> {
  const res = await sendJson("PUT", "/admin/sso-config", config);
  const saved = (await jsonOrThrow<{ ssoConfig: SsoConfigPublic }>(res, "Failed to save SSO settings")).ssoConfig;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(ACCOUNT_MANAGEMENT_URL_CHANGED, { detail: saved.accountManagementUrl ?? null }));
  }
  return saved;
}

/** Runs an org lens on the server. */
export async function runLens(docId: string, lensId: string): Promise<{ status: "queued" | "running" }> {
  const res = await fetch(`${API_BASE}/documents/${docId}/lenses/${lensId}/run`, {
    method: "POST",
    credentials: "include",
  });
  return jsonOrThrow(res, "Lens run failed");
}

export async function fetchLensRunStatus(docId: string): Promise<{ lensRuns: LensRun[]; activity: LensRunActivity[] }> {
  const res = await fetch(`${API_BASE}/documents/${docId}/lens-runs`, { credentials: "include", cache: "no-store" });
  return jsonOrThrow(res, "Failed to load lens run status");
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
  params: { anchor: Anchor; body: string; visibility?: Visibility; color?: string },
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

export async function fetchProviders(): Promise<ModelProvider[]> {
  const res = await fetch(`${API_BASE}/providers`, { credentials: "include" });
  return (await jsonOrThrow<{ providers: ModelProvider[] }>(res, "Failed to load providers")).providers;
}
export async function saveProvider(id: string | null, draft: ProviderDraft, org: boolean): Promise<ModelProvider> {
  const res = await sendJson(id ? "PUT" : "POST", id ? `/providers/${encodeURIComponent(id)}` : "/providers", { ...draft, org });
  return (await jsonOrThrow<{ provider: ModelProvider }>(res, "Failed to save provider")).provider;
}
export async function deleteProvider(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/providers/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" });
  if (!res.ok) await jsonOrThrow(res, "Failed to delete provider");
}

export async function exportProvidersJson(): Promise<Blob> {
  const res = await fetch(`${API_BASE}/admin/providers/export`, { credentials: "include", cache: "no-store" });
  if (!res.ok) await jsonOrThrow(res, "Failed to export providers");
  return res.blob();
}

export interface ProviderImportItem {
  name: string;
  baseUrl: string;
  models: string[];
  apiKey?: string | null;
}

export async function importProvidersJson(providers: ProviderImportItem[]): Promise<void> {
  const res = await sendJson("POST", "/admin/providers/import", { providers });
  if (!res.ok) await jsonOrThrow(res, "Failed to import providers");
}

export async function updateComment(docId: string, id: string, body: string, version: number, color?: string): Promise<void> {
  await jsonOrThrow(await sendJson("PATCH", `/documents/${docId}/human-annotations/${id}`, { body, version, color }), "Failed to edit comment");
}
export async function deleteComment(docId: string, id: string, version: number): Promise<void> {
  const res = await fetch(`${API_BASE}/documents/${docId}/human-annotations/${id}?version=${version}`, { method: "DELETE", credentials: "include" });
  if (!res.ok) await jsonOrThrow(res, "Failed to delete comment");
}
export async function replyToComment(docId: string, id: string, parentKind: "human" | "agent", body: string): Promise<void> {
  await jsonOrThrow(await sendJson("POST", `/documents/${docId}/annotations/${id}/replies`, { body, parentKind }), "Failed to reply");
}

export async function requestAiReply(docId: string, parentId: string, params: {
  parentKind: "human" | "agent"; providerId: string; model: string;
}): Promise<AiReplyStarted> {
  return jsonOrThrow(await sendJson("POST", `/documents/${docId}/annotations/${parentId}/ai-replies`, params), "Failed to request AI reply");
}

export async function submitAiReplyResult(docId: string, replyId: string, body: string, failed = false): Promise<void> {
  await jsonOrThrow(await sendJson("PUT", `/documents/${docId}/ai-replies/${replyId}/client-result`, { body, failed }), "Failed to save AI reply");
}

export async function fetchNotifications(before?: string): Promise<NotificationPage> {
  const suffix = before ? `?before=${encodeURIComponent(before)}` : "";
  return jsonOrThrow<NotificationPage>(await fetch(`${API_BASE}/notifications${suffix}`, { credentials: "include" }), "Failed to load messages");
}
export async function fetchUnreadNotificationCount(): Promise<number> {
  const body = await jsonOrThrow<{ unreadCount: number }>(await fetch(`${API_BASE}/notifications/unread-count`, { credentials: "include" }), "Failed to load unread count");
  return body.unreadCount;
}
export async function markMessageRead(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH", credentials: "include" });
  if (!res.ok) await jsonOrThrow(res, "Failed to mark message read");
}
export async function markAllMessagesRead(): Promise<void> {
  const res = await fetch(`${API_BASE}/notifications/read-all`, { method: "POST", credentials: "include" });
  if (!res.ok) await jsonOrThrow(res, "Failed to mark messages read");
}

export async function voteOnAnnotation(docId: string, id: string, kind: "human" | "agent", value: -1 | 0 | 1): Promise<import("@paper-xray/contracts").AnnotationVotes> {
  const result = await jsonOrThrow<{ votes: import("@paper-xray/contracts").AnnotationVotes }>(await sendJson("PUT", `/documents/${docId}/annotations/${id}/vote`, { kind, value }), "Failed to vote");
  return result.votes;
}
