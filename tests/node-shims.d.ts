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

declare module 'node:crypto' {
  export function createHash(algo: string): {
    update(data: string | Buffer | Uint8Array, enc?: string): { digest(enc: string): string };
  };
  export function randomBytes(size: number): Buffer;
  export function createCipheriv(
    algo: string,
    key: Buffer | string | Uint8Array,
    iv: Buffer | string | Uint8Array,
  ): {
    update(data: string | Buffer, inputEnc?: string, outputEnc?: string): Buffer;
    final(outputEnc?: string): Buffer;
  };
  export function generateKeyPairSync(
    type: string,
    options: Record<string, unknown>,
  ): { publicKey: string | Buffer; privateKey: string | Buffer };
  export function privateDecrypt(
    options: { key: string | Buffer; padding?: number },
    buffer: Buffer | Uint8Array,
  ): Buffer;
  export const constants: { RSA_PKCS1_OAEP_PADDING: number; [key: string]: number };
}

declare function require(id: string): unknown;

type BufferEncoding = 'utf8' | 'hex' | 'base64';

declare const process: {
  cwd(): string;
};

type Buffer = Uint8Array & {
  toString(encoding?: string): string;
  subarray(start?: number, end?: number): Uint8Array;
};

declare const Buffer: {
  from(data: string, encoding?: string): Buffer;
  from(data: number[] | Uint8Array): Buffer;
  alloc(size: number): Buffer;
  concat(list: Buffer[]): Buffer;
};
