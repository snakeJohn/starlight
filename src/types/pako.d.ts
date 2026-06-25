declare module 'pako' {
  export function inflate(data: Uint8Array): Uint8Array;
  const pako: {
    inflate: typeof inflate;
  };
  export default pako;
}
