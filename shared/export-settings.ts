export type ExportResolution='720p'|'1080p'|'4k';
export function exportDimensions(aspect:string,resolution:ExportResolution):[number,number]{
  const short=resolution==='720p'?720:resolution==='4k'?2160:1080;
  const long=Math.round(short*16/9);
  return aspect==='9:16'?[short,long]:aspect==='1:1'?[short,short]:[long,short];
}
