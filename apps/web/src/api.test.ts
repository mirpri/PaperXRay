import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchNotifications, fetchUnreadNotificationCount, markAllMessagesRead, markMessageRead, uploadDocument, voteOnAnnotation, fetchAccountManagementUrl, saveSsoConfig, ACCOUNT_MANAGEMENT_URL_CHANGED, exportSsoConfigJson, updateDocumentTitle, fetchDocuments } from "./api";

class UploadRequest {
  static current: UploadRequest;
  withCredentials = false;
  status = 201;
  responseText = JSON.stringify({ document: { id: "paper" } });
  upload = {
    onprogress: null as ((event: Partial<ProgressEvent>) => void) | null,
    onload: null as (() => void) | null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  open = vi.fn();
  send = vi.fn();
  constructor() { UploadRequest.current = this; }
}

describe("PDF upload", () => {
  beforeEach(() => vi.stubGlobal("XMLHttpRequest", UploadRequest));
  afterEach(() => vi.unstubAllGlobals());

  it("reports actual transfer progress, then processing until the server responds", async () => {
    const progress = vi.fn();
    const result = uploadDocument(new File(["pdf"], "paper.pdf", { type: "application/pdf" }), progress);
    const request = UploadRequest.current;
    expect(request.withCredentials).toBe(true);
    expect(request.open).toHaveBeenCalledWith("POST", expect.stringMatching(/\/documents$/));
    expect(request.send.mock.calls[0][0].get("file").name).toBe("paper.pdf");
    request.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    expect(progress).toHaveBeenLastCalledWith({ phase: "uploading", percent: 50 });
    request.upload.onprogress?.({ lengthComputable: false, loaded: 50, total: 0 });
    expect(progress).toHaveBeenLastCalledWith({ phase: "uploading", percent: null });
    request.upload.onload?.();
    expect(progress).toHaveBeenLastCalledWith({ phase: "processing" });
    request.onload?.();
    await expect(result).resolves.toEqual({ id: "paper" });
  });

  it("preserves the server error message", async () => {
    const result = uploadDocument(new File([], "paper.pdf"));
    const assertion = expect(result).rejects.toThrow("Authentication required");
    UploadRequest.current.status = 401;
    UploadRequest.current.responseText = JSON.stringify({ error: "Authentication required" });
    UploadRequest.current.onload?.();
    await assertion;
  });

  it("rejects a network failure", async () => {
    const result = uploadDocument(new File([], "paper.pdf"));
    const assertion = expect(result).rejects.toThrow("network error");
    UploadRequest.current.onerror?.();
    await assertion;
  });
});

describe("messages API", () => {
  const request = vi.fn();
  beforeEach(() => { request.mockReset(); vi.stubGlobal("fetch", request); });
  afterEach(() => vi.unstubAllGlobals());
  it("loads inbox pages with an encoded cursor and session credentials", async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ notifications: [], nextCursor: "next" })));
    await expect(fetchNotifications("2026-10-09T12:00:00.000Z|id")).resolves.toEqual({ notifications: [], nextCursor: "next" });
    expect(request).toHaveBeenCalledWith(expect.stringContaining("/notifications?before=2026-10-09T12%3A00%3A00.000Z%7Cid"), { credentials: "include" });
  });
  it("reads the unread count and handles empty 204 read responses", async () => {
    request.mockResolvedValueOnce(new Response(JSON.stringify({ unreadCount: 3 })));
    await expect(fetchUnreadNotificationCount()).resolves.toBe(3);
    request.mockResolvedValueOnce(new Response(null, { status: 204 })); await expect(markMessageRead("notification")).resolves.toBeUndefined();
    expect(request).toHaveBeenLastCalledWith(expect.stringMatching(/notifications\/notification\/read$/), { method: "PATCH", credentials: "include" });
    request.mockResolvedValueOnce(new Response(null, { status: 204 })); await expect(markAllMessagesRead()).resolves.toBeUndefined();
  });
  it("surfaces read failures instead of silently dropping unread messages", async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ error: "Message not found" }), { status: 404 }));
    await expect(markMessageRead("other-inbox")).rejects.toThrow("Message not found");
  });
});

describe("annotation voting API", () => {
  const request = vi.fn();
  beforeEach(() => { request.mockReset(); vi.stubGlobal("fetch", request); });
  afterEach(() => vi.unstubAllGlobals());
  it.each([1, -1, 0] as const)("submits vote %s and returns authoritative counts", async value => {
    request.mockResolvedValue(new Response(JSON.stringify({ votes: { upvotes: 2, downvotes: 1, myVote: value } })));
    await expect(voteOnAnnotation("doc", "comment", "human", value)).resolves.toEqual({ upvotes: 2, downvotes: 1, myVote: value });
    expect(request).toHaveBeenCalledWith(expect.stringMatching(/documents\/doc\/annotations\/comment\/vote$/), {
      method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "human", value }),
    });
  });
  it("shows permission errors from the server", async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ error: "Annotation not found" }), { status: 404 }));
    await expect(voteOnAnnotation("doc", "private", "agent", 1)).rejects.toThrow("Annotation not found");
  });
});

