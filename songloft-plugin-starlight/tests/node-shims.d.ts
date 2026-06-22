declare module 'node:fs' {
  export function readFileSync(path: string, encoding: BufferEncoding): string;
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string;
}

type BufferEncoding = 'utf8';

declare const process: {
  cwd(): string;
};
