export const workflows = [
  { id: 'general-video', label: '通用视频', description: '品牌、故事、蒙太奇与自由创作' },
  { id: 'product-launch-video', label: '产品宣传', description: '产品发布、亮点与宣传' },
  { id: 'website-to-video', label: '网站导览', description: '网站界面与使用流程' },
  { id: 'faceless-explainer', label: '旁白讲解', description: '文字讲解与原创画面' },
  { id: 'pr-to-video', label: '代码变更解说', description: 'GitHub PR 与代码变化' },
  { id: 'embedded-captions', label: '添加字幕', description: '保留原视频，仅添加字幕' },
  { id: 'talking-head-recut', label: '口播包装', description: '原视频配合图形与重点标注' },
  { id: 'motion-graphics', label: '动态图形', description: '短动画、Logo 与数据图形' },
  { id: 'music-to-video', label: '音乐同步', description: '跟随音乐节拍呈现素材' },
  { id: 'slideshow', label: '可导航演示', description: '交付演示页面，而非 MP4' },
  { id: 'remotion-to-hyperframes', label: 'Remotion 迁移', description: '将源码迁移到 HyperFrames' },
] as const;
export type Workflow = typeof workflows[number]['id'];
export const workflowIds = workflows.map(w => w.id) as [Workflow, ...Workflow[]];
export const residentSkills = [
  'hyperframes-core', 'motion-doctrine', 'hyperframes-animation',
  'hyperframes-keyframes', 'hyperframes-creative', 'media-use',
  'hyperframes-cli', 'hyperframes-registry', 'figma', 'hyperframes-audio',
] as const;
