import { useEffect } from "react";
import { io } from "socket.io-client";

const SOCKET_BASE = import.meta.env.VITE_SOCKET_BASE ?? "http://localhost:3001";

/**
 * Joins the document's realtime room and calls `onAnnotationsChanged`
 * whenever the server broadcasts an annotation change for it — a lens run
 * completing, or a human annotation created/edited/deleted (server side:
 * apps/server/src/realtime/socket.ts). Minimal wiring — no
 * presence/reconnect-catchup yet, that's W5 per docs/02-decisions.md #10.
 */
export function useDocumentSocket(docId: string | null, onAnnotationsChanged: () => void): void {
  useEffect(() => {
    if (!docId) return;

    const socket = io(SOCKET_BASE);
    socket.emit("join", docId);
    socket.on("annotations:changed", onAnnotationsChanged);

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);
}
