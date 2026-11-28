import { request } from "node:http";
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";

/** One request to a verified owned socket. Never retries an ambiguous response. */
export async function requestPrivateJsonOperator(socketPath: string, envelope: object, {
  signal, hostedPath, requestLimit = 4096, responseLimit = 65_536, socketUserAcl = false,
}: { signal?: AbortSignal; hostedPath?: string; requestLimit?: number; responseLimit?: number; socketUserAcl?: boolean } = {}) {
  const body = JSON.stringify(envelope), size = Buffer.byteLength(body), hosted = hostedPath !== undefined;
  if (size > requestLimit || typeof process.getuid !== "function") throw new Error("Private operator unavailable");
  const directory = dirname(socketPath);
  if (hosted ? socketPath !== hostedPath :
    !isAbsolute(socketPath) || Buffer.byteLength(socketPath) > 100 || basename(socketPath) !== "operator.sock" ||
    !/^blizhniy-user-operator-[a-zA-Z0-9]+$/.test(basename(directory)) || dirname(directory) !== tmpdir()) {
    throw new Error("Private operator unavailable");
  }
  signal?.throwIfAborted();
  const [parent, socket] = await Promise.all([lstat(directory), lstat(socketPath)]);
  const owner = hosted ? 0 : process.getuid(), mask = hosted ? 0o7777 : 0o777;
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== owner || (parent.mode & mask) !== (hosted ? 0o755 : 0o700) ||
    !socket.isSocket() || socket.uid !== owner || (socket.mode & mask) !== (hosted ? 0o660 : 0o600) ||
    await realpath(directory) !== directory || socketPath !== join(directory, "operator.sock")) {
    throw new Error("Private operator unavailable");
  }
  if (hosted) {
    const root = await lstat("/run");
    if (!root.isDirectory() || root.uid !== 0 || (root.mode & 0o022) !== 0 || process.getuid() === 0 ||
      socket.nlink !== 1 || (!socketUserAcl && socket.gid !== process.getgid?.())) throw new Error("Private operator unavailable");
    // A separately configured POSIX user ACL is enforced by connect(2).
  }
  const timeout = AbortSignal.timeout(20_000);
  const abort = signal ? AbortSignal.any([timeout, signal]) : timeout;
  abort.throwIfAborted();
  return new Promise<{ status: number | undefined; payload: unknown }>((resolve, reject) => {
    const outgoing = request({
      socketPath, hostname: "user-operator.invalid", path: "/command", method: "POST", agent: false, signal: abort,
      headers: { "Content-Type": "application/json", "Content-Length": size },
    }, incoming => {
      let bytes = 0, text = "";
      const decoder = new TextDecoder("utf-8", { fatal: true });
      incoming.on("data", (chunk: Buffer) => {
        try {
          bytes += chunk.length;
          if (bytes > responseLimit) throw new Error("Private operator reply too large");
          text += decoder.decode(chunk, { stream: true });
        } catch (error) {
          incoming.destroy();
          reject(error);
        }
      });
      incoming.on("error", reject);
      incoming.on("aborted", () => reject(new Error("Private operator reply aborted")));
      incoming.on("end", () => {
        try {
          if (incoming.headers["content-type"] !== "application/json") throw new Error("Invalid private operator reply");
          resolve({ status: incoming.statusCode, payload: JSON.parse(text + decoder.decode()) as unknown });
        } catch (error) { reject(error); }
      });
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}
