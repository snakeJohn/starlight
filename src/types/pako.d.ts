declare module 'pako' {
  export function inflate(data: Uint8Array): Uint8Array;
  export function deflate(data: Uint8Array, options?: { gzip?: boolean }): Uint8Array;
  export function gzip(data: Uint8Array): Uint8Array;
  export function ungzip(data: Uint8Array, options?: { to?: string }): Uint8Array | string;

  export class Inflate {
    constructor(options?: { windowBits?: number; raw?: boolean });
    err: number;
    msg: string;
    result: Uint8Array | string | undefined;
    onData: ((chunk: Uint8Array) => void) | null;
    onEnd: ((status: number) => void) | null;
    push(data: Uint8Array | ArrayBuffer | string, mode?: boolean | number): boolean;
  }

  const pako: {
    inflate: typeof inflate;
    deflate: typeof deflate;
    gzip: typeof gzip;
    ungzip: typeof ungzip;
    Inflate: typeof Inflate;
  };
  export default pako;
}
