import { constants, openSync, fstatSync, readFileSync, closeSync, lstatSync, realpathSync } from "node:fs";

type Context = { env: NodeJS.ProcessEnv; platform: string; versions?: { node?: string }; execPath?: string;
  getuid?: () => number; getgid?: () => number };
type MediaPolicy = { root: string; socket: string; app: string };
const unavailable = () => new Error("Restricted media runtime unavailable");

/** Default local behavior is unchanged. Production additionally requires root-managed opt-in,
 * the dedicated identity/binary, a private persistent root and immutable release code.
 * No caller-supplied path or environment flag alone grants production filesystem access. */
export function assertMediaRuntime(context: Context, rootDirectory?: string, appDirectory?: string): MediaPolicy | null {
  if (typeof window !== "undefined") throw unavailable();
  if (["development", "test"].includes(context.env.NODE_ENV ?? "")) return null;
  let descriptor: number | undefined;
  try {
    if (context.env.NODE_ENV !== "production" || context.env.BLIZHNIY_AUTH_MODE !== "postgres" || context.platform !== "linux" ||
        !/^22\.(?:1[89]|[2-9]\d)\.\d+$/.test(context.versions?.node ?? "") ||
        context.execPath !== "/opt/blizhniy-node22/bin/node") throw unavailable();
    const uid = context.getuid?.(), gid = context.getgid?.();
    if (!uid || uid < 100 || uid > 999 || !gid || gid < 100 || gid > 999) throw unavailable();
    const protectedDirectory = (path: string) => {
      const info = lstatSync(path);
      if (realpathSync(path) !== path || !info.isDirectory() || info.uid !== 0 || (info.mode & 0o022)) throw unavailable();
    };
    protectedDirectory("/etc");
    descriptor = openSync("/etc/blizhniy-media-runtime.json", constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.uid !== 0 || info.gid !== gid || (info.mode & 0o7777) !== 0o640 || info.nlink !== 1 || info.size < 1 || info.size > 1024) throw unavailable();
    const bytes = readFileSync(descriptor);
    if (bytes.length > 1024) throw unavailable();
    const config = JSON.parse(bytes.toString("utf8"));
    if (!config || typeof config !== "object" || Object.keys(config).sort().join() !== "root,socket,uid,version" ||
        config.version !== 1 || config.uid !== uid || config.root !== "/var/lib/blizhniy-web/media" ||
        config.socket !== "/run/blizhniy-media/decoder.sock") throw unavailable();
    const root = lstatSync(config.root);
    if (!root.isDirectory() || root.uid !== uid || (root.mode & 0o7777) !== 0o700 || realpathSync(config.root) !== config.root ||
        (rootDirectory !== undefined && rootDirectory !== config.root)) throw unavailable();
    const app = realpathSync("/var/www/blizhniy");
    if (!/^\/var\/www\/blizhniy-releases\/\d{14}-[a-f0-9]{12}$/.test(app) || (appDirectory !== undefined && appDirectory !== app)) throw unavailable();
    for (const path of ["/var", "/var/www", "/var/www/blizhniy-releases", app]) protectedDirectory(path);
    return { root: config.root, socket: config.socket, app };
  } catch { throw unavailable(); }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}
