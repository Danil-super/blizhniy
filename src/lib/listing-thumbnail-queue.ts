type Options = {signal?: AbortSignal};
type Read<T> = (owner: string, fileId: string, options: Options) => Promise<T>;

/** Keep a page of cards below the server's four-read admission limit.
 * No cache, identity persistence or automatic retry; unmounted cards cancel.
 */
export function createListingThumbnailQueue<T>(read: Read<T>): Read<T> {
  type Job = {start: () => void; cancel: () => void};
  const waiting: Job[] = [];
  let active = 0;
  function pump() {
    while (active < 3 && waiting.length) waiting.shift()!.start();
  }
  return (owner, fileId, options) => new Promise<T>((resolve, reject) => {
    if (options.signal?.aborted) {reject(options.signal.reason); return;}
    if (waiting.length >= 64) {reject(new Error('Thumbnail queue full')); return;}
    const job: Job = {
      cancel() {
        const index = waiting.indexOf(job);
        if (index < 0) return;
        waiting.splice(index, 1);
        options.signal?.removeEventListener('abort', job.cancel);
        reject(options.signal?.reason);
      },
      start() {
        options.signal?.removeEventListener('abort', job.cancel);
        if (options.signal?.aborted) {reject(options.signal.reason); return;}
        active++;
        (async () => read(owner, fileId, options))().then(resolve, reject).finally(() => {active--; pump();});
      },
    };
    waiting.push(job);
    options.signal?.addEventListener('abort', job.cancel, {once: true});
    pump();
  });
}
