import { AppError } from '../../shared/contracts.js';

export function describeQualityFailure(error:unknown):string|undefined {
  const diagnostic=(error as {diagnostic?:string})?.diagnostic??'';
  if(/missing_gsap_plugin|Invalid property.*Missing plugin/.test(diagnostic))return '影片的动画依赖仍有问题，未通过检查';
  if(/font_family_without_font_face/.test(diagnostic))return '影片字体声明仍不完整，未通过检查';
  if(/gsap_non_transform_motion/.test(diagnostic))return '影片仍包含可能造成逐帧卡顿的布局动画，未通过检查';
  if(/主文案阅读时间不足/.test(diagnostic))return '主文案停留时间不足，未通过检查';
  if(/content_overlap|text_occluded|text_out_of_canvas/.test(diagnostic))return '画面仍存在文字重叠、遮挡或越界，未通过检查';
  if(/contrast_aa_failure/.test(diagnostic))return '画面文字对比度仍不足，未通过检查';
  if(/回退跳转画面不一致/.test(diagnostic))return '跳转后仍无法恢复一致画面，未通过检查';
  if(/黑帧或空白画面|没有可见推进/.test(diagnostic))return '画面仍为空或缺少可见推进，未通过检查';
  return undefined;
}

export type CheckReport = {
  ok: boolean;
  lint: {ok:boolean}; runtime: {ok:boolean};
  layout: {ok:boolean; samples:number[]};
  contrast: {ok:boolean;enabled:boolean;samples:number[];checked:number};
  snapshots: {enabled:boolean;files:string[]};
};
export function repairDiagnostic(output:string):string {
  for(let i=output.indexOf('{');i>=0;i=output.indexOf('{',i+1)) {
    try {
      const report=JSON.parse(output.slice(i).trim()) as Record<string,unknown>;
      if(typeof report.ok!=='boolean')continue;
      const groups=Object.fromEntries(['lint','runtime','layout','contrast','motion'].map(key=>{
        const group=report[key] as {findings?:{severity:string}[]};
        return [key,group?.findings?.filter(finding=>finding.severity==='error'||finding.severity==='warning')??[]];
      }));
      return JSON.stringify(groups).slice(0,14000);
    } catch {}
  }
  return output.slice(-14000);
}
/** CLI logging may precede JSON; never infer success from the exit code alone. */
export function parseCheckReport(output: string): CheckReport {
  for (let i=output.indexOf('{');i>=0;i=output.indexOf('{',i+1)) {
    try {
      const report=JSON.parse(output.slice(i).trim()) as CheckReport;
      if (!report || typeof report.ok !== 'boolean') continue;
      const runtime=report.runtime as {ok:boolean;findings?:{message:string}[]};
      if (!report.ok || !report.lint?.ok || !runtime?.ok || !report.layout?.ok || !report.contrast?.ok || runtime.findings?.some(f=>/Invalid property|GSAP target.*not found|Missing plugin/i.test(f.message))) throw new Error('质量检查发现问题');
      if (!report.layout.samples?.length || !report.contrast.enabled || !report.contrast.samples?.length || !report.contrast.checked || !report.snapshots?.enabled || !report.snapshots.files?.length) throw new Error('质量检查没有取得有效画面或文字样本');
      return report;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw Object.assign(new AppError(503,error instanceof Error ? error.message : '检查结果异常'),{diagnostic:output});
    }
  }
  throw Object.assign(new AppError(503,'视频检查没有返回有效报告'),{diagnostic:output});
}
