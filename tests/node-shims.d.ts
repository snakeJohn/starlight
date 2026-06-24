declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function mkdtempSync(prefix: string): string;
  export function readFileSync(path: string, encoding: BufferEncoding): string;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export function writeFileSync(path: string, data: string): void;
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string;
}

declare module 'node:child_process' {
  export function execFileSync(
    file: string,
    args?: string[],
    options?: { cwd?: string },
  ): string | Uint8Array;
}

declare module 'node:os' {
  export function tmpdir(): string;
}

type BufferEncoding = 'utf8';

declare const process: {
  cwd(): string;
};

type Buffer = Uint8Array & {
  toString(encoding?: string): string;
  subarray(start?: number, end?: number): Uint8Array;
};

declare const Buffer: {
  from(data: string, encoding?: string): Buffer;
  from(data: number[]): Buffer;
  alloc(size: number): Buffer;
  concat(list: Buffer[]): Buffer;
};
