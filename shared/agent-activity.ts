export const toolTitles:Record<string,string>={
  inspect_environment:'检查运行环境',run_command:'执行命令与测试',finish_response:'完成本轮回复',set_plan:'更新计划',set_project:'配置工程',list_files:'列出文件',read_file:'读取文件',write_file:'写入文件',edit_file:'修改文件',append_file:'追加文件',
  list_skills:'核对全部技能',search_skills:'查找技能',read_skill:'阅读技能',execute_script:'运行命令',build_browser:'编译工程',search_assets:'搜索素材',read_web:'读取网页',import_asset:'导入素材',generate_asset:'生成素材',
  process_image:'处理图片',process_media:'处理音视频',render_still:'渲染静帧',render_preview:'渲染预览',inspect_artifact:'检查画面',synthesize_voice:'生成配音',synthesize_music:'生成音乐',
  analyze_audio:'分析音频',set_audio:'编排音轨',export_video:'导出视频',review_video:'测试与评审',checkpoint_version:'保存版本',restore_version:'恢复版本',submit_delivery:'校验交付',ask_user:'询问用户',
};
export function activityTitle(name:string,args:unknown={}){
  const a=(args??{}) as Record<string,unknown>,target=a.path??a.entry??a.input??a.output;
  return (toolTitles[name]??name)+(typeof target==='string'?' · '+target:'');
}
export function publicToolData(value:unknown,secrets:string[]):unknown {
  const clean=(v:unknown):unknown=>{
    if(v&&typeof v==='object'&&['reasoning','reasoning-delta','reasoning-chunks'].includes(String((v as any).type)))return {type:'private-analysis',note:'原始内部推理未公开'};
    if(typeof v==='string'){let s=v;for(const secret of secrets.filter(s=>s&&s.length>=8))s=s.split(secret).join('[密钥已隐藏]');return s;}
    if(Array.isArray(v))return v.map(clean);
    if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([k])=>!['__images','reasoning_content','reasoning','replayState','rawOutput'].includes(k)).map(([k,item])=>[k,/^(authorization|api[_-]?key|access[_-]?token|password|secret)$/i.test(k)?'[密钥已隐藏]':clean(item)]));
    return v;
  };return clean(value);
}
