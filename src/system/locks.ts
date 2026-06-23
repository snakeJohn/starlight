import { type ErrorCode, StarlightError } from './errors';

export class AsyncLockRegistry {
  private readonly locks = new Map<string, symbol>();

  acquire(name: string, code: ErrorCode): () => void {
    if (this.locks.has(name)) {
      throw new StarlightError(code, `${name} is already running`, true);
    }

    const token = Symbol(name);
    this.locks.set(name, token);
    let released = false;

    return () => {
      if (released) {
        return;
      }

      released = true;
      if (this.locks.get(name) === token) {
        this.locks.delete(name);
      }
    };
  }

  isLocked(name: string): boolean {
    return this.locks.has(name);
  }

  clear(): void {
    this.locks.clear();
  }
}
