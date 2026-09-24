import { useState } from "react";
import { usePdfHighlighterContext } from "react-pdf-highlighter-extended";

/**
 * `selectionTip` for react-pdf-highlighter-extended — unlike the previous
 * library, this isn't invoked per-selection with the selection as an
 * argument; it's a persistent element that reads the current selection via
 * usePdfHighlighterContext() itself whenever it needs it (see the library's
 * own ExpandableTip example). This opens straight into a single text field
 * (no "click to expand" step) styled with our own design tokens rather than
 * the library's default.
 */
export function NoteComposer({ onSave }: { onSave: (selectedText: string, noteText: string) => void }) {
  const { getCurrentSelection, removeGhostHighlight, setTip } = usePdfHighlighterContext();
  const [text, setText] = useState("");

  function close() {
    removeGhostHighlight();
    setTip(null);
    setText("");
  }

  function confirm() {
    const selection = getCurrentSelection();
    const trimmed = text.trim();
    if (!selection?.content.text || !trimmed) return;
    onSave(selection.content.text, trimmed);
    close();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        confirm();
      }}
      style={{
        width: 260,
        background: "var(--surface)",
        border: "1px solid var(--border-strong)",
        borderRadius: 4,
        padding: 10,
        boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <textarea
        autoFocus
        rows={3}
        placeholder="Write a note about the selected text…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
        style={{
          width: "100%",
          resize: "none",
          fontSize: 12,
          fontFamily: "var(--font-ui)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: 3,
          padding: 7,
        }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
        <button
          type="button"
          onClick={close}
          style={{
            height: 28,
            padding: "0 10px",
            fontSize: 11,
            border: "1px solid var(--border-strong)",
            borderRadius: 3,
            background: "var(--surface)",
            color: "var(--text)",
          }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={text.trim().length === 0}
          style={{
            height: 28,
            padding: "0 10px",
            fontSize: 11,
            fontWeight: 500,
            border: "none",
            borderRadius: 3,
            background: "var(--text)",
            color: "#FFFFFF",
            opacity: text.trim().length === 0 ? 0.5 : 1,
          }}
        >
          Save note
        </button>
      </div>
    </form>
  );
}
