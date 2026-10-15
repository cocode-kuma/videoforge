import type { Context } from "@deepseek-ai/cordis";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z, ZodError } from "zod";
import { join,extname } from "node:path";
import {createRequire} from 'node:module';
import {CreativeWorkspace} from '../cocode-director/workspace.js';
import {recoverLegacyLogs} from '../cocode-director/legacy-log.js';
import { randomBytes } from "node:crypto";
import { DataStore } from "../cocode-data-store/index.js";
import { Director } from "../cocode-director/index.js";
import { AppError, BRAND, type User } from "../../shared/contracts.js";
import { log } from "../../shared/log.js";
import { billingCatalog } from "../../shared/billing.js";
import {
  calculateTokenCredits,
  resolveModelCoefficient,
} from "../../shared/billing.js";
import { OfficialSsoClient } from "../../shared/official-sso.js";
import { AssetService } from '../cocode-data-store/assets.js';
import { SourceImporter } from '../cocode-data-store/imports.js';

const cookieName = "cocode_session";
const token = (req: Request) =>
  req.headers.cookie
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
const cookieValue = (req: Request, name: string) =>
  req.headers.cookie
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(name + "="))
    ?.slice(name.length + 1);
const user = (res: Response) => res.locals.user as User;
const param = (req: Request, key: string) => String(req.params[key]);
const accountSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(10).max(128),
  name: z.string().trim().min(1).max(40).optional(),
});

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
export function isRequestOriginAllowed(
  requestOrigin: string | undefined,
  configuredOrigin: string,
  allowLoopbackAliases: boolean,
) {
  if (requestOrigin === configuredOrigin) return true;
  if (!allowLoopbackAliases || !requestOrigin) return false;
  try {
    const request = new URL(requestOrigin);
    const configured = new URL(configuredOrigin);
    return (
      request.origin === requestOrigin &&
      request.protocol === configured.protocol &&
      request.port === configured.port &&
      loopbackHosts.has(request.hostname.toLowerCase()) &&
      loopbackHosts.has(configured.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

export function createApp(store: DataStore, director: Director) {
  const assets = new AssetService(store);
  const app = express(),
    config = store.config,
    officialSso = new OfficialSsoClient(config);
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use((req, res, next) => {
    const incomingOrigin = `${req.protocol}://${req.get("host") ?? ""}`;
    if (
      process.env.NODE_ENV !== "production" &&
      req.method === "GET" &&
      req.accepts("html") &&
      !req.path.startsWith("/api/") &&
      incomingOrigin !== config.origin &&
      isRequestOriginAllowed(incomingOrigin, config.origin, true)
    )
      return res.redirect(302, `${config.origin}${req.originalUrl}`);
    next();
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          mediaSrc: ["'self'", "blob:"],
          connectSrc: ["'self'"],
          upgradeInsecureRequests: config.secure ? [] : null,
        },
      },
      strictTransportSecurity: config.secure ? undefined : false,
    }),
  );
  app.use(express.json({ limit: "32kb" }));
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "请求过于频繁，请稍后重试" },
    }),
  );
  app.use("/api", (req, _res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (!isRequestOriginAllowed(
        req.headers.origin,
        config.origin,
        process.env.NODE_ENV !== "production",
      ) ||
        req.headers["x-cocode-request"] !== "studio")
    )
      return next(new AppError(403, "请求来源不匹配，请刷新页面后重试"));
    next();
  });
  app.get("/api/health", (_req, res) =>
    res.json({ status: "ok", brand: BRAND }),
  );
  const authLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "登录尝试过多，请 15 分钟后重试" },
  });
  const setCookie = (res: Response, value: string) =>
    res.cookie(cookieName, value, {
      httpOnly: true,
      secure: config.secure,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 86400000,
    });
  app.get("/api/auth/providers", (_req,res) => res.json({officialSso:officialSso.configured,officialOnly:config.officialAccountsOnly}));
  app.post("/api/auth/register", authLimit, async (req, res) => {
    if (config.officialAccountsOnly) throw new AppError(403, "请前往官网注册账号，再使用官网账号登录");
    const data = accountSchema
      .extend({
        name: z.string().trim().min(1).max(40),
        inviteCode: z.string().trim().min(1).max(80),
      })
      .parse(req.body);
    const u = await store.register(
      data.email,
      data.password,
      data.name,
      data.inviteCode,
      req.ip ?? "",
    );
    setCookie(res, await store.newSession(u.id));
    res.status(201).json(u);
  });
  app.post("/api/auth/login", authLimit, async (req, res) => {
    if (config.officialAccountsOnly) throw new AppError(403, "请使用官网账号登录");
    const data = accountSchema.parse(req.body),
      u = await store.login(data.email, data.password);
    setCookie(res, await store.newSession(u.id));
    res.json(u);
  });
  app.get("/api/auth/session", async (req, res) => {
    try {
      res.json(await store.authenticate(token(req)));
    } catch (error) {
      if (error instanceof AppError && error.status === 401) res.json(null);
      else throw error;
    }
  });
  const officialStateCookie = "cocode_official_sso_state";
  const officialInviteCookie = "cocode_official_invite";
  app.post("/api/auth/official/start", authLimit, async (req, res) => {
    const { inviteCode } = z
      .object({ inviteCode: z.string().trim().max(80).optional().default("") })
      .parse(req.body ?? {});
    const state = randomBytes(24).toString("hex");
    const authorizeUrl = await officialSso.getAuthorizeUrl(state);
    res.cookie(officialStateCookie, state, {
      httpOnly: true,
      secure: config.secure,
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60 * 1000,
    });
    res.cookie(officialInviteCookie, inviteCode, {
      httpOnly: true,
      secure: config.secure,
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60 * 1000,
    });
    res.json({ authorizeUrl });
  });
  app.get("/api/auth/official/callback", async (req, res) => {
    let stage: "state" | "token" | "profile" | "account" = "state";
    try {
      const code = String(req.query.code ?? "");
      const state = String(req.query.state ?? "");
      const expectedState = cookieValue(req, officialStateCookie) ?? "";
      const inviteCode = cookieValue(req, officialInviteCookie) ?? "";
      res.clearCookie(officialStateCookie, {
        httpOnly: true,
        secure: config.secure,
        sameSite: "lax",
        path: "/",
      });
      res.clearCookie(officialInviteCookie, {
        httpOnly: true,
        secure: config.secure,
        sameSite: "lax",
        path: "/",
      });
      if (!code || !state || state !== expectedState)
        throw new AppError(400, "酷码登录校验失败，请重新登录");
      stage = "token";
      const tokenResponse = await officialSso.exchangeCode(code);
      stage = "profile";
      const profile = await officialSso.userInfo(tokenResponse.access_token);
      stage = "account";
      const account = await store.loginOfficial({
        id: String(profile.id),
        email: profile.email,
        nickname: profile.nickname,
      }, inviteCode, req.ip ?? "");
      if (config.officialAccountsOnly) await store.connectOfficialIdentity(account.id);
      setCookie(res, await store.newSession(account.id));
      res.redirect("/studio?official=1");
    } catch (error) {
      const status = error instanceof AppError ? error.status : 500;
      const reason = status === 403 ? "invite" : stage;
      // Keep diagnostics limited to the provider's numeric HTTP status. Never log
      // the callback URL, authorization code, request body, or token/secret data.
      const upstreamStatus =
        error instanceof AppError
          ? /酷码账号服务返回错误（(\d{3})）/.exec(error.message)?.[1]
            ?? /酷码账号服务返回错误（(\d{3})：/.exec(error.message)?.[1]
          : undefined;
      const upstreamCode =
        error instanceof AppError
          ? /酷码账号服务返回错误（\d{3}：([a-z_]+)）/.exec(error.message)?.[1]
          : undefined;
      void log(config.logsRoot, "酷码 SSO 回调失败", {
        stage: reason,
        status,
        ...(upstreamStatus ? { upstreamStatus: Number(upstreamStatus) } : {}),
        ...(upstreamCode ? { upstreamCode } : {}),
      }).catch(() => {});
      res.redirect(
        `/login?official_error=${reason}`,
      );
    }
  });
  app.use("/api", async (req, res, next) => {
    try {
      res.locals.user = await store.authenticate(token(req));
      if (config.officialAccountsOnly && req.path !== "/auth/logout") await store.connectOfficialIdentity(res.locals.user.id);
      next();
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/auth/me", (_req, res) => res.json(user(res)));
  app.post("/api/auth/logout", async (req, res) => {
    await store.logout(token(req)!);
    res.clearCookie(cookieName, {
      httpOnly: true,
      secure: config.secure,
      sameSite: "lax",
      path: "/",
    });
    res.json({ ok: true });
  });
  app.get("/api/usage", async (_req, res) =>
    res.json(await store.usage(user(res).id)),
  );
  app.get("/api/billing/catalog", (_req, res) => res.json(billingCatalog));
  app.get('/api/creation/capabilities',(_req,res)=>res.json(director.capabilities()));
  app.post("/api/billing/estimate", (req, res) => {
    const data = z
      .object({
        model: z.string().trim().min(1).max(120),
        tokens: z.number().int().nonnegative(),
      })
      .parse(req.body);
    const coefficient = resolveModelCoefficient(data.model);
    res.json({
      model: data.model,
      coefficient,
      tokens: data.tokens,
      units:
        coefficient === null
          ? null
          : calculateTokenCredits(data.tokens, coefficient),
      minimumCharge: billingCatalog.minimumCharge,
      version: billingCatalog.version,
      status: coefficient === null ? "model-not-configured" : "estimated",
    });
  });
  app.get("/api/billing/official", async (_req, res) =>
    res.json((await store.usage(user(res).id)).official),
  );
  app.post("/api/billing/official/connect", async (req, res) => {
    if (config.officialAccountsOnly) throw new AppError(403, "官网账号登录后自动同步积分，无需绑定其他账号");
    const data = z
      .object({
        accountRef: z.string().trim().min(1).max(200),
        bindingCode: z.string().trim().min(4).max(200),
      })
      .parse(req.body);
    res.json(
      await store.bindOfficial(user(res).id, data.accountRef, data.bindingCode),
    );
  });
  app.post("/api/billing/official/sync", async (_req, res) =>
    res.json(await store.syncOfficial(user(res).id)),
  );
  app.delete("/api/billing/official", async (_req, res) => {
    if (config.officialAccountsOnly) throw new AppError(403, "官网账号模式不支持解绑，请退出登录以切换账号");
    res.json(await store.disconnectOfficial(user(res).id));
  });
  app.get("/api/projects", async (_req, res) => {
    const uid=user(res).id,projects=await store.listProjects(uid);
    for(const project of projects)if(project.renders.some(r=>r.generationMode==='harness'&&r.status==='failed'&&!r.publicLogRecovered))await recoverLegacyLogs(store,uid,project.id);
    res.json(await store.listProjects(uid));
  });
  app.post("/api/projects", async (req, res) => {
    const { name } = z
      .object({ name: z.string().trim().min(1).max(80) })
      .parse(req.body);
    res.status(201).json(await store.createProject(user(res).id, name));
  });
  app.get("/api/projects/:id", async (req, res) =>
    res.json(await store.loadProject(user(res).id, param(req, "id"))),
  );
  app.patch("/api/projects/:id", async (req, res) => {
    const { name } = z
      .object({ name: z.string().trim().min(1).max(80) })
      .parse(req.body);
    res.json(
      await store.updateProject(user(res).id, param(req, "id"), (p) => {
        p.name = name;
      }),
    );
  });
  app.delete("/api/projects/:id", async (req, res) => {
    await store.deleteProject(user(res).id, param(req, "id"));
    res.json({ ok: true });
  });
  app.post("/api/projects/:id/generate", async (req, res) => {
    const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
    const refined=await director.prepareBrief(user(res).id,param(req,'id'),req.body,controller.signal);
    controller.signal.throwIfAborted();
    const job=await director.submit(user(res).id,param(req,'id'),refined.brief,undefined,refined.usage);
    res.status(202).json({...job,refinedPrompt:refined.brief.prompt});
  });
  app.get('/api/projects/:id/events',async(req,res)=>{
    const uid=user(res).id,pid=param(req,'id');await store.loadProject(uid,pid);
    let ready=false;const pending:{type:string;data:unknown}[]=[];
    const send=(event:string,data:unknown)=>{if(!res.destroyed)res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);};
    const unsubscribe=director.subscribe(uid,pid,event=>ready?send(event.type,event):pending.push({type:event.type,data:event}));
    let heartbeat:ReturnType<typeof setInterval>|undefined;res.on('close',()=>{if(heartbeat)clearInterval(heartbeat);unsubscribe();});
    try {
      const project=await store.loadProject(uid,pid);if(res.destroyed)return;
      res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');res.setHeader('X-Accel-Buffering','no');res.flushHeaders();
      send('project',project);ready=true;for(const event of pending)send(event.type,event.data);
      heartbeat=setInterval(()=>send('heartbeat',{}),15000);
    }catch(error){unsubscribe();throw error;}
  });
  app.post('/api/projects/:id/message',async(req,res)=>{
    const {text}=z.object({text:z.string().trim().min(1).max(8000)}).parse(req.body);
    const project=await store.loadProject(user(res).id,param(req,'id'));
    const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
    const refined=await director.prepareBrief(user(res).id,project.id,{...project.brief,prompt:text},controller.signal,true);
    controller.signal.throwIfAborted();
    res.status(202).json({...await director.steer(user(res).id,project.id,refined.brief.prompt,refined.usage,refined.brief),refinedPrompt:refined.brief.prompt});
  });
  app.patch('/api/projects/:id/settings',async(req,res)=>res.json(await director.configure(user(res).id,param(req,'id'),req.body)));
  app.post('/api/projects/:id/jobs/:jobId/cancel',async(req,res)=>res.json(await director.cancel(user(res).id,param(req,'id'),param(req,'jobId'))));
  app.post('/api/projects/:id/jobs/:jobId/resume',async(req,res)=>{
    const project=await store.loadProject(user(res).id,param(req,'id')),job=project.renders.find(r=>r.id===param(req,'jobId'));
    if(!job||job.status!=='failed'||job.generationMode!=='harness')throw new AppError(409,'此任务没有可继续的创作工程');
    res.status(202).json(await director.submit(user(res).id,project.id,project.brief,job.id));
  });
  app.get('/api/projects/:id/jobs/:jobId/files',async(req,res)=>{
    const project=await store.loadProject(user(res).id,param(req,'id')),job=project.renders.find(r=>r.id===param(req,'jobId'));
    if(!job||job.generationMode!=='harness')throw new AppError(404,'工程不存在');
    const root=await store.artifact(user(res).id,project.id,'renders/'+job.id+'/workspace');
    res.json((await new CreativeWorkspace(root).files()).filter(f=>!/^(.harness|\.cache|\.render)\//.test(f.path)));
  });
  app.get('/api/projects/:id/jobs/:jobId/artifact',async(req,res)=>{
    const project=await store.loadProject(user(res).id,param(req,'id')),job=project.renders.find(r=>r.id===param(req,'jobId'));
    if(!job||job.generationMode!=='harness')throw new AppError(404,'工程不存在');
    const path=z.string().min(1).max(500).parse(req.query.path);
    if(path.split(/[\\/]/).some(p=>p.startsWith('.')||p==='versions'))throw new AppError(404,'文件不存在');
    const file=await store.artifact(user(res).id,project.id,'renders/'+job.id+'/workspace/'+path);
    const mime:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.mp4':'video/mp4','.webm':'video/webm','.wav':'audio/wav','.mp3':'audio/mpeg'};
    res.type(mime[extname(path)]??'application/octet-stream');
    if(!mime[extname(path)]||req.query.download==='1')res.attachment(path.split(/[\\/]/).at(-1));
    if(extname(path)==='.svg')res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'; style-src 'unsafe-inline'");
    res.sendFile(file,{dotfiles:'allow'}); // Store validated ownership and every path component; data roots may be hidden.
  });
  app.get('/api/projects/:id/jobs/:jobId/source',async(req,res)=>{
    const project=await store.loadProject(user(res).id,param(req,'id')),job=project.renders.find(r=>r.id===param(req,'jobId'));
    if(!job||job.generationMode!=='harness')throw new AppError(404,'工程不存在');
    const root=await store.artifact(user(res).id,project.id,'renders/'+job.id+'/workspace'),workspace=new CreativeWorkspace(root);
    const require=createRequire(import.meta.url),AdmZip=createRequire(require.resolve('hyperframes/package.json'))('adm-zip'),zip=new AdmZip();
    for(const file of await workspace.files())if(!/^(.harness|\.cache|\.render|previews|exports|audio\/cache)\//.test(file.path)&&!['final.mp4','final-audio.mp4','captioned.mp4','audio-analysis.pcm'].includes(file.path))zip.addLocalFile(await workspace.path(file.path),file.path.includes('/')?file.path.slice(0,file.path.lastIndexOf('/')):'');
    res.type('application/zip').attachment('videoforge-'+job.id.slice(0,8)+'-source.zip').send(zip.toBuffer());
  });
  app.get('/api/projects/:id/assets', async (req, res) => res.json((await store.loadProject(user(res).id, param(req, 'id'))).assets ?? []));
  app.post('/api/projects/:id/import', async (req, res) => {
    const { url } = z.object({ url: z.url().max(2048) }).parse(req.body);
    res.status(201).json(await new SourceImporter(store).import(user(res).id, param(req, 'id'), url));
  });
  app.post('/api/projects/:id/assets', async (req, res) => {
    if (req.headers['content-type']?.split(';')[0] !== 'application/octet-stream') throw new AppError(415, '素材上传需使用二进制文件');
    if (Number(req.headers['content-length']) > 100 * 1024 * 1024) throw new AppError(413, '单个素材不能超过 100 MB');
    res.status(201).json(await assets.upload(user(res).id, param(req, 'id'), String(req.query.name ?? ''), req));
  });
  app.get('/api/projects/:id/assets/:assetId', async (req, res) => {
    const project = await store.loadProject(user(res).id, param(req, 'id'));
    const asset = project.assets?.find(a => a.id === param(req, 'assetId'));
    if (!asset) throw new AppError(404, '素材不存在');
    res.type(asset.mime);
    res.setHeader('Content-Disposition', 'attachment');
    res.sendFile(await store.artifact(user(res).id, project.id, asset.file),{dotfiles:'allow'});
  });
  app.delete('/api/projects/:id/assets/:assetId', async (req, res) => {
    await assets.remove(user(res).id, param(req, 'id'), param(req, 'assetId'));
    res.json({ ok: true });
  });
  app.get("/api/projects/:id/video/:jobId", async (req, res) => {
    const p = await store.loadProject(user(res).id, param(req, "id"));
    const r = p.renders.find(
      (r) => r.id === param(req, "jobId") && r.status === "completed",
    );
    if (!r?.video) throw new AppError(404, "视频尚未生成");
    const file = await store.artifact(user(res).id, p.id, r.video);
    res.type("mp4");
    res.setHeader("Cache-Control", "private, no-store");
    if (req.query.download === "1")
      res.attachment(`cocode-videoforge-${r.id.slice(0, 8)}.mp4`);
    res.sendFile(file,{dotfiles:'allow'}); // Express supports authenticated byte-range video playback.
  });
  app.use("/api", (_req, _res, next) => next(new AppError(404, "接口不存在")));
  app.use(
    express.static(join(config.root, "dist/client"), {
      index: false,
      fallthrough: true,
    }),
  );
  for (const route of ["/", "/login", "/studio"])
    app.get(route, (_req, res) =>
      res.sendFile(join(config.root, "dist/client/index.html")),
    );
  app.use((_req, res) =>
    res.status(404).type("text").send(`${BRAND} — 页面不存在`),
  );
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const status =
        error instanceof AppError
          ? error.status
          : error instanceof ZodError
            ? 400
            : 400 === (error as { status?: number })?.status
              ? 400
              : 500;
      const message =
        error instanceof AppError
          ? error.message
          : error instanceof ZodError
            ? "输入内容不符合要求，请检查邮箱、密码或项目内容"
            : status === 400
              ? "请求内容格式不正确"
              : "服务暂时不可用，请稍后重试";
      if (status >= 500)
        void log(config.logsRoot, "请求处理失败", {
          error: error instanceof Error ? error.message : String(error),
        }).catch(() => {});
      res.status(status).json({ error: message, brand: BRAND });
    },
  );
  return app;
}
export const name = "cocode-studio-ui";
export const inject = ["cocodeDataStore", "cocodeDirector"];
export async function apply(ctx: Context) {
  const store = ctx.cocodeDataStore,
    director = ctx.cocodeDirector;
  const app = createApp(store, director);
  const server = app.listen(store.config.port, store.config.host);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  ctx.effect(() => async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections();
    });
  });
  await log(store.config.logsRoot, `工作室已启动 ${store.config.origin}`);
}
