import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { AppError } from './contracts.js';

export function isPublicAddress(address: string): boolean {
  const ip = address.toLowerCase();
  if (isIP(ip) === 4) {
    const [a,b] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0,168].includes(b)) || (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && [18,19].includes(b)));
  }
  if (isIP(ip) === 6) {
    // Only ordinary global-unicast addresses. Excludes mapped, local, multicast and transition ranges.
    return /^[23][0-9a-f]{3}:/.test(ip) && !/^(2001:(?:0:|db8:|10:|20:)|2002:)/.test(ip);
  }
  return false;
}
export async function safeFetch(input: string, options: { headers?: Record<string,string>; limit?: number; signal?: AbortSignal; redirects?: number } = {}): Promise<{ data: Buffer; mime: string; url: string }> {
  const url = new URL(input);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80','443'].includes(url.port))) throw new AppError(400, '仅支持公开 HTTP(S) 地址');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new AppError(400, '不能导入本机或内网地址');
  const pinned = addresses[0];
  const result = await new Promise<{ status: number; location?: string; data: Buffer; mime: string }>((resolve, reject) => {
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      headers: { 'User-Agent': 'VideoForge/2.0', 'Accept-Encoding': 'identity', ...options.headers },
      signal: options.signal,
      lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
    }, res => {
      const chunks: Buffer[] = []; let bytes = 0;
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > (options.limit ?? 10 * 1024 * 1024)) { res.destroy(new AppError(413, '远程素材超出大小限制')); return; }
        chunks.push(Buffer.from(chunk));
      });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode ?? 500, location: res.headers.location, data: Buffer.concat(chunks), mime: String(res.headers['content-type'] ?? 'application/octet-stream').split(';')[0] }));
    });
    req.setTimeout(30000, () => req.destroy(new AppError(504, '远程素材读取超时')));
    req.on('error', reject); req.end();
  });
  if ([301,302,303,307,308].includes(result.status) && result.location) {
    if ((options.redirects ?? 0) >= 4) throw new AppError(400, '远程素材重定向过多');
    // Never forward provider credentials to a redirected host.
    return safeFetch(new URL(result.location, url).href, { ...options, headers: undefined, redirects: (options.redirects ?? 0) + 1 });
  }
  if (result.status < 200 || result.status >= 300) throw new AppError(result.status === 404 ? 404 : 502, `来源服务返回 ${result.status}`);
  return { data: result.data, mime: result.mime, url: url.href };
}
