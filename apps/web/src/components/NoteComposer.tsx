import { useState } from "react";
import { usePdfHighlighterContext } from "react-pdf-highlighter-extended";

export interface SelectionPosition {
  page: number;
  x: number;
  y: number;
}

/**
 * `selectionTip` for react-pdf-highlighter-extended — unlike the previous
 * library, this isn't invoked per-selection with the selection as an
 * argument; it's a persistent element that reads the current selection via
 * usePdfHighlighterContext() itself whenever it needs it (see the library's
 * own ExpandableTip example). This opens straight into a single text field
 * (no "click to expand" step) styled with our own design tokens rather than
 * the library's default.
 */
export function NoteComposer({ onSave }: { onSave: (selectedText: string, noteText: string, position?: SelectionPosition) => void }) {
  const { getCurrentSelection, getViewer, removeGhostHighlight, setTip } = usePdfHighlighterContext();
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

    // Selections store viewport coordinates, not PDF user-space coordinates.
    // Use the first text rect so multi-line selections anchor at their start.
    let position: SelectionPosition | undefined;
    if (selection.position?.boundingRect) {
      const rect = selection.position.rects[0] ?? selection.position.boundingRect;
      if (selection.position.usePdfCoordinates) {
        position = { page: rect.pageNumber, x: rect.x1, y: (rect.y1 + rect.y2) / 2 };
      } else {
        const viewport = getViewer()?.getPageView(rect.pageNumber - 1)?.viewport;
        if (viewport) {
          const [x, y] = viewport.convertToPdfPoint(
            (rect.x1 / rect.width) * viewport.width,
            ((rect.y1 + rect.y2) / (2 * rect.height)) * viewport.height,
          );
          position = { page: rect.pageNumber, x, y };
        }
      }
    }

    onSave(selection.content.text, trimmed, position);
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
