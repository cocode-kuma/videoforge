import { randomUUID, createHash } from 'node:crypto';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { Readable } from 'node:stream';
import { AppError, activeStatus, type AssetRecord } from '../../shared/contracts.js';
import type { DataStore } from './index.js';
import { runProcess } from '../cocode-director/process.js';

const fileLimit = 100 * 1024 * 1024;
const projectLimit = 1024 * 1024 * 1024;
export function classifyAsset(head: Buffer, name: string): Pick<AssetRecord, 'kind' | 'mime'> {
  if (head.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { kind: 'image', mime: 'image/png' };
  if (head[0] === 255 && head[1] === 216 && head[2] === 255) return { kind: 'image', mime: 'image/jpeg' };
  if (head.toString('ascii',0,4) === 'RIFF' && head.toString('ascii',8,12) === 'WEBP') return { kind: 'image', mime: 'image/webp' };
  if (head.toString('ascii',0,4) === 'RIFF' && head.toString('ascii',8,12) === 'WAVE') return { kind: 'audio', mime: 'audio/wav' };
  if (head.toString('ascii',0,3) === 'ID3' || (head[0] === 255 && (head[1] & 224) === 224)) return { kind: 'audio', mime: 'audio/mpeg' };
  if (head.toString('ascii',4,8) === 'ftyp') return /\.m4a$/i.test(name) ? { kind: 'audio', mime: 'audio/mp4' } : { kind: 'video', mime: 'video/mp4' };
  if (head.subarray(0,4).equals(Buffer.from([26,69,223,163]))) return { kind: 'video', mime: 'video/webm' };
  const text = head.toString('utf8').replace(/^\uFEFF/, '').trim();
  if (/\.(srt|vtt)$/i.test(name) && (/^WEBVTT/.test(text) || /\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(text))) return { kind: 'captions', mime: 'text/plain' };
  if (/\.json$/i.test(name) && /^[\[{]/.test(text)) return { kind: 'source', mime: 'application/json' };
  if (/\.(tsx?|jsx?|css|md|txt)$/i.test(name) && !head.includes(0)) return { kind: 'source', mime: 'text/plain' };
  throw new AppError(400, '素材格式不受支持或文件内容与格式不符');
}
export class AssetService {
  constructor(readonly store: DataStore) {}
  async upload(userId: string, projectId: string, name: string, stream: AsyncIterable<Uint8Array> | Readable, sourceUrl?: string) {
    await this.store.loadProject(userId, projectId);
    const dir = await this.store.projectDir(userId, projectId);
    const assetDir = join(dir, 'assets');
    await mkdir(assetDir, { recursive: true });
    if (!name || name.length > 180 || basename(name) !== name || /[\\/\x00-\x1f]/.test(name)) throw new AppError(400, '素材文件名不合法');
    const id = randomUUID(), file = `assets/${id}`, path = join(dir, file);
    const handle = await open(path, 'wx');
    const hash = createHash('sha256');
    let bytes = 0, head = Buffer.alloc(0);
    try {
      for await (const chunk of stream) {
        const data = Buffer.from(chunk);
        bytes += data.length;
        if (bytes > fileLimit) throw new AppError(413, '单个素材不能超过 100 MB');
        hash.update(data);
        if (head.length < 8192) head = Buffer.concat([head, data.subarray(0, 8192 - head.length)]);
        await handle.writeFile(data);
      }
      await handle.sync();
      await handle.close();
      if (!bytes) throw new AppError(400, '素材文件为空');
      const type = classifyAsset(head, name);
      if ((type.kind === 'source' || type.kind === 'captions') && bytes > 1024 * 1024) throw new AppError(413, '文本与源码素材不能超过 1 MB');
      const record: AssetRecord = { id, name, file, ...type, bytes, sha256: hash.digest('hex'), createdAt: new Date().toISOString(), sourceUrl };
      if (type.kind === 'audio' || type.kind === 'video' || type.kind === 'image') {
        const result = JSON.parse(await runProcess(this.store.config.ffprobe, ['-v','error','-show_entries','format=duration:stream=codec_type,width,height','-of','json',path], dir, new AbortController().signal, 30000));
        const expected = type.kind === 'audio' ? 'audio' : 'video';
        if (!result.streams?.some((s: { codec_type: string }) => s.codec_type === expected)) throw new AppError(400, '素材没有可解码的媒体轨道');
        const duration = Number(result.format?.duration);
        if (type.kind !== 'image' && (!Number.isFinite(duration) || duration <= 0 || duration > 3600)) throw new AppError(400, '音视频时长需在 0–3600 秒之间');
        if (Number.isFinite(duration)) record.duration = duration;
      }
      if (type.mime === 'application/json') JSON.parse(await readFile(path, 'utf8'));
      await this.store.updateProject(userId, projectId, p => {
        p.assets ??= [];
        if (p.assets.reduce((n,a) => n + a.bytes, 0) + bytes > projectLimit) throw new AppError(413, '项目素材总量不能超过 1 GB');
        p.assets.push(record);
      });
      return record;
    } catch (error) {
      await handle.close().catch(() => {});
      await rm(path, { force: true });
      throw error;
    }
  }
  async remove(userId: string, projectId: string, assetId: string) {
    let file = '';
    await this.store.updateProject(userId, projectId, p => {
      if (p.renders.some(r => activeStatus(r.status))) throw new AppError(409, '生成中不能删除素材');
      const asset = p.assets?.find(a => a.id === assetId);
      if (!asset) throw new AppError(404, '素材不存在');
      file = asset.file;
      p.assets = p.assets!.filter(a => a.id !== assetId);
    });
    await rm(await this.store.artifact(userId, projectId, file), { force: true });
  }
}
