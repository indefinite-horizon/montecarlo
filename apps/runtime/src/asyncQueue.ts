/** Provides a small abort-friendly async event queue for child processes. */

interface PendingRead<T> {
  resolve: (result: IteratorResult<T>) => void;
  reject: (error: unknown) => void;
}

export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly readers: PendingRead<T>[] = [];
  private ended = false;
  private failure: unknown;

  push(value: T): void {
    if (this.ended) return;
    const reader = this.readers.shift();
    if (reader !== undefined) {
      reader.resolve({ done: false, value });
      return;
    }
    this.values.push(value);
  }

  close(): void {
    if (this.ended) return;
    this.ended = true;
    this.flushReaders();
  }

  fail(error: unknown): void {
    if (this.ended) return;
    this.failure = error;
    this.ended = true;
    this.flushReaders();
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => this.next() };
  }

  private next(): Promise<IteratorResult<T>> {
    const value = this.values.shift();
    if (value !== undefined) return Promise.resolve({ done: false, value });
    if (this.ended) {
      return this.failure === undefined
        ? Promise.resolve({ done: true, value: undefined })
        : Promise.reject(this.failure);
    }
    return new Promise((resolve, reject) => this.readers.push({ resolve, reject }));
  }

  private flushReaders(): void {
    for (const reader of this.readers.splice(0)) {
      if (this.failure === undefined) reader.resolve({ done: true, value: undefined });
      else reader.reject(this.failure);
    }
  }
}