describe("account management link API", () => {
 const request = vi.fn(); const dispatchEvent = vi.fn();
 beforeEach(() => { request.mockReset(); dispatchEvent.mockReset(); vi.stubGlobal("fetch", request); vi.stubGlobal("window", { dispatchEvent }); vi.stubGlobal("CustomEvent", class { type: string; init: { detail: unknown }; constructor(type: string, init: { detail: unknown }) { this.type = type; this.init = init; } }); });
 afterEach(() => vi.unstubAllGlobals());
 it("reads the ordinary user's link endpoint without caching", async () => {
   request.mockResolvedValue(new Response(JSON.stringify({ accountManagementUrl: "https://idp.example/account" })));
   expect(await fetchAccountManagementUrl()).toBe("https://idp.example/account");
   expect(request).toHaveBeenCalledWith(expect.stringMatching(/auth\/account-management$/), { credentials: "include", cache: "no-store" });
 });
 it.each(["https://idp.example/account", undefined])("updates mounted account menus after a successful save (%s)", async accountManagementUrl => {
   const config = { providerName: "SSO", authorizationEndpoint: "https://idp.example/authorize", tokenEndpoint: "https://idp.example/token", userinfoEndpoint: "https://idp.example/user", clientId: "client", scopes: "", accountManagementUrl };
   request.mockResolvedValue(new Response(JSON.stringify({ ssoConfig: { ...config, hasClientSecret: false } })));
   await saveSsoConfig(config);
   expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: ACCOUNT_MANAGEMENT_URL_CHANGED, init: { detail: accountManagementUrl ?? null } }));
 });
 it("does not update the menu after a failed save", async () => {
   request.mockResolvedValue(new Response(JSON.stringify({ error: "Invalid URL" }), { status: 400 }));
   await expect(saveSsoConfig({ providerName: "", authorizationEndpoint: "", tokenEndpoint: "", userinfoEndpoint: "", clientId: "", scopes: "" })).rejects.toThrow("Invalid URL");
   expect(dispatchEvent).not.toHaveBeenCalled();
 });
});

describe("SSO JSON export API", () => {
 const request = vi.fn();
 beforeEach(() => { request.mockReset(); vi.stubGlobal("fetch", request); });
 afterEach(() => vi.unstubAllGlobals());
 it("downloads a JSON blob through the admin endpoint without caching", async () => {
   const data = JSON.stringify({ clientId: "client", clientSecret: "backup-test-secret" });
   request.mockResolvedValue(new Response(data, { headers: { "Content-Type": "application/json" } }));
   const blob = await exportSsoConfigJson(); expect(await blob.text()).toBe(data);
   expect(request).toHaveBeenCalledWith(expect.stringMatching(/admin\/sso-config\/export$/), { credentials: "include", cache: "no-store" });
 });
 it("surfaces export errors instead of downloading an error response", async () => {
   request.mockResolvedValue(new Response(JSON.stringify({ error: "Insufficient role" }), { status: 403 }));
   await expect(exportSsoConfigJson()).rejects.toThrow("Insufficient role");
 });
});

describe("document title API", () => {
  const request = vi.fn();
  beforeEach(() => { request.mockReset(); vi.stubGlobal("fetch", request); });
  afterEach(() => vi.unstubAllGlobals());
  it("saves only title metadata using the authenticated PATCH endpoint", async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ document: { id: "paper", title: "New title" } })));
    await expect(updateDocumentTitle("paper", "New title")).resolves.toEqual({ id: "paper", title: "New title" });
    expect(request).toHaveBeenCalledWith(expect.stringMatching(/documents\/paper$/), { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "New title" }) });
  });
  it("surfaces permission errors", async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ error: "Insufficient role" }), { status: 403 }));
    await expect(updateDocumentTitle("paper", "Title")).rejects.toThrow("Insufficient role");
  });
});

describe("library API", () => {
  const request = vi.fn();
  beforeEach(() => { request.mockReset(); vi.stubGlobal("fetch", request); });
  afterEach(() => vi.unstubAllGlobals());
  it("sends search, sort and bounded pagination with abort support", async () => {
    const page = { documents: [], total: 0, page: 1, pageSize: 50, totalPages: 1 };
    request.mockResolvedValue(new Response(JSON.stringify(page)));
    const controller = new AbortController();
    await expect(fetchDocuments({ search: "论文 & 100%", sort: "title-desc", page: 1, pageSize: 50 }, controller.signal)).resolves.toEqual(page);
    const [url, options] = request.mock.calls[0];
    const params = new URL(url).searchParams;
    expect(Object.fromEntries(params)).toEqual({ q: "论文 & 100%", sort: "title-desc", page: "1", pageSize: "50" });
    expect(options).toEqual({ credentials: "include", signal: controller.signal });
  });
  it("surfaces list errors for the retry UI", async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ error: "Login required" }), { status: 401 }));
    await expect(fetchDocuments({ search: "", sort: "newest", page: 1, pageSize: 20 })).rejects.toThrow("Login required");
  });
});
