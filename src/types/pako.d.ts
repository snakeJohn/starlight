declare module 'pako' {
  export function inflate(data: Uint8Array): Uint8Array;
  export function ungzip(data: Uint8Array, options?: { to?: string }): Uint8Array | string;
  const pako: {
    inflate: typeof inflate;
    ungzip: typeof ungzip;
  };
  export default pako;
}
