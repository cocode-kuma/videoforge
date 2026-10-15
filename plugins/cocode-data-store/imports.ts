import { Readable } from 'node:stream';
import { safeFetch } from '../../shared/remote.js';
import { AppError } from '../../shared/contracts.js';
import { AssetService } from './assets.js';
import type { DataStore } from './index.js';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

export class SourceImporter {
  constructor(readonly store: DataStore) {}
  async import(userId: string, projectId: string, input: string, signal?: AbortSignal) {
    await this.store.loadProject(userId, projectId);
    const url = new URL(input);
    const assets = new AssetService(this.store);
    const uploadJson = async (name: string, value: unknown) => assets.upload(userId, projectId, name, Readable.from([Buffer.from(JSON.stringify(value))]), input);
    if (url.hostname === 'www.figma.com' || url.hostname === 'figma.com') {
      const fileKey = url.pathname.match(/^\/(?:file|design|proto)\/([A-Za-z0-9]+)/)?.[1];
      if (!fileKey) throw new AppError(400, 'Figma 文件链接不合法');
      if (!this.store.config.figmaToken) throw new AppError(503, 'Figma 服务端令牌尚未配置');
      if (!this.store.config.figmaAllowedFileKeys.includes(fileKey)) throw new AppError(403, '此 Figma 文件尚未加入服务端可导入清单');
      const headers = { 'X-Figma-Token': this.store.config.figmaToken };
      const node = url.searchParams.get('node-id')?.replace('-', ':');
      if (node && !/^\d+:\d+$/.test(node)) throw new AppError(400, 'Figma 节点不合法');
      const endpoint = `https://api.figma.com/v1/files/${fileKey}${node ? `/nodes?ids=${encodeURIComponent(node)}` : '?depth=3'}`;
      const file = JSON.parse((await safeFetch(endpoint, { headers, signal })).data.toString('utf8'));
      const result = [await uploadJson('figma-design.json', { sourceType: 'figma', fileKey, node, file })];
      const ids = node ?? file.document?.children?.flatMap((p: { children?: { id: string; type: string }[] }) => p.children?.filter(n => n.type === 'FRAME').slice(0,4).map(n => n.id) ?? []).slice(0,4).join(',');
      if (ids) {
        const exports = JSON.parse((await safeFetch(`https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(ids)}&format=png&scale=1`, { headers, signal })).data.toString('utf8'));
        for (const [id, link] of Object.entries(exports.images ?? {})) if (typeof link === 'string') {
          const image = await safeFetch(link, { signal, limit: 100 * 1024 * 1024 });
          result.push(await assets.upload(userId, projectId, `figma-${id.replace(':','-')}.png`, Readable.from([image.data]), input));
        }
      }
      return result;
    }
    if (url.hostname === 'github.com') {
      const match = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?$/);
      if (!match) throw new AppError(400, '请提供完整 GitHub PR 链接');
      const api = `https://api.github.com/repos/${match[1]}/${match[2]}/pulls/${match[3]}`;
      const headers = { Accept: 'application/vnd.github+json' };
      const pr = JSON.parse((await safeFetch(api, { headers, signal })).data.toString('utf8'));
      const files = JSON.parse((await safeFetch(`${api}/files?per_page=100`, { headers, signal })).data.toString('utf8'));
      return [await uploadJson('github-pr.json', { sourceType: 'github-pr', title: pr.title, body: pr.body, html_url: pr.html_url, files, truncated: pr.changed_files > 100 })];
    }
    const source = await safeFetch(input, { signal });
    if (!['text/html', 'application/xhtml+xml', 'text/plain'].includes(source.mime)) throw new AppError(400, '网站来源需为网页或文本');
    const html = source.data.toString('utf8');
    const text = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g,' ').trim().slice(0,40000);
    const result = [await uploadJson('website-content.json', { sourceType: 'website', url: source.url, title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.slice(0,200), text })];
    const executablePath = process.env.PRODUCER_HEADLESS_SHELL_PATH || [
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium',
    ].find(p=>existsSync(p));
    const browser = await chromium.launch({ executablePath, headless:true });
    try {
      const context = await browser.newContext({ viewport:{width:1280,height:720}, javaScriptEnabled:true, serviceWorkers:'block' });
      await context.routeWebSocket('**/*',socket=>socket.close());
      let requests = 0;
      await context.route('**/*', async route => {
        try {
          if (++requests > 100 || route.request().method() !== 'GET') return await route.abort();
          const resource = await safeFetch(route.request().url(), { signal, limit:10*1024*1024 });
          await route.fulfill({status:200,contentType:resource.mime,body:resource.data});
        } catch { await route.abort().catch(()=>{}); }
      });
      const page = await context.newPage();
      await page.goto(source.url,{waitUntil:'load',timeout:45000});
      const image = await page.screenshot({type:'png',timeout:15000});
      result.push(await assets.upload(userId,projectId,'website-preview.png',Readable.from([image]),input));
    } finally { await browser.close(); }
    return result;
  }
}
