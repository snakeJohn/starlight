declare module 'pako' {
  export function inflate(data: Uint8Array): Uint8Array;
  export function deflate(data: Uint8Array, options?: { gzip?: boolean }): Uint8Array;
  export function gzip(data: Uint8Array): Uint8Array;
  export function ungzip(data: Uint8Array, options?: { to?: string }): Uint8Array | string;
  const pako: {
    inflate: typeof inflate;
    deflate: typeof deflate;
    gzip: typeof gzip;
    ungzip: typeof ungzip;
  };
  export default pako;
}
