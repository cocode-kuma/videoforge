import {chromium} from 'playwright';
import sharp from 'sharp';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFile} from 'node:fs/promises';
const root=resolve('.test-artifacts/opus-production');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try{
 const page=await browser.newPage({viewport:{width:1920,height:1080}});
 await page.goto(pathToFileURL(join(root,'index.html')).href);await page.evaluate(()=>document.fonts.ready);
 const layers=[];
 for(const [i,t] of [.5,2,3.5,5,8,11,13.5,14.9].entries()){
  await page.evaluate(t=>window.render(t),t);const png=await page.screenshot();
  await writeFile(join(root,'previews','overview-'+i+'.png'),png);
  layers.push({input:await sharp(png).resize(480,270).toBuffer(),left:i%2*480,top:Math.floor(i/2)*270});
 }
 await sharp({create:{width:960,height:1080,channels:3,background:'#000'}}).composite(layers).png().toFile(join(root,'previews','overview.png'));
 const tests=[];
 for(const t of [2,6.5,12.5]){
  await page.reload();await page.evaluate(()=>document.fonts.ready);await page.evaluate(t=>window.render(t),t);const a=await sharp(await page.screenshot()).raw().toBuffer();
  await page.evaluate(()=>{window.render(14);window.render(1);});await page.evaluate(t=>window.render(t),t);const b=await sharp(await page.screenshot()).raw().toBuffer();
  tests.push({t,equal:a.equals(b)});
 }
 await writeFile(join(root,'determinism.json'),JSON.stringify(tests,null,2));console.log(JSON.stringify(tests));
}finally{await browser.close();}
