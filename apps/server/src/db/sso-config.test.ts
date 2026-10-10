import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./pool.js", () => ({ pool: { query: mocks.query } }));
import { getAccountManagementUrl, updateSsoConfig } from "./repositories.js";
const params = { providerName: "SSO", authorizationEndpoint: "https://idp.example/authorize", tokenEndpoint: "https://idp.example/token", userinfoEndpoint: "https://idp.example/user", clientId: "client", scopes: "profile" };
let stored: string | null;
beforeEach(() => {
 vi.resetAllMocks(); stored = "https://idp.example/old";
 mocks.query.mockImplementation(async (sql: string, values?: unknown[]) => {
   if (sql.startsWith("UPDATE")) { if (values?.at(-2)) stored = values.at(-1) as string | null; return [{}]; }
   return [[{ provider_name: "SSO", client_secret: "write-only", account_management_url: stored }]];
 });
});
it.each([undefined, "rotated-secret", null])("saves and clears account links with clientSecret %j", async clientSecret => {
 const result = await updateSsoConfig({ ...params, clientSecret, accountManagementUrl: "https://idp.example/new" });
 expect(result.accountManagementUrl).toBe("https://idp.example/new"); expect(result).not.toHaveProperty("clientSecret");
 await updateSsoConfig({ ...params, clientSecret, accountManagementUrl: null }); expect(stored).toBeNull();
});
it("does not clear a URL when omitted by an older client", async () => {
 await updateSsoConfig(params); expect(stored).toBe("https://idp.example/old");
 expect(mocks.query.mock.calls[0][1].slice(-2)).toEqual([false, null]);
});
it("reads only the account link for the ordinary user endpoint", async () => {
 expect(await getAccountManagementUrl()).toBe("https://idp.example/old");
 expect(mocks.query).toHaveBeenCalledWith("SELECT account_management_url FROM sso_config WHERE id = 'default' LIMIT 1");
});
