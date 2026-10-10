import { createServer, type Server } from "node:http";
import express from "express";
import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
import type { User } from "@paper-xray/contracts";
const mocks = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn(), account: vi.fn(), full: vi.fn() }));
vi.mock("../db/repositories.js", () => ({ updateSsoConfig: mocks.save, getSsoConfigPublic: mocks.read, getAccountManagementUrl: mocks.account, getSsoConfig: mocks.full, upsertUserFromSso: vi.fn(), findUserById: vi.fn(), listUsers: vi.fn(), setUserRole: vi.fn() }));
import { adminRouter } from "./admin.js";
import { authRouter } from "./auth.js";
const config = { providerName: "SSO", authorizationEndpoint: "https://idp.example/authorize", tokenEndpoint: "https://idp.example/token", userinfoEndpoint: "https://idp.example/user", clientId: "client", scopes: "profile" };
let server: Server, base: string;
beforeAll(async () => {
 const app = express(); app.use(express.json()); app.use((req, _res, next) => { const role = req.headers["x-role"]; if (role) req.user = { id: "alice", role } as User; next(); });
 app.use(adminRouter); app.use(authRouter);
 server = createServer(app); await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
 const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing address"); base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())); });
beforeEach(() => { vi.resetAllMocks(); mocks.save.mockImplementation(async fields => ({ ...fields, clientSecret: undefined, hasClientSecret: true })); mocks.account.mockResolvedValue("https://idp.example/account"); });
function save(fields: object, role = "admin") { return fetch(base + "/admin/sso-config", { method: "PUT", headers: { "Content-Type": "application/json", ...(role ? { "x-role": role } : {}) }, body: JSON.stringify({ ...config, ...fields }) }); }
it("saves the account URL instead of silently discarding it", async () => {
 const response = await save({ accountManagementUrl: " https://idp.example/account " });
 expect(response.status).toBe(200); expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ accountManagementUrl: "https://idp.example/account", clientSecret: undefined }));
 expect((await response.json() as { ssoConfig: { accountManagementUrl: string } }).ssoConfig.accountManagementUrl).toBe("https://idp.example/account");
});
it.each(["", "  ", null])("explicitly clears account URL %j", async accountManagementUrl => {
 expect((await save({ accountManagementUrl })).status).toBe(200);
 expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ accountManagementUrl: null }));
});
it("preserves an omitted URL and allows credential rotation alongside URL changes", async () => {
 await save({}); expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ accountManagementUrl: undefined }));
 await save({ accountManagementUrl: "https://idp.example/account", clientSecret: "new-secret" });
 expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ accountManagementUrl: "https://idp.example/account", clientSecret: "new-secret" }));
});
it.each([42, {}, "javascript:alert(1)", "/account", "https://idp.example/" + "x".repeat(512)])("rejects invalid navigation URL %j", async accountManagementUrl => {
 expect((await save({ accountManagementUrl })).status).toBe(400); expect(mocks.save).not.toHaveBeenCalled();
});
it("keeps editing restricted to admins", async () => {
 expect((await save({ accountManagementUrl: "https://idp.example/account" }, "member")).status).toBe(403);
 expect((await save({}, "")).status).toBe(401); expect(mocks.save).not.toHaveBeenCalled();
});
it.each(["member", "curator", "admin"])("lets a %s read only the account link", async role => {
 const response = await fetch(base + "/auth/account-management", { headers: { "x-role": role } });
 expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
 expect(await response.json()).toEqual({ accountManagementUrl: "https://idp.example/account" }); expect(mocks.read).not.toHaveBeenCalled();
});
it("requires login for account links and returns null when cleared", async () => {
 expect((await fetch(base + "/auth/account-management")).status).toBe(401);
 mocks.account.mockResolvedValue(null);
 expect(await (await fetch(base + "/auth/account-management", { headers: { "x-role": "member" } })).json()).toEqual({ accountManagementUrl: null });
});

it("exports a complete admin backup that can be imported using the existing save endpoint", async () => {
 const backup = { ...config, clientSecret: "backup-test-secret", accountManagementUrl: "https://idp.example/account" };
 mocks.full.mockResolvedValue(backup);
 const response = await fetch(base + "/admin/sso-config/export", { headers: { "x-role": "admin" } });
 expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
 expect(response.headers.get("content-disposition")).toBe('attachment; filename="sso-config.json"');
 expect(response.headers.get("content-type")).toContain("application/json");
 const exported = await response.json() as typeof backup; expect(exported).toEqual(backup);
 expect((await save(exported)).status).toBe(200);
 expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining(backup));
});
it.each(["", "member", "curator"])("does not export secrets to role %s", async role => {
 const response = await fetch(base + "/admin/sso-config/export", { headers: role ? { "x-role": role } : {} });
 expect(response.status).toBe(role ? 403 : 401); expect(mocks.full).not.toHaveBeenCalled();
});
it("keeps the ordinary settings endpoint redacted", async () => {
 mocks.read.mockResolvedValue({ ...config, hasClientSecret: true });
 const response = await fetch(base + "/admin/sso-config", { headers: { "x-role": "admin" } });
 expect(await response.json()).toEqual({ ssoConfig: { ...config, hasClientSecret: true } }); expect(mocks.full).not.toHaveBeenCalled();
});
