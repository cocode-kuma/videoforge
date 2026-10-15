# Choosing and implementing creative technology

HTML/CSS/JavaScript: multi-file interface or graphic animation. Load local `runtime/gsap.min.js`; use exact time seeking. SVG: independently editable shapes, groups, paths, masks and illustrations. Canvas 2D: redraw from scratch at supplied time; use mathematical state rather than incremental simulation.

Three.js: use local `runtime/three.module.js` or compile imports with `build_browser`. Import GLB assets; design actual geometry, material, lights, contact shadows and camera. Render on the supplied time. WebGL/GLSL: create shader sources and compile them, inspect shader errors, drive uniforms from time, resolution and consistent seeds. Avoid decorative effects that obscure the subject.

React/TypeScript/Remotion: create a multi-file frame-driven React project, register the composition (default ID `main`), save resources under `public/`, use `useCurrentFrame`, `Sequence`, image/video/audio components and proper asset waits. Read the official Remotion rules when needed. Do not use GSAP timers to drive Remotion frames.

Python: write a script for data, image or audio processing and execute it with arguments, keeping all outputs in the workspace. FFmpeg: use structured `process_media` operations for converting, cropping, extracting frames and segments. Mix tracks at explicit start times. TTS: choose a configured ElevenLabs, MiniMax, edge-tts, gateway or Kokoro provider, inspect returned duration and timing.

Blender: write Python to build a real scene and save a `.blend` file in the workspace. Use one explicit camera, lights, geometry, materials, keyframes and a renderer suited to the time budget. Render subject stills before animation. Container paths are under `/work`, available from `inspect_environment`; local paths use the supplied workspace root. Do not assume hidden views of a reference photograph are accurate.
