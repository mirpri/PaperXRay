import type { Server as HttpServer } from "node:http";
import { Server as SocketIoServer } from "socket.io";
import { config } from "../config.js";
import { SESSION_COOKIE_NAME } from "../auth/session.js";
import { verify } from "../auth/signed-value.js";

/** Reads one cookie out of a raw `Cookie:` header without pulling cookie-parser into socket.io's middleware chain. */
function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

let io: SocketIoServer | null = null;

/**
 * Minimal realtime layer per docs/01-nabcd-architecture.md "实时协作":
 * server is the source of truth, clients subscribe to a document room and
 * receive broadcasts. Presence/reconnect-catchup (lastSeq) are future-work
 * per the W2-3/W5 schedule in docs/02-decisions.md #10 — this only wires
 * the room join + broadcast primitive so later features have a socket to
 * attach to.
 */
export function initSocket(server: HttpServer): SocketIoServer {
  io = new SocketIoServer(server, {
    cors: { origin: config.webOrigin, credentials: true },
  });

  // Same session cookie as the HTTP API — an org-only deployment
  // (docs/02-decisions.md #3) shouldn't let anonymous clients watch which
  // documents are being annotated.
  io.use((socket, next) => {
    const raw = readCookie(socket.handshake.headers.cookie, SESSION_COOKIE_NAME);
    if (!verify(raw, config.session.secret)) {
      next(new Error("Login required"));
      return;
    }
    next();
  });

  io.on("connection", (socket) => {
    socket.on("join", (docId: string) => {
      socket.join(roomFor(docId));
    });
  });

  return io;
}

function roomFor(docId: string): string {
  return `doc:${docId}`;
}

/** Fired for any annotation change on a doc — a lens run completing, or a human annotation created/edited/deleted. Clients treat this as "refetch", not as a diff. */
export function broadcastAnnotationsChanged(docId: string): void {
  io?.to(roomFor(docId)).emit("annotations:changed", { docId });
}
