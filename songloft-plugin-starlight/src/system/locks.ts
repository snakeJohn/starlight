export class AsyncLockRegistry {
  private readonly locks = new Set<string>();

  acquire(name: string, code = name): () => void {
    if (this.locks.has(name)) {
      throw new Error(`${code} is already running`);
    }

    this.locks.add(name);
    let released = false;

    return () => {
      if (released) {
        return;
      }

      released = true;
      this.locks.delete(name);
    };
  }

  isLocked(name: string): boolean {
    return this.locks.has(name);
  }

  clear(): void {
    this.locks.clear();
  }
}
