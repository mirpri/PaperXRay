const PALETTE = ["#40628C", "#5C5C5C", "#D4A017", "#2F7D4F", "#7FA3CC"];

function colorFor(seed: string): string {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

/** Circular initial-letter avatar, matching design/01-reading.html's collaborator stack. */
export function Avatar({ name, size = 26 }: { name: string; size?: number }) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? "?";
  return (
    <span
      title={name}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: colorFor(name),
        color: "#FFFFFF",
        fontSize: size * 0.4,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {initial}
    </span>
  );
}
