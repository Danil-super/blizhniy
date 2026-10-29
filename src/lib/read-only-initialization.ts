/** A missing, operator-provisioned dependency; never a permissions/schema failure. */
export class DependencyNotReadyError extends Error {
  constructor() { super('Initialization dependency is not ready'); this.name = 'DependencyNotReadyError'; }
}
function temporaryFailure(error: unknown): boolean {
  if (error instanceof DependencyNotReadyError) return true;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  return typeof code === 'string' && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN',
    '08000', '08001', '08003', '08006', '57P03', '53300'].includes(code);
}

/** Only for idempotent, read-only startup preflights. Never wraps a user operation,
 * COMMIT, upload, mail delivery or payment. Permanent failures stay closed until restart. */
export class ReadOnlyInitialization<T> {
  private pending: Promise<T> | undefined;
  private retryAt: number | undefined;
  private failures = 0;
  private readonly initialize: () => Promise<T>;
  private readonly now: () => number;
  constructor(initialize: () => Promise<T>, now: () => number = Date.now) {
    this.initialize = initialize; this.now = now;
  }
  get(): Promise<T> {
    if (this.pending && (this.retryAt === undefined || this.now() < this.retryAt)) return this.pending;
    this.retryAt = undefined;
    this.pending = Promise.resolve().then(this.initialize).then(value => {
      this.failures = 0; return value;
    }, error => {
      if (temporaryFailure(error)) {
        this.retryAt = this.now() + Math.min(60000, 5000 * 2 ** Math.min(this.failures++, 4));
      }
      throw error;
    });
    return this.pending;
  }
}
