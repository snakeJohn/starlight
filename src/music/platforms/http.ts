type HeaderReader = {
  get(name: string): string | null;
};

export type FetchResult = {
  ok: boolean;
  status: number;
  url: string;
  text: string;
  headers: HeaderReader;
};

function headerReader(raw: unknown): HeaderReader {
  const names = (name: string) => [name, name.toLowerCase(), name.toUpperCase(), `${name[0]?.toUpperCase() || ''}${name.slice(1).toLowerCase()}`];
  if (raw && typeof (raw as { get?: unknown }).get === 'function') {
    return {
      get(name: string): string | null {
        const getter = (raw as { get: (headerName: string) => unknown }).get;
        for (const candidate of names(name)) {
          const value = getter.call(raw, candidate);
          if (typeof value === 'string' && value) {
            return value;
          }
        }
        return null;
      },
    };
  }
  if (raw && typeof raw === 'object') {
    return {
      get(name: string): string | null {
        for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
          if (key.toLowerCase() === name.toLowerCase() && typeof value === 'string' && value) {
            return value;
          }
        }
        return null;
      },
    };
  }
  return { get: () => null };
}

export async function fetchResponse(url: string, init: RequestInit = {}): Promise<FetchResult> {
  const response = await fetch(url, init);
  return {
    ok: response.ok,
    status: response.status,
    url: response.url || '',
    text: await response.text(),
    headers: headerReader((response as { headers?: unknown }).headers),
  };
}

export async function fetchText(url: string, init: RequestInit = {}): Promise<string> {
  const response = await fetchResponse(url, init);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.text.slice(0, 200)}`);
  }
  return response.text;
}

export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  return JSON.parse(await fetchText(url, init)) as T;
}

export async function fetchBytes(url: string, init: RequestInit = {}): Promise<Uint8Array> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const arrayBuffer = (response as { arrayBuffer?: unknown }).arrayBuffer;
  if (typeof arrayBuffer === 'function') {
    return new Uint8Array(await arrayBuffer.call(response));
  }
  const body = (response as { body?: unknown }).body;
  if (body instanceof Uint8Array) {
    return new Uint8Array(body);
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body);
  }
  if (Array.isArray(body)) {
    return new Uint8Array(body);
  }
  if (typeof body === 'string') {
    return binaryTextToBytes(body);
  }
  const text = await response.text();
  return binaryTextToBytes(text);
}

function binaryTextToBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index) & 0xff;
  }
  return bytes;
}

export async function fetchResolvedUrl(url: string, init: RequestInit = {}): Promise<string> {
  const response = await fetchResponse(url, init);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.text.slice(0, 200)}`);
  }
  return response.url || url;
}
