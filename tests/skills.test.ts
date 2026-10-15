import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SkillLibrary } from '../plugins/cocode-director/skills.js';
import { routeWorkflow } from '../plugins/cocode-director/routing.js';
import { residentSkills, workflows } from '../shared/workflows.js';
import { briefSchema } from '../shared/contracts.js';
import { CreativeKnowledge } from '../plugins/cocode-director/knowledge.js';
import { resolve } from 'node:path';

test('Chinese prompt engineering is discoverable and readable through production knowledge tools', async () => {
  const knowledge = new CreativeKnowledge(new SkillLibrary(), [{name:'creative',path:resolve('vendor/creative-skills')}]);
  const results = await knowledge.search('视频提示词工程');
  const id = 'creative/prompt-engineering/SKILL.md';
  assert.ok(results.some(result => result.path === id));
  const guide = await knowledge.read(id);
  assert.equal(guide.nextOffset, null);
  assert.ok(guide.content.includes('十条创作方法'));
  assert.ok(guide.content.includes('creative/tutorial/video-creation.md'));
  const source = await knowledge.read('creative/tutorial/video-creation.md');
  assert.ok(source.content.includes('提示词技巧十'));
  assert.equal(guide.sha256.length, 64);
});

test('every workflow includes all ten verified resident bodies and the router', async () => {
  const library = new SkillLibrary();
  for (const workflow of workflows) {
    const pack = await library.assemble(workflow.id);
    for (const name of residentSkills) assert.ok(pack.snapshot.files.some(f => f.path.endsWith(`/${name}/SKILL.md`)), name);
    assert.ok(pack.snapshot.files.some(f => f.path === 'skills/hyperframes/SKILL.md'));
    assert.ok(pack.text.includes(workflow.id));
    assert.ok(pack.snapshot.files.every(f => f.sha256.length === 64));
    assert.ok(pack.motionText.includes('Motion Doctrine (Gateway)'));
    assert.ok(!pack.text.includes('<skill-source path="internal/motion-doctrine/SKILL.md">'));
  }
});
test('missing knowledge and overflow never silently omit resident skills', async () => {
  await assert.rejects(new SkillLibrary(undefined, 10).assemble('general-video'), /预算/);
  await assert.rejects(new SkillLibrary().assemble('general-video', ['../../.env']), /不存在/);
});
test('routing respects explicit choice, URL intent and general fallback', () => {
  const brief = (prompt: string, workflow?: 'auto' | 'general-video') => briefSchema.parse({ prompt, workflow });
  assert.equal(routeWorkflow(brief('讲解这项技术', 'general-video')).workflow, 'general-video');
  assert.equal(routeWorkflow(brief('为 https://example.com 制作一部品牌短片')).workflow, 'general-video');
  assert.equal(routeWorkflow(brief('制作网站导览视频')).workflow, 'website-to-video');
  assert.equal(routeWorkflow(brief('讲解这个数学概念')).workflow, 'faceless-explainer');
});
test('phase knowledge includes concrete references; tools reject arbitrary paths and expose continuation',async()=>{
  const library=new SkillLibrary();
  const design=await library.phase('general-video','design');
  assert.ok(design.text.includes('video-composition.md'));
  assert.ok(!design.text.includes('Motion Doctrine (Gateway)'));
  const results=await library.search('animation morph');
  assert.ok(results.length&&results.every(result=>result.path.includes('animation')||result.path.includes('morph')));
  const part=await library.read('skills/hyperframes-creative/references/video-composition.md',0,100);
  assert.equal(part.content.length,100);assert.equal(part.nextOffset,100);
  const next=await library.read(part.path,part.nextOffset!,100);assert.equal(next.content.length,100);
  await assert.rejects(library.read('../../.env'),/只能读取/);
});
