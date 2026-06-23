import { describe, expect, it } from 'vitest';

function u16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function zipFile(entries: Array<{ name: string; content: string }>): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = bytes(entry.name);
    const content = bytes(entry.content);
    const local = new Uint8Array([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(content.length),
      ...u32(content.length),
      ...u16(name.length),
      ...u16(0),
      ...name,
      ...content,
    ]);
    locals.push(local);

    const central = new Uint8Array([
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(content.length),
      ...u32(content.length),
      ...u16(name.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
      ...name,
    ]);
    centrals.push(central);
    offset += local.length;
  }

  const localBytes = concat(locals);
  const centralBytes = concat(centrals);
  const eocd = new Uint8Array([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(centralBytes.length),
    ...u32(localBytes.length),
    ...u16(0),
  ]);

  return concat([localBytes, centralBytes, eocd]);
}

describe('zip source extraction', () => {
  it('extracts JavaScript source files from a zip and ignores directories plus non-js files', async () => {
    const { extractJavaScriptFilesFromZip } = await import('../../static/js/zip_sources.js');
    const archive = zipFile([
      { name: 'nested/', content: '' },
      { name: 'nested/one.js', content: 'lx.send("inited", { sources: { kw: {} } });' },
      { name: 'two.JS', content: 'lx.send("inited", { sources: { kg: {} } });' },
      { name: 'readme.txt', content: 'not a source' },
    ]);

    const archiveBuffer = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
    const files = await extractJavaScriptFilesFromZip(new Blob([archiveBuffer]));

    expect(files).toEqual([
      { filename: 'nested/one.js', content: 'lx.send("inited", { sources: { kw: {} } });' },
      { filename: 'two.JS', content: 'lx.send("inited", { sources: { kg: {} } });' },
    ]);
  });
});
