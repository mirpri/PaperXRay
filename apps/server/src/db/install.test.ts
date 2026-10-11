import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  execute: vi.fn(),
  changeUser: vi.fn(),
  end: vi.fn(),
  seed: vi.fn(),
  createConnection: vi.fn(),
}));

vi.mock("mysql2/promise", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mysql2/promise")>();
  return { ...actual, default: { escapeId: actual.escapeId, createConnection: mocks.createConnection } };
});
vi.mock("../config.js", () => ({ config: {
  db: { host: "localhost", port: 3306, user: "test", password: "test", database: "test`database" },
  sso: { mirpassClientId: "client-id", mirpassClientSecret: "client-secret" },
} }));
vi.mock("./pool.js", () => ({ pool: { end: vi.fn() } }));
vi.mock("./lens-repository.js", () => ({ seedPresetLenses: mocks.seed }));

import { installDatabase } from "./install.js";

describe("fresh database installation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.createConnection.mockResolvedValue({
      query: mocks.query, execute: mocks.execute, changeUser: mocks.changeUser, end: mocks.end,
    });
    mocks.query.mockResolvedValue([[]]);
  });

  it("installs the complete schema and seeds configured SSO and all presets", async () => {
    await installDatabase();
    expect(mocks.query.mock.calls[0][0]).toContain("`test``database`");
    expect(mocks.changeUser).toHaveBeenCalledWith({ database: "test`database" });
    expect(mocks.query.mock.calls[1][0]).toBe("SHOW FULL TABLES");
    const schema = mocks.query.mock.calls[2][0] as string;
    expect(schema.match(/CREATE TABLE /g)).toHaveLength(17);
    expect(schema).not.toMatch(/ALTER TABLE|_migrations|normalized_text|char_map/);
    for (const column of ["title", "sso_sub", "owner_id", "share_runs_with_org", "parent_kind", "thread_root_id", "thread_root_kind", "idx_human_annotations_parent", "color VARCHAR(7)"]) {
      expect(schema).toContain(column);
    }
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO sso_config"), ["client-id", "client-secret"]);
    expect(mocks.seed.mock.calls[0][0]).toHaveLength(4);
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it("rejects any nonempty database before changing its tables or seed data", async () => {
    mocks.query.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ table: "documents" }]]);
    await expect(installDatabase()).rejects.toThrow("Database is not empty");
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.seed).not.toHaveBeenCalled();
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it("closes the connection and stops seeding after a schema failure", async () => {
    mocks.query.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]).mockRejectedValueOnce(new Error("DDL failed"));
    await expect(installDatabase()).rejects.toThrow("DDL failed");
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.seed).not.toHaveBeenCalled();
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it("reports seed failures and closes the connection", async () => {
    mocks.seed.mockRejectedValueOnce(new Error("seed failed"));
    await expect(installDatabase()).rejects.toThrow("seed failed");
    expect(mocks.end).toHaveBeenCalledOnce();
  });
});
