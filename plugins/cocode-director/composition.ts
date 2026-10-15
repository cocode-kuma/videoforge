import type { Brief, Scene } from "../../shared/contracts.js";
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const dimensions = (aspect: Brief["aspect"]) =>
  aspect === "9:16" ? [720, 1280] : aspect === "1:1" ? [960, 960] : [1280, 720];
/** The model supplies validated design data; only this trusted template executes JS. */
export function composition(
  scene: Scene,
  aspect: Brief["aspect"],
  duration = scene.duration,
) {
  const [w, h] = dimensions(aspect),
    portrait = h > w;
  const [bg, accent, ink] = scene.palette;
  const cameras: Record<string,{from:Record<string,number>;to:Record<string,number>}> = {
    push: { from: { scale: 1 }, to: { scale: 1.13 } },
    pull: { from: { scale: 1.16 }, to: { scale: 1 } },
    pan: { from: { rotation: -5, x: -25 }, to: { rotation: 5, x: 25 } },
    truck: { from: { x: -55 }, to: { x: 55 } },
    static: { from: { scale: 1 }, to: { scale: 1 } },
  };
  const camera=cameras[scene.camera??'static']??cameras.static;
  const motif = scene.motif;
  const shape =
    motif === "grid"
      ? '<div class="grid"></div>'
      : motif === "horizon"
        ? '<div class="sun"></div><div class="land"></div>'
        : motif === "typography"
          ? `<div class="big">${esc(scene.headline.slice(0, 2))}</div>`
          : '<div class="ring r1"></div><div class="ring r2"></div><div class="ring r3"></div><div class="core"></div>';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(scene.title)} · cocode 酷码工作室 · Cocode Studio VideoForge</title><script src="gsap.min.js"></script><style>
@font-face{font-family:"Microsoft YaHei";src:local("Microsoft YaHei"),local("Noto Sans CJK SC")}*{box-sizing:border-box}html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:${bg}}body{font-family:Arial,"Microsoft YaHei",sans-serif;color:${ink}}
[data-composition-id]{position:relative;width:${w}px;height:${h}px;overflow:hidden;background:${bg}}
.world{position:absolute;inset:-80px;overflow:hidden}.art{position:absolute;left:${portrait ? "12" : "49"}%;top:${portrait ? "45" : "8"}%;width:650px;height:650px;transform:rotate(-18deg)}
.ring{position:absolute;border:2px solid ${accent};border-radius:50%;left:70px;top:70px;width:480px;height:480px;box-shadow:0 0 50px ${accent}22,inset 0 0 50px ${accent}22}.r2{transform:rotateY(58deg) rotateZ(25deg)}.r3{transform:rotateX(62deg) rotateZ(-20deg)}.core{position:absolute;left:225px;top:220px;width:165px;height:165px;border-radius:${motif === "rings" ? "35%" : "50%"};background:radial-gradient(circle at 28% 28%,${ink},${accent} 36%,${bg} 76%);box-shadow:0 0 80px ${accent}66}
.grid{position:absolute;inset:40px;background-image:linear-gradient(${accent}44 1px,transparent 1px),linear-gradient(90deg,${accent}44 1px,transparent 1px);background-size:65px 65px;transform:perspective(650px) rotateX(45deg);border:1px solid ${accent}88}
.sun{position:absolute;left:120px;top:50px;width:380px;height:380px;border-radius:50%;background:${accent};box-shadow:0 0 120px ${accent}55}.land{position:absolute;left:-80px;top:310px;width:850px;height:400px;border-radius:50%;background:${bg};border-top:2px solid ${ink}55;transform:rotate(-12deg)}.big{font-size:330px;line-height:1;font-weight:900;color:${accent};opacity:.6}
.copy{position:absolute;left:70px;top:${portrait ? "12" : "23"}%;width:${portrait ? "570" : "625"}px}.eyebrow{font:20px monospace;letter-spacing:5px;color:${ink};margin-bottom:32px}.headline{font-size:${portrait ? 76 : 82}px;font-weight:900;line-height:1.15;letter-spacing:-3px;max-width:${portrait ? 560 : 625}px;overflow-wrap:anywhere;margin:0}.caption{font-size:26px;line-height:1.65;max-width:540px;margin-top:28px;overflow-wrap:anywhere}.line{width:70px;height:5px;background:${accent};margin-top:35px}.footer{position:absolute;left:70px;bottom:35px;font:16px monospace;letter-spacing:1px}.scene-number{position:absolute;right:60px;bottom:35px;font:16px monospace}
</style></head><body><div id="root" data-composition-id="${scene.id}" data-start="0" data-duration="${duration}" data-width="${w}" data-height="${h}">
<div class="world" data-layout-ignore><div class="art">${shape}</div></div><div class="copy"><div class="eyebrow">COCODE / VIDEOFORGE</div><h1 class="headline">${esc(scene.headline)}</h1><div class="caption">${esc(scene.caption)}</div><div class="line"></div></div><div class="footer">cocode 酷码工作室 · Cocode Studio VideoForge</div><div class="scene-number">${esc(scene.id.toUpperCase())}</div></div>
<script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});tl.from('.art',{opacity:0,scale:.85,duration:1.1,ease:'power2.out'},.15);tl.from('.eyebrow',{opacity:0,y:14,duration:.6,ease:'power3.out'},.2);tl.from('.headline',{opacity:0,y:35,duration:.8,ease:'expo.out'},.35);tl.from('.caption',{opacity:0,x:-20,duration:.7,ease:'sine.out'},.6);tl.from('.line',{scaleX:0,transformOrigin:'left',duration:.6,ease:'power4.out'},.8);tl.from('.footer,.scene-number',{opacity:0,duration:.6,ease:'sine.out'},.4);tl.fromTo('.world',${JSON.stringify(camera.from)},{...${JSON.stringify(camera.to)},duration:${duration},ease:'none'},0);window.__timelines['${scene.id}']=tl;</script></body></html>`;
}
