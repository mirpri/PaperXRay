import { Avatar } from "./Avatar";

/** Shared author identity for annotations and replies. */
export function UserIdentity({ name }: { name?: string | null }) {
  const displayName = name?.trim() || "Member";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      <Avatar name={displayName} size={21} />
      <span style={{ fontSize: 12, fontWeight: 500, overflowWrap: "anywhere" }}>{displayName}</span>
    </span>
  );
}
