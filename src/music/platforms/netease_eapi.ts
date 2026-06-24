import { fetchJson } from './http';

declare const crypto: {
  md5(str: string): string;
  aesEncrypt(data: string, mode: string, key: string, iv?: string): { toString(fmt?: string): string };
};

function neteaseEapiParams(apiPath: string, data: Record<string, unknown>): string {
  const text = JSON.stringify(data);
  const digest = crypto.md5(`nobody${apiPath}use${text}md5forencrypt`);
  const payload = `${apiPath}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  return crypto.aesEncrypt(payload, 'ecb', 'e82ckenh8dichen8', '').toString('hex').toUpperCase();
}

function requestPath(apiPath: string): string {
  return apiPath.replace(/^\/api/, '');
}

export async function neteaseEapiRequest<T>(apiPath: string, data: Record<string, unknown>): Promise<T> {
  return fetchJson<T>(`https://interface3.music.163.com/eapi${requestPath(apiPath)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://music.163.com',
      Referer: 'https://music.163.com/',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
    },
    body: new URLSearchParams({ params: neteaseEapiParams(apiPath, data) }).toString(),
  });
}
