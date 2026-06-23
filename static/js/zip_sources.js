const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

function decodeUtf8(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
}

function findEndOfCentralDirectory(view) {
    const minOffset = Math.max(0, view.byteLength - 65557);
    for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
        if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
            return offset;
        }
    }
    throw new Error('ZIP 文件结构无效：未找到中央目录');
}

function centralDirectoryEntries(view) {
    const eocd = findEndOfCentralDirectory(view);
    const entryCount = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const entries = [];

    for (let index = 0; index < entryCount; index += 1) {
        if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
            throw new Error('ZIP 文件结构无效：中央目录损坏');
        }
        const method = view.getUint16(offset + 10, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const filenameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localHeaderOffset = view.getUint32(offset + 42, true);
        const filenameBytes = new Uint8Array(view.buffer, view.byteOffset + offset + 46, filenameLength);
        const filename = decodeUtf8(filenameBytes);
        entries.push({ filename, method, compressedSize, localHeaderOffset });
        offset += 46 + filenameLength + extraLength + commentLength;
    }

    return entries;
}

async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
        throw new Error('ZIP 内 JS 文件使用了当前运行环境不支持的压缩方式');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function entryBytes(view, entry) {
    const offset = entry.localHeaderOffset;
    if (view.getUint32(offset, true) !== LOCAL_FILE_SIGNATURE) {
        throw new Error(`ZIP 文件结构无效：${entry.filename} 本地文件头损坏`);
    }
    const filenameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const dataOffset = offset + 30 + filenameLength + extraLength;
    const compressed = new Uint8Array(view.buffer, view.byteOffset + dataOffset, entry.compressedSize);

    if (entry.method === 0) {
        return compressed;
    }
    if (entry.method === 8) {
        return inflateRaw(compressed);
    }
    throw new Error(`ZIP 内 JS 文件使用了不支持的压缩方式：${entry.filename}`);
}

export async function extractJavaScriptFilesFromZip(blob) {
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);
    const entries = centralDirectoryEntries(view)
        .filter(entry => !entry.filename.endsWith('/') && /\.js$/i.test(entry.filename));

    const files = [];
    for (const entry of entries) {
        const bytes = await entryBytes(view, entry);
        files.push({
            filename: entry.filename.replace(/\\/g, '/'),
            content: decodeUtf8(bytes),
        });
    }
    return files;
}

export async function readJavaScriptSourceFiles(file) {
    const name = String(file?.name || '');
    if (/\.zip$/i.test(name)) {
        const files = await extractJavaScriptFilesFromZip(file);
        if (files.length === 0) {
            throw new Error('ZIP 包内没有可导入的 JS 音源文件');
        }
        return files;
    }
    if (/\.js$/i.test(name)) {
        return [{ filename: name, content: await file.text() }];
    }
    throw new Error('只支持导入 .js 或 .zip 音源文件');
}
