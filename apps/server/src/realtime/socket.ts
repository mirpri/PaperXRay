import type { Server as HttpServer } from "node:http";
import { Server as SocketIoServer } from "socket.io";
import { config } from "../config.js";

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
    cors: { origin: config.webOrigin },
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
