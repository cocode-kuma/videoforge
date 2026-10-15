import {join,resolve} from 'node:path';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readConfig} from '../shared/config.js';
import {CreativeWorkspace} from '../plugins/cocode-director/workspace.js';
import {CreativeRuntime} from '../plugins/cocode-director/creative-runtime.js';
import {synthesizeVoice} from '../plugins/cocode-director/voice.js';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),sharp:typeof import('sharp').default=require('sharp');
const config=readConfig(),root=resolve('.test-artifacts/creative-runtime-smoke');await mkdir(root,{recursive:true});
const w=new CreativeWorkspace(root),runtime=new CreativeRuntime(config,w,new AbortController().signal);await runtime.prepareLibraries();
await w.write('assets/cup.svg','<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="#193229"/><path d="M42 58h88v55q0 35-44 35t-44-35z" fill="#f4d09b"/><path d="M130 65h12q25 0 25 22t-37 22" fill="none" stroke="#f4d09b" stroke-width="12"/><path d="M75 45q-15-12 0-24m25 24q-15-12 0-24" fill="none" stroke="#e8eee2" stroke-width="4"/></svg>');
await sharp(await w.path('assets/cup.svg')).png().toFile(await w.path('assets/cup.png',true));
await w.write('src/python.py','import json,math\nfrom pathlib import Path\nfrom PIL import Image\nImage.open("assets/cup.png").resize((96,96)).save("assets/processed.png")\nPath("data.json").write_text(json.dumps({"values":[math.sin(i/8) for i in range(24)]}))\n');
await runtime.execute('python','src/python.py');
await w.write('src/check.mjs','import fs from "node:fs/promises";await fs.writeFile("node-check.json",JSON.stringify({hasProviderKey:!!process.env.DEEPSEEK_API_KEY,data:JSON.parse(await fs.readFile("data.json","utf8"))}));');
await runtime.execute('node','src/check.mjs');
if(JSON.parse(await readFile(join(root,'node-check.json'),'utf8')).hasProviderKey)throw new Error('Provider credentials leaked');
await w.write('index.html',`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:320px;height:180px;overflow:hidden;background:#193229;color:#f4e6cb;font:22px sans-serif}#cup{position:absolute;left:12px;top:40px;width:105px}#title{position:absolute;left:16px;top:10px}canvas{position:absolute;width:96px;height:96px;top:64px}#draw{left:114px}#gl{left:214px;top:78px;height:88px}#three{left:210px;top:14px;height:64px;width:96px}</style></head><body><div id="title">COFFEE · CREATIVE</div><img id="cup" src="assets/processed.png"><canvas id="draw" width="96" height="96"></canvas><canvas id="gl" width="96" height="88"></canvas><canvas id="three" width="96" height="64"></canvas><script src="runtime/gsap.min.js"></script><script type="module">
import * as THREE from './runtime/three.module.js';
const r=new THREE.WebGLRenderer({canvas:document.querySelector('#three'),alpha:true,antialias:true});r.setSize(96,64,false);const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(45,1.5,.1,100);camera.position.z=3;const cube=new THREE.Mesh(new THREE.TorusKnotGeometry(.55,.15,80,12),new THREE.MeshNormalMaterial());scene.add(cube);
const gl=document.querySelector('#gl').getContext('webgl'),program=gl.createProgram();for(const [kind,src] of [[gl.VERTEX_SHADER,'attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}'],[gl.FRAGMENT_SHADER,'precision mediump float;varying vec2 uv;uniform float time;void main(){float v=.5+.5*sin(uv.x*12.+time*4.);gl_FragColor=vec4(.9,.4+v*.4,.18,1.);}']]){const s=gl.createShader(kind);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(program,s);}gl.linkProgram(program);gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);const p=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
const ctx=document.querySelector('#draw').getContext('2d'),tl=gsap.timeline({paused:true}).to('#cup',{y:-8,rotation:4,duration:1}).to('#cup',{y:0,rotation:0,duration:1});
window.render=t=>{tl.seek(t,false);ctx.clearRect(0,0,96,96);ctx.fillStyle='#f4d09b';ctx.beginPath();ctx.arc(48,48,18+Math.sin(t*4)*6,0,Math.PI*2);ctx.fill();gl.uniform1f(gl.getUniformLocation(program,'time'),t);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);cube.rotation.y=t;cube.rotation.x=t*.4;r.render(scene,camera);};window.render(0);
</script></body></html>`);
const browser={engine:'browser' as const,entry:'index.html',width:320,height:180,duration:2,fps:12};
await runtime.render(browser,'previews/browser-early.png',{at:.25});await runtime.render(browser,'previews/browser-late.png',{at:1.25});await runtime.render(browser,'previews/browser-repeat.png',{at:.25});
const hash=async(path:string)=>createHash('sha256').update(await readFile(join(root,path))).digest('hex');
if(await hash('previews/browser-early.png')===await hash('previews/browser-late.png'))throw new Error('No visible motion');
if(await hash('previews/browser-early.png')!==await hash('previews/browser-repeat.png'))throw new Error('Non-deterministic seek');
await runtime.render(browser,'exports/browser.mp4');console.log('HTML/SVG/Canvas/GSAP/Three.js/GLSL rendered; Python/Node/FFmpeg executed');
await w.write('src/remotion.tsx',`import React from 'react';import {registerRoot,Composition,AbsoluteFill,Img,staticFile,useCurrentFrame} from 'remotion';const Film=()=>{const f=useCurrentFrame();return <AbsoluteFill style={{background:'#193229',color:'#f4e6cb',fontSize:28,justifyContent:'center',alignItems:'center'}}><div>COFFEE</div><Img src={staticFile('cup.png')} style={{width:100,transform:'translateX('+Math.sin(f/5)*30+'px)'}}/></AbsoluteFill>};registerRoot(()=> <Composition id="main" component={Film} durationInFrames={24} fps={12} width={320} height={180}/>);`);
await mkdir(join(root,'public'),{recursive:true});await copyFile(join(root,'assets/cup.png'),join(root,'public/cup.png'));
const remotion={...browser,engine:'remotion' as const,entry:'src/remotion.tsx',composition:'main'};
await runtime.render(remotion,'previews/remotion.png',{at:.5});await runtime.render(remotion,'exports/remotion.mp4');console.log('React/TypeScript/Remotion rendered');
await w.write('src/blender.py',`import bpy,math,os
from mathutils import Vector
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
s=bpy.context.scene;s.render.engine='BLENDER_WORKBENCH';s.display.shading.light='STUDIO';s.display.shading.color_type='MATERIAL';s.display.shading.show_shadows=True;s.display.shading.background_type='WORLD';s.world.color=(0.08,0.16,0.13)
mat=bpy.data.materials.new('cream');mat.diffuse_color=(0.9,0.65,0.35,1)
bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=.65,depth=1.2,location=(0,0,.6));cup=bpy.context.object;cup.data.materials.append(mat);cup.rotation_euler.z=0;cup.keyframe_insert(data_path='rotation_euler',frame=1);cup.rotation_euler.z=math.pi*.5;cup.keyframe_insert(data_path='rotation_euler',frame=24)
bpy.ops.mesh.primitive_torus_add(major_radius=.42,minor_radius=.1,location=(.75,0,.7),rotation=(math.pi/2,0,0));bpy.context.object.data.materials.append(mat)
bpy.ops.mesh.primitive_plane_add(size=20);bpy.context.object.location.z=-.02
bpy.ops.object.camera_add(location=(3,-4,3));camera=bpy.context.object;camera.rotation_euler=(Vector((0,0,.7))-camera.location).to_track_quat('-Z','Y').to_euler();s.camera=camera;s.render.resolution_x=320;s.render.resolution_y=180;s.render.fps=12;s.frame_end=24
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath('coffee.blend'))
`);
await runtime.execute('blender','src/blender.py');
const blender={...browser,engine:'blender' as const,entry:'coffee.blend'};
await runtime.render(blender,'previews/blender.png',{at:.5});await runtime.render(blender,'exports/blender.mp4');console.log('Blender model, scene, animation and video rendered');
let edge:unknown;
try {await w.path('audio/edge.wav',true);edge=await synthesizeVoice(config,root,new AbortController().signal,{text:'让灵感成为作品。',provider:'edge',output:'audio/edge.wav'});console.log('edge-tts generated measured audio and subtitles');}
catch(error){edge={passed:false,error:error instanceof Error?error.message:String(error)};console.log('edge-tts service check: '+JSON.stringify(edge));}
await writeFile(join(root,'result.json'),JSON.stringify({passed:true,engines:['browser','remotion','blender'],deterministicSeek:true,python:true,node:true,ffmpeg:true,edge},null,2));
