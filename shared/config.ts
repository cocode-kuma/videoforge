import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parse } from "yaml";

function yamlFile(path: string): Record<string, unknown> {
  try {
    return parse(readFileSync(path, "utf8")) ?? {};
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`无法解析服务端配置 ${path}`);
  }
}
function nativePlugins():{name:string;config:Record<string,unknown>}[]{
  const value=JSON.parse(process.env.VIDEOFORGE_DSH_PLUGINS||'[]');
  if(!Array.isArray(value)||value.some(p=>!p||typeof p.name!=='string'||!/^@deepseek-ai\/dsh-[a-z0-9-]+$/.test(p.name)||p.config&&typeof p.config!=='object'))throw new Error('VIDEOFORGE_DSH_PLUGINS 必须是可信 DSH 插件配置数组');
  return value.map(p=>({name:p.name,config:p.config??{}}));
}
function integer(key: string, fallback: number, min: number, max: number) {
  const v = Number(process.env[key] ?? fallback);
  if (!Number.isInteger(v) || v < min || v > max)
    throw new Error(`环境变量 ${key} 不合法`);
  return v;
}
export function readConfig(
  root = process.env.VIDEOFORGE_ROOT ?? process.cwd(),
) {
  const settings = yamlFile(resolve(homedir(), ".dsh/settings.yaml"));
  const credentials = yamlFile(resolve(homedir(), ".dsh/.credentials.yaml"));
  const port = integer("PORT", 3088, 1, 65535);
  const origin = process.env.PUBLIC_ORIGIN ?? `http://localhost:${port}`;
  const secure = process.env.COOKIE_SECURE === "true";
  const thinkingEffort=process.env.VIDEOFORGE_THINKING_EFFORT??'low';
  if(!['low','high','max'].includes(thinkingEffort))throw new Error('VIDEOFORGE_THINKING_EFFORT 不合法');
  if (
    process.env.NODE_ENV === "production" &&
    (!secure || !origin.startsWith("https://"))
  )
    throw new Error("生产环境须设置 HTTPS PUBLIC_ORIGIN 和 COOKIE_SECURE=true");
  const model=process.env.DEEPSEEK_MODEL || String(settings['agent-default-model'] || 'deepseek-flash');
  const apiKey=process.env.DEEPSEEK_API_KEY || String(credentials['deepseek-api-key'] || '');
  const baseUrl=process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  // Official Flash supports image input; proxies and other models require explicit configuration.
  const autoVision=process.env.VIDEOFORGE_VISION_ENABLED!=='false'&&new URL(baseUrl).hostname==='api.deepseek.com'&&['deepseek-flash','deepseek-v4-flash-vision-exp'].includes(model);
  const explicitVision=!!process.env.VIDEOFORGE_VISION_BASE_URL?.trim();
  return {
    root: resolve(root),
    dataRoot: resolve(root, "video_projects"),
    logsRoot: resolve(root, "logs"),
    host: process.env.HOST ?? "127.0.0.1",
    port,
    origin: new URL(origin).origin,
    secure,
    trustProxy: integer("TRUST_PROXY_HOPS", 0, 0, 5),
    model,
    apiKey,
    baseUrl,
    thinking: process.env.VIDEOFORGE_THINKING !== 'disabled',
    thinkingEffort,
    generationMaxTokens: integer('VIDEOFORGE_MAX_OUTPUT_TOKENS', 32768, 4096, 65536),
    maxRepairs: integer('VIDEOFORGE_MAX_REPAIRS', 2, 0, 4),
    creationMode: process.env.VIDEOFORGE_CREATION_MODE === 'pipeline' ? 'pipeline' as const : 'harness' as const,
    executionMode: process.env.VIDEOFORGE_EXECUTION_MODE === 'container' ? 'container' as const : 'local' as const,
    executionImage: process.env.VIDEOFORGE_EXECUTION_IMAGE || 'videoforge-creative:local',
    python: process.env.VIDEOFORGE_PYTHON || (existsSync(resolve(root,process.platform==='win32'?'.runtime/python/Scripts/python.exe':'.runtime/python/bin/python'))?resolve(root,process.platform==='win32'?'.runtime/python/Scripts/python.exe':'.runtime/python/bin/python'):'python'),
    blender: process.env.BLENDER_PATH || (()=>{try{return JSON.parse(readFileSync(resolve(root,'.runtime/blender/runtime.json'),'utf8')).executable as string;}catch{return 'blender';}})(),
    searchApiUrl: process.env.VIDEOFORGE_SEARCH_API_URL || '',
    searchApiKey: process.env.VIDEOFORGE_SEARCH_API_KEY || '',
    extraSkillRoots: (process.env.VIDEOFORGE_EXTRA_SKILLS_ROOTS||'').split(';').map(p=>p.trim()).filter(Boolean).map(p=>resolve(root,p)),
    elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || '',
    elevenLabsVoice: process.env.ELEVENLABS_VOICE_ID || '',
    elevenLabsModel: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
    elevenLabsBaseUrl: process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io',
    miniMaxApiKey: process.env.MINIMAX_API_KEY || '',
    miniMaxVoice: process.env.MINIMAX_VOICE_ID || 'Chinese_Graceful_Lady',
    miniMaxModel: process.env.MINIMAX_MODEL || 'speech-2.8-hd',
    miniMaxBaseUrl: process.env.MINIMAX_BASE_URL || 'https://api.minimax.io',
    ttsProvider: process.env.VIDEOFORGE_TTS_PROVIDER || 'auto',
    visionBaseUrl: process.env.VIDEOFORGE_VISION_BASE_URL?.trim() || (autoVision?baseUrl:''),
    visionApiKey: process.env.VIDEOFORGE_VISION_API_KEY || (!explicitVision&&autoVision?apiKey:''),
    visionModel: process.env.VIDEOFORGE_VISION_MODEL?.trim() || (!explicitVision&&autoVision?model:''),
    mediaApiUrl: process.env.VIDEOFORGE_MEDIA_API_URL?.trim() || '',
    mediaApiKey: process.env.VIDEOFORGE_MEDIA_API_KEY || '',
    ttsApiUrl: process.env.VIDEOFORGE_TTS_API_URL?.trim() || '',
    ttsApiKey: process.env.VIDEOFORGE_TTS_API_KEY || '',
    ttsVoice: process.env.VIDEOFORGE_TTS_VOICE || 'zf_xiaobei',
    figmaToken: process.env.FIGMA_ACCESS_TOKEN || '',
    figmaAllowedFileKeys: (process.env.FIGMA_ALLOWED_FILE_KEYS || '').split(',').map(s => s.trim()).filter(Boolean),
    inviteCode: process.env.INVITE_CODE?.trim() ?? "kuma",
    inviteFreeVideosPerIp: integer("INVITE_FREE_VIDEOS_PER_IP", 5, 0, 1000000),
    concurrency: integer("RENDER_CONCURRENCY", 1, 1, 4),
    nativePlugins:nativePlugins(),
    queueLimit: integer("MAX_QUEUED_JOBS", 20, 1, 100),
    dailyLimit: integer("MAX_DAILY_GENERATIONS", 20, 1, 10000),
    initialCredits: integer("INITIAL_WORKSPACE_CREDITS", 20, 0, 1000000),
    officialAccountsOnly: process.env.OFFICIAL_ACCOUNTS_ONLY === "true",
    officialQuotaApiUrl: process.env.OFFICIAL_QUOTA_API_URL?.trim() || "",
    officialQuotaApiKey: process.env.OFFICIAL_QUOTA_API_KEY || "",
    officialQuotaTimeout: integer("OFFICIAL_QUOTA_TIMEOUT_MS", 10000, 1000, 60000),
    officialSsoIssuer: process.env.OFFICIAL_SSO_ISSUER?.trim() || "",
    officialSsoClientId: process.env.OFFICIAL_SSO_CLIENT_ID?.trim() || "",
    officialSsoClientSecret: process.env.OFFICIAL_SSO_CLIENT_SECRET || "",
    officialSsoRedirectUri: process.env.OFFICIAL_SSO_REDIRECT_URI?.trim() || "",
    officialSsoScopes:
      process.env.OFFICIAL_SSO_SCOPES?.trim() || "openid profile email",
    tokenBillingEnabled: process.env.TOKEN_BILLING_ENABLED === "true",
    mailApiUrl: process.env.KUMA_MAIL_API_URL?.trim() || "",
    mailApiKey: process.env.KUMA_MAIL_API_KEY || "",
    mailFrom: process.env.KUMA_MAIL_FROM?.trim() || "",
    mailTimeout: integer("KUMA_MAIL_TIMEOUT_MS", 10000, 1000, 60000),
    projectLimit: integer("MAX_PROJECTS_PER_USER", 100, 1, 10000),
    renderTimeout: integer("RENDER_TIMEOUT_MS", 600000, 10000, 3600000),
    ffmpeg: process.env.FFMPEG_PATH || (existsSync(resolve(root,'.runtime/bin/ffmpeg.exe')) ? resolve(root,'.runtime/bin/ffmpeg.exe') : "ffmpeg"),
    ffprobe: process.env.FFPROBE_PATH || (existsSync(resolve(root,'.runtime/bin/ffprobe.exe')) ? resolve(root,'.runtime/bin/ffprobe.exe') : "ffprobe"),
  };
}
export type Config = ReturnType<typeof readConfig>;
