import { expect, it } from "vitest";
import { parseSsoConfigJson } from "./sso-config-json";
const backup = { providerName: "mirpass", authorizationEndpoint: "https://idp.example/authorize", tokenEndpoint: "https://idp.example/token", userinfoEndpoint: "https://idp.example/user", clientId: "client", clientSecret: "backup-test-secret", scopes: "profile", accountManagementUrl: "https://idp.example/account" };
it("round trips a complete backup including its secret and account URL", () => {
 expect(parseSsoConfigJson(JSON.stringify(backup, null, 2))).toEqual(backup);
});
it("accepts a BOM and ignores unknown fields", () => {
 expect(parseSsoConfigJson("\uFEFF" + JSON.stringify({ ...backup, hasClientSecret: true, extra: "ignored" }))).toEqual(backup);
});
it("preserves explicit nulls for clearing credentials and account URLs", () => {
 expect(parseSsoConfigJson(JSON.stringify({ ...backup, clientSecret: null, accountManagementUrl: null }))).toMatchObject({ clientSecret: null, accountManagementUrl: null });
});
it("does not manufacture a secret when importing a redacted file", () => {
 const { clientSecret: _unused, ...publicFields } = backup;
 expect(parseSsoConfigJson(JSON.stringify(publicFields))).not.toHaveProperty("clientSecret");
});
it.each(["bad JSON", "[]", "null", "42", JSON.stringify({ ...backup, tokenEndpoint: 42 }), JSON.stringify({ ...backup, clientSecret: false }), JSON.stringify({ ...backup, accountManagementUrl: "javascript:alert(1)" }), JSON.stringify({ ...backup, scopes: undefined })])("rejects malformed config without producing a partial draft (%s)", text => {
 expect(() => parseSsoConfigJson(text)).toThrow();
});
