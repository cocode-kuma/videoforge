import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, type SkillSnapshot } from '../../shared/contracts.js';
import { residentSkills, type Workflow } from '../../shared/workflows.js';

export const PROMPT_VERSION = 'videoforge-4.0-five-stage';
const bundledRoot = ['../../vendor/hyperframes-skills/', '../../../vendor/hyperframes-skills/']
  .map(path => fileURLToPath(new URL(path, import.meta.url))).find(path => existsSync(resolve(path, 'manifest.json')))
  ?? fileURLToPath(new URL('../../vendor/hyperframes-skills/', import.meta.url));
type Manifest = { revision: string; files: { path: string; sha256: string }[] };
export type SkillPack = { motionText:string; text: string; snapshot: SkillSnapshot };
export class SkillLibrary {
  constructor(readonly root = bundledRoot, readonly maxCharacters = 340000) {}
  async catalog() {
    const manifest = JSON.parse(await readFile(resolve(this.root, 'manifest.json'), 'utf8')) as Manifest;
    return manifest;
  }
  /** Only pinned manifest entries are readable; links in skills never grant filesystem access. */
  async read(path: string, offset = 0, length = 24000) {
    const manifest = await this.catalog();
    const entry = manifest.files.find(file => file.path === path);
    const target = resolve(this.root, path);
    if (!entry || !target.startsWith(resolve(this.root) + sep) || !/\.(md|html|js|mjs|json)$/.test(path))
      throw new AppError(400, '只能读取已校验的技能文档和案例');
    const body = await readFile(target, 'utf8');
    const sha256 = createHash('sha256').update(body).digest('hex');
    if (sha256 !== entry.sha256) throw new AppError(503, `创作知识文件校验失败：${path}`);
    const start = Math.max(0, Math.floor(offset));
    const end = Math.min(body.length, start + Math.min(24000, Math.max(1, Math.floor(length))));
    return { path, sha256, content: body.slice(start, end), totalCharacters: body.length,
      nextOffset: end < body.length ? end : null };
  }
  async search(query: string) {
    const manifest = await this.catalog();
    const words = query.toLowerCase().split(/[\s,\/]+/).filter(Boolean);
    if (!words.length) return [];
    return manifest.files.filter(file => /\.(md|html)$/.test(file.path))
      .map(file => ({ path: file.path, score: words.reduce((score, word) => score + (file.path.toLowerCase().includes(word) ? 1 : 0), 0) }))
      .filter(file => file.score > 0).sort((a,b) => b.score-a.score || a.path.localeCompare(b.path)).slice(0,16)
      .map(file => ({ path: file.path }));
  }
  async phase(workflow: Workflow, stage: string) {
    const common = ['skills/hyperframes-core/references/minimal-composition.md',
      'skills/hyperframes-core/references/determinism-rules.md'];
    const references: Record<string,string[]> = {
      story: ['skills/hyperframes-creative/references/story-spine.md', 'skills/hyperframes-creative/references/prompt-expansion.md'],
      design: ['skills/hyperframes-creative/references/video-composition.md', 'skills/hyperframes-creative/references/typography.md', 'skills/hyperframes-creative/references/house-style.md'],
      motion: ['skills/hyperframes-creative/references/beat-direction.md', 'skills/hyperframes-animation/adapters/gsap-timeline-and-labels.md'],
      code: [...common, 'skills/hyperframes-animation/adapters/gsap.md', 'skills/hyperframes-animation/adapters/gsap-transforms-and-perf.md'],
      delivery: ['skills/hyperframes-creative/references/narration.md'],
      repair: [...common, 'skills/hyperframes-animation/adapters/gsap.md'],
      review: ['skills/hyperframes-creative/references/design-adherence.md', 'skills/hyperframes-creative/references/video-composition.md'],
    };
    // Workflow entry documents contain host operations. Keep them discoverable, not resident instructions.
    const paths = references[stage] ?? common;
    const files = await Promise.all(paths.map(path => this.read(path)));
    const manifest = await this.catalog();
    return { text: files.map(file => `<skill-source path="${file.path}"${file.nextOffset!==null?` nextOffset="${file.nextOffset}"`:''}>\n${file.content}\n</skill-source>`).join('\n'),
      snapshot: { revision: manifest.revision, promptVersion: PROMPT_VERSION,
        files: files.map(({path,sha256}) => ({path,sha256})) },
      catalog: ['hyperframes-core','hyperframes-creative','hyperframes-animation','hyperframes-keyframes','media-use','hyperframes-audio',workflow]
        .filter((name,i,all)=>all.indexOf(name)===i).map(name=>`skills/${name}/SKILL.md`) };
  }
  async assemble(workflow: Workflow, references: string[] = []): Promise<SkillPack> {
    const manifest = JSON.parse(await readFile(resolve(this.root, 'manifest.json'), 'utf8')) as Manifest;
    const paths = ['skills/hyperframes/SKILL.md', ...residentSkills.map(name =>
      name === 'motion-doctrine' ? `internal/${name}/SKILL.md` : `skills/${name}/SKILL.md`),
      ...(workflow === 'website-to-video' ? [] : [`skills/${workflow}/SKILL.md`]), ...references];
    const files: SkillSnapshot['files'] = [];
    const sections: string[] = [];
    let motionText='';
    for (const path of [...new Set(paths)]) {
      const entry = manifest.files.find(f => f.path === path);
      const target = resolve(this.root, path);
      if (!entry || !target.startsWith(resolve(this.root) + sep)) throw new AppError(503, `创作知识文件不存在：${path}`);
      const body = await readFile(target, 'utf8');
      const sha256 = createHash('sha256').update(body).digest('hex');
      if (sha256 !== entry.sha256) throw new AppError(503, `创作知识文件校验失败：${path}`);
      files.push({ path, sha256 });
      const section=`\n<skill-source path="${path}">\n${body}\n</skill-source>`;
      if(path==='internal/motion-doctrine/SKILL.md')motionText=section;
      else sections.push(section);
    }
    if (workflow === 'website-to-video') sections.push(`\n<workflow name="website-to-video" source="videoforge-local">使用已冻结的网站内容、截图和资源规划网站导览。先解释价值与使用步骤，再呈现真实界面。跨镜头保持设计 tokens、主体与运动连续。不得虚构网站功能或在渲染时访问网站。</workflow>`);
    const text = sections.join('\n');
    if (text.length+motionText.length > this.maxCharacters) throw new AppError(503, '创作知识超出上下文预算，需调整参考文件配置');
    return { motionText,text, snapshot: { revision: manifest.revision, promptVersion: PROMPT_VERSION, files } };
  }
}
