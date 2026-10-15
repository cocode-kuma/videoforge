import type { AssetRecord, Brief } from '../../shared/contracts.js';
import type { Workflow } from '../../shared/workflows.js';

export function routeWorkflow(brief: Brief, assets: AssetRecord[] = []): { workflow: Workflow; reason: string } {
  if (brief.workflow && brief.workflow !== 'auto') return { workflow: brief.workflow, reason: '用户选择' };
  const p = brief.prompt;
  const hasVideo = assets.some(a => a.kind === 'video');
  const hasAudio = assets.some(a => a.kind === 'audio');
  let workflow: Workflow = 'general-video';
  if (/remotion/i.test(p)) workflow = 'remotion-to-hyperframes';
  else if (hasVideo && /只.*字幕|仅.*字幕|添加字幕|烧录字幕/.test(p)) workflow = 'embedded-captions';
  else if (hasVideo && /口播|采访|讲者|画中画/.test(p)) workflow = 'talking-head-recut';
  else if (/github\.com\/[^/]+\/[^/]+\/pull\/\d+|[\w-]+\/[\w.-]+#\d+/.test(p + (brief.sourceUrl ?? ''))) workflow = 'pr-to-video';
  else if (/幻灯片|演示文稿|可导航|\bdeck\b/i.test(p)) workflow = 'slideshow';
  else if (hasAudio && /节拍|音乐同步|跟随音乐|卡点/.test(p)) workflow = 'music-to-video';
  else if (/网站导览|网页导览|网站展示|浏览网站/.test(p)) workflow = 'website-to-video';
  else if (/产品发布|产品宣传|新品|发布会/.test(p)) workflow = 'product-launch-video';
  else if (/旁白|讲解|科普|解释/.test(p)) workflow = 'faceless-explainer';
  else if (/logo.*动画|动态图形|标志动画|动效|动态字体/i.test(p)) workflow = 'motion-graphics';
  return { workflow, reason: workflow === 'general-video' ? '未匹配专用流程，采用通用创作' : '根据需求与素材匹配' };
}
