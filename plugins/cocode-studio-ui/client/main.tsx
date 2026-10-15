import React, { useEffect, useRef, useState } from "react";
import {PromptPolish} from './PromptPolish.js';
import { createRoot } from "react-dom/client";
import {
  Bell,
  Copy,
  ListChecks,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clapperboard,
  Clock,
  Download,
  Film,
  Folder,
  Layers,
  LoaderCircle,
  LogOut,
  Maximize2,
  Play,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
  Video,
  X,
  PanelLeft,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Camera,
  Monitor,
  Smartphone,
  Square,
  Orbit,
  Sun,
  Palette,
  Pencil,
} from "lucide-react";
import type {
  Brief,
  OfficialQuotaSummary,
  Project,
  QuotaSummary,
  Scene,
  User,
} from "../../../shared/contracts.js";
import type { BillingCatalog } from "../../../shared/billing.js";
import { activeStatus } from "../../../shared/contracts.js";
import { StudioSelect } from "./StudioSelect.js";
import {AgentMessage,ToolActivity,conversationItems} from './AgentMessage.js';
import {ArtifactPreview,FinalVideo} from './ArtifactPreview.js';
import { ProjectMenu } from "./ProjectMenu.js";
import { workflows } from '../../../shared/workflows.js';

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
type Usage = QuotaSummary & {
  generated: number;
  attempts: number;
  today: number;
  dailyLimit: number;
  invitePromo?: { limit: number; completed: number; reserved: number; remaining: number };
};
function elapsedLabel(createdAt:string,completedAt?:string){
  const seconds=Math.max(0,Math.floor((Date.parse(completedAt??createdAt)-Date.parse(createdAt))/1000));
  return seconds<60?`${seconds} 秒`:`${Math.floor(seconds/60)} 分 ${seconds%60} 秒`;
}
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?:AbortSignal,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Cocode-Request": "studio",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(response.status, data.error || "请求失败");
  return data;
}
const cameraNames: Record<string, string> = {
  push: "缓慢推进",
  pull: "镜头拉远",
  pan: "水平摇镜",
  truck: "横向移镜",
  static: "固定镜头",
};
const transitionNames: Record<string, string> = {
  fade: "淡入淡出",
  dissolve: "叠化",
  wipe: "擦除",
  cut: "剪辑",
};
const suggestions = [
  {
    label: "产品宣传片",
    tag: "PRODUCT",
    icon: Orbit,
    prompt:
      "制作一支30秒的未来科技耳机宣传片，以悬浮的产品、精密细节与声波为视觉线索，从安静的开场逐步推向节奏高潮。",
    tone: "lime",
  },
  {
    label: "品牌故事",
    tag: "BRAND STORY",
    icon: Sun,
    prompt:
      "为独立咖啡品牌创作30秒品牌故事，从第一缕晨光到一杯咖啡，用温暖的色彩和从容的镜头传递日常中的小美好。",
    tone: "orange",
  },
  {
    label: "社交媒体短片",
    tag: "SOCIAL",
    icon: Palette,
    prompt:
      "做一个15秒的创意设计展预告，鲜明配色、大胆字体、快速但清晰的镜头节奏，结尾留下“让灵感发生”。",
    tone: "purple",
  },
];
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Video size={21} strokeWidth={2.5} />
      </span>
      <span>
        VideoForge<span className="brand-by">COCODE STUDIO</span>
      </span>
    </div>
  );
}
function Art({ small = false }: { small?: boolean }) {
  return (
    <div className={`orb-art ${small ? "small" : ""}`} aria-hidden="true">
      <div className="art-grid" />
      <div className="orbit-ring one" />
      <div className="orbit-ring two" />
      <div className="orbit-ring three" />
      <div className="orb" />
      <span className="art-cross c1">+</span>
      <span className="art-cross c2">+</span>
      <div className="art-label">IMAGINATION, IN MOTION.</div>
    </div>
  );
}
function Auth({ onAuth }: { onAuth: (u: User) => void }) {
  const [providers, setProviders] = useState({officialSso:false,officialOnly:false});
  useEffect(() => { api<{officialSso:boolean;officialOnly:boolean}>('/auth/providers').then(setProviders).catch(()=>{}); }, []);
  const officialError = new URLSearchParams(location.search).get("official_error");
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(() => {
      switch (officialError) {
        case "invite":
          return "首次使用官网账号注册时，请先切换到免费注册并填写邀请码 kuma。";
        case "state":
          return "登录校验未通过。请从 http://localhost:3088 发起登录后重试。";
        case "token":
          return "官网登录未完成，请确认官网已部署授权接口后重试。";
        case "profile":
          return "已取得官网令牌，但读取账号资料失败。请检查官网用户信息接口权限或账号资料。";
        case "account":
          return "官网授权成功，但积分或项目权限同步失败，请联系管理员检查账号权限与官网积分服务。";
        default:
          return "";
      }
    }),
    [inviteCode, setInviteCode] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(e.currentTarget));
    try {
      onAuth(
        await api<User>(
          `/auth/${register ? "register" : "login"}`,
          "POST",
          values,
        ),
      );
      history.replaceState(null, "", "/studio");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function officialLogin() {
    if (!providers.officialOnly && register && !inviteCode.trim()) {
      setError("新账号请先填写邀请码 kuma；已有官网账号可切换到登录后直接登录。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { authorizeUrl } = await api<{ authorizeUrl: string }>(
        "/auth/official/start",
        "POST",
        { inviteCode: register ? inviteCode : "" },
      );
      window.location.assign(authorizeUrl);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <section className="auth-story">
        <Brand />
        <div className="auth-heading">
          <span className="eyebrow">
            <span className="live-dot" /> YOUR NEXT STORY STARTS HERE
          </span>
          <h1>
            让灵感，
            <br />
            成为下一部<span>作品。</span>
          </h1>
          <p>
            从一句想法到完整视频。
            <br />
            你的创意，交给懂叙事的 AI 导演。
          </p>
        </div>
        <Art />
        <div className="auth-pills">
          <span>
            <Camera size={16} /> 导演级分镜
          </span>
          <span>
            <Layers size={16} /> 自由视觉创作
          </span>
          <span>
            <Film size={16} /> 高清视频导出
          </span>
        </div>
        <footer>cocode 酷码工作室 · Cocode Studio VideoForge</footer>
      </section>
      <section className="auth-form-side">
        <div className="auth-top">
          为每一个创作者而造 <Sparkles size={16} />
        </div>
        <div className="auth-form-wrap">
          <span className="small-badge">YOUR CREATIVE SPACE</span>
          <h2>{register ? "开启你的创作之旅" : "欢迎回到工作室"}</h2>
          <p>
            {register
              ? "新账号需要邀请码 kuma；同一注册 IP 共享 5 个成功视频名额。"
              : "使用酷码官网账号登录，VIP 身份和积分由官网统一管理。"}
          </p>
          <button
            className="official-login-button"
            type="button"
            onClick={() => void officialLogin()}
            disabled={!providers.officialSso || busy}
          >
            <Sparkles size={16} /> {providers.officialSso ? "使用官网账号登录" : "官网登录待配置"}
          </button>
          {providers.officialOnly && error && <div className="form-error" role="alert">{error}</div>}
          {providers.officialOnly && <p><a href="https://www.kuma2.cn/account/register.html">注册官网账号</a> · <a href="https://www.kuma2.cn/account/membership.html">查看 VIP 与积分</a></p>}
          {!providers.officialOnly && <>
          <div className="auth-divider"><span>或使用本地开发账号</span></div>
          <form onSubmit={submit}>
            {register && (
              <label>
                怎么称呼你
                <input
                  name="name"
                  placeholder="你的名字"
                  required
                  maxLength={40}
                  autoComplete="name"
                />
              </label>
            )}
            {register && (
              <label>
                邀请码
                <input
                  name="inviteCode"
                  placeholder="请输入邀请码"
                  required
                  maxLength={80}
                  autoComplete="off"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                />
              </label>
            )}
            <label>
              邮箱地址
              <input
                type="email"
                name="email"
                placeholder="you@example.com"
                required
                autoComplete="email"
                maxLength={254}
              />
            </label>
            <label>
              密码
              <input
                type="password"
                name="password"
                placeholder="至少 10 个字符"
                required
                minLength={10}
                maxLength={128}
                autoComplete={register ? "new-password" : "current-password"}
              />
            </label>
            {error && (
              <div className="form-error" role="alert">
                <AlertCircle size={16} />
                {error}
              </div>
            )}
            <button className="primary auth-submit" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <>
                  {register ? "创建账号" : "进入工作室"}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          <div className="auth-switch">
            {register ? "已有酷码账号？" : "还没有酷码账号？"}
            <button
              onClick={() => {
                setRegister(!register);
                setError("");
              }}
            >
              {register ? "立即登录" : "免费注册"}
            </button>
          </div>
          </>}
          <div className="auth-note">
            <span className="live-dot" /> 灵感属于你，作品也属于你。
          </div>
        </div>
        <footer>© {new Date().getFullYear()} cocode 酷码工作室</footer>
      </section>
    </div>
  );
}
function OfficialQuotaModal({
  official,
  catalog,
  onClose,
  onRefresh,
}: {
  official: OfficialQuotaSummary;
  catalog: BillingCatalog;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [accountRef, setAccountRef] = useState("");
  const [bindingCode, setBindingCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/billing/official/connect", "POST", {
        accountRef,
        bindingCode,
      });
      await onRefresh();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function sync() {
    setBusy(true);
    setError("");
    try {
      await api("/billing/official/sync", "POST");
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      await api("/billing/official", "DELETE");
      await onRefresh();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <form
        className="modal official-modal"
        role="dialog"
        aria-modal="true"
        aria-label="酷码工作室会员与积分"
        onSubmit={connect}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="modal-close"
          type="button"
          aria-label="关闭"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <span className="modal-icon">
          <Sparkles size={24} />
        </span>
        <h2>酷码工作室会员与积分</h2>
        {official.connected ? (
          <>
            <p>
              当前使用酷码工作室账号 {official.label || official.externalUserId}。生成任务会从工作室会员积分中扣除。
            </p>
            <div className="official-summary">
              <strong>{official.plan || "官网会员"}</strong>
              <b>{official.availableUnits} 积分</b>
              <small>
                状态：{official.status === "active" ? "有效" : official.status === "expired" ? "已过期" : "已暂停"}
                {official.expiresAt
                  ? ` · 到期 ${new Date(official.expiresAt).toLocaleDateString("zh-CN")}`
                  : ""}
              </small>
            </div>
            {official.lastSyncedAt && (
              <small className="official-sync-time">
                最近同步：{new Date(official.lastSyncedAt).toLocaleString("zh-CN")}
              </small>
            )}
          </>
        ) : (
          <>
            <p>正式版本将直接使用已注册的酷码工作室账号。当前为开发联调模式，暂通过一次性绑定码模拟官网账号。</p>
            <label>
              酷码工作室账号或用户 ID
              <input
                autoFocus
                value={accountRef}
                onChange={(e) => setAccountRef(e.target.value)}
                placeholder="例如：user@example.com"
                maxLength={200}
                required
              />
            </label>
            <label>
              开发联调绑定码
              <input
                value={bindingCode}
                onChange={(e) => setBindingCode(e.target.value)}
                placeholder="从官网会员中心复制"
                maxLength={200}
                required
              />
            </label>
          </>
        )}
        {official.managed ? <div className="billing-catalog"><strong>官网管理员设置的积分规则</strong><small>15 秒：{official.videoCosts?.["15"] ?? "—"} · 30 秒：{official.videoCosts?.["30"] ?? "—"} · 60 秒：{official.videoCosts?.["60"] ?? "—"} · 其他视频：{official.videoCosts?.other ?? "—"} · 对话：{official.chatCost ?? "—"} 积分 / 次</small><small>任务预扣，成功扣除，失败退回。新任务使用官网最新规则。</small><a href="https://www.kuma2.cn/account/membership.html" target="_blank" rel="noreferrer">官网充值积分与查看流水</a></div> : <div className="billing-catalog">
          <strong>当前价格规则 · {catalog.version}</strong>
          <small>{catalog.tokenFormula}</small>
          <div className="billing-packages">
            {catalog.packages.slice(0, 4).map((item) => (
              <span key={item.name}>
                {item.label} {item.credits.toLocaleString()} 积分 / ¥{item.priceYuan}
              </span>
            ))}
          </div>
          <small>课件制作与视频制作按实际 tokens 计费，最低扣除 {catalog.minimumCharge} 积分。</small>
        </div>}
        {error && (
          <div className="form-error" role="alert">
            <AlertCircle size={16} />
            {error}
          </div>
        )}
        <div className="official-actions">
          {official.connected ? (
            <>
              <button className="secondary" type="button" onClick={() => void sync()} disabled={busy}>
                {busy ? "同步中…" : "立即同步"}
              </button>
              {!official.managed && <button className="text-danger" type="button" onClick={() => void disconnect()} disabled={busy}>
                解除绑定
              </button>}
            </>
          ) : (
            <button className="primary" disabled={busy}>
              {busy ? "绑定中…" : "绑定官网账号"} <ArrowRight size={17} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
function SceneCard({
  scene,
  index,
  onSelect,
  selected,
}: {
  scene: Scene;
  index: number;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <button
      className={`scene-card ${selected ? "selected" : ""}`}
      onClick={onSelect}
    >
      <div
        className="scene-thumb"
        style={{ background: scene.palette[0], color: scene.palette[1] }}
      >
        <span className="mini-ring" />
        <b>{scene.headline}</b>
        <span className="scene-time">{scene.duration.toFixed(1)}s</span>
      </div>
      <div className="scene-caption">
        <span>{String(index + 1).padStart(2, "0")}</span>
        {scene.title}
      </div>
    </button>
  );
}
function App() {
  const [theme,setTheme]=useState<'light'|'dark'>(()=>localStorage.getItem('videoforge-theme')==='dark'?'dark':'light');
  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('videoforge-theme',theme);},[theme]);
  const [user, setUser] = useState<User | null>(null),
    [billing, setBilling] = useState<BillingCatalog | null>(null),
    [capabilities, setCapabilities] = useState({narration:false,vision:false,mediaGeneration:false,stages:5,maxRepairs:2,voices:[] as {id:string;configured:boolean;voice:string}[]}),
    [booting, setBooting] = useState(true),
    [projects, setProjects] = useState<Project[]>([]),
    [activeId, setActiveId] = useState<string | null>(null),
    [prompt, setPrompt] = useState(""),
    [specMode,setSpecMode]=useState<'auto'|'manual'>('auto'),
    [exportFps,setExportFps]=useState(30),
    [duration, setDuration] = useState<Brief['duration']>(30),
    [aspect, setAspect] = useState<Brief["aspect"]>("16:9"),
    [exportResolution,setExportResolution]=useState<"original"|"720p"|"1080p"|"4k">("1080p"),
    [style, setStyle] = useState<Brief["style"]>("cinematic"),
    [workflow, setWorkflow] = useState<NonNullable<Brief['workflow']>>('auto'),
    [sourceUrl, setSourceUrl] = useState(''),
    [narrationEnabled, setNarrationEnabled] = useState(false),
    [captionsEnabled, setCaptionsEnabled] = useState(false),
    [music, setMusic] = useState<NonNullable<Brief['music']>>('none'),
    [engine,setEngine]=useState<NonNullable<Brief['engine']>>('auto'),
    [taskMode,setTaskMode]=useState<NonNullable<Brief['taskMode']>>('auto'),
    [voiceProvider,setVoiceProvider]=useState<NonNullable<Brief['voiceProvider']>>('auto'),
    [busy, setBusy] = useState(false),
    [polish, setPolish] = useState<{result:string|null}|null>(null),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [tab, setTab] = useState<"preview" | "settings">("preview"),
    [selectedScene, setSelectedScene] = useState(0),
    [modal, setModal] = useState<"create" | "rename" | "delete" | "billing" | null>(null),
    [modalProject, setModalProject] = useState<Project | null>(null),
    [projectName, setProjectName] = useState(""),
    [sidebar, setSidebar] = useState(false),
    [previewOpen, setPreviewOpen] = useState(false),
    [usage, setUsage] = useState<Usage>({
      workspaceId: "",
      plan: "free",
      grantedUnits: 20,
      consumedUnits: 0,
      reservedUnits: 0,
      internalAvailableUnits: 20,
      availableUnits: 20,
      official: {
        connected: false,
        availableUnits: 0,
        status: "unavailable",
      },
      generated: 0,
      attempts: 0,
      today: 0,
      dailyLimit: 20,
    });
  const conversationRef = useRef<HTMLDivElement>(null);
  const polishController=useRef<AbortController|null>(null);
  const completionScrolled=useRef<string|null>(null);
  const chatEnd = useRef<HTMLDivElement>(null),
    streamConnected=useRef(false),streamVersion=useRef(0),followChat=useRef(true),
    promptRef = useRef<HTMLTextAreaElement>(null),
    videoRef = useRef<HTMLVideoElement>(null);
  const project = projects.find((p) => p.id === activeId),
    job = project?.renders.at(-1),
    rendering = job && activeStatus(job.status),
    completed = project?.renders.filter((r) => r.status === "completed" && r.video).at(-1),
    scene = project?.storyboard?.scenes[selectedScene];
  const [notice,setNotice]=useState<{projectId:string;title:string;questionId?:string}|null>(null);
  const seenNotices=useRef(new Set<string>()),noticeBooted=useRef(false);
  const pendingQuestion=project?.messages.find(m=>m.question?.status==='open'&&m.jobId===job?.id&&rendering);
  const desktopNotice=(title:string,body:string,tag:string,projectId:string,questionId?:string)=>{
    if(!('Notification' in window)||Notification.permission!=='granted')return false;
    try{
      const notification=new Notification(title,{body:body.slice(0,240),tag,requireInteraction:Boolean(questionId)});
      notification.onclick=()=>{window.focus();showAttention(projectId,questionId);notification.close();};
      return true;
    }catch{return false;}
  };
  const enableDesktopNotices=async()=>{
    const projectId=activeId??'';
    if(!('Notification' in window)){
      setNotice({projectId,title:'此浏览器不支持桌面提醒，请用 Edge 或 Chrome 打开'});return;
    }
    try{
      const permission=await Notification.requestPermission();
      if(permission!=='granted'){
        setNotice({projectId,title:'桌面提醒未获授权，请在浏览器网站权限中允许通知'});return;
      }
      const sent=desktopNotice(pendingQuestion?'VideoForge · 需要你的回答':'VideoForge · 提醒已开启',pendingQuestion?.text??'作品完成或需要你回答时，将在桌面提醒你。点击通知即可返回。','videoforge-notification-test',projectId,pendingQuestion?.id);
      setNotice({projectId,title:sent?'已发送桌面提醒，完成和提问时会自动通知':'当前浏览器无法发送桌面提醒，请用 Edge 或 Chrome 打开'});
    }catch{setNotice({projectId,title:'无法开启桌面提醒，请检查浏览器通知权限'});}
  };
  useEffect(()=>{
    if(!projects.length)return;
    for(const p of projects){
      for(const r of p.renders){
        const key='done:'+r.id;
        if(r.status==='completed'&&!seenNotices.current.has(key)){
          seenNotices.current.add(key);
          if(noticeBooted.current){setNotice({projectId:p.id,title:r.video?'你的作品已完成':'本轮回复已完成'});desktopNotice('VideoForge · 已完成',p.name,key,p.id);}
        }
      }
      for(const m of p.messages.filter(m=>m.question?.status==='open'&&p.renders.some(r=>r.id===m.jobId&&activeStatus(r.status)))){
        const key='question:'+m.id;if(seenNotices.current.has(key))continue;seenNotices.current.add(key);
        setNotice({projectId:p.id,title:'AI 正在等待你的回答',questionId:m.id});
        desktopNotice('VideoForge · 需要你的回答',m.text,key,p.id,m.id);
      }
    }
    noticeBooted.current=true;
    const waiting=projects.some(p=>p.messages.some(m=>m.question?.status==='open'&&p.renders.some(r=>r.id===m.jobId&&activeStatus(r.status))));
    document.title=waiting?'【需要回答】VideoForge':'VideoForge · 创作工作室';
    if(notice?.questionId&&!projects.some(p=>p.messages.some(m=>m.id===notice.questionId&&m.question?.status==='open')))setNotice(null);
  },[projects]);
  const showAttention=(projectId:string,questionId?:string)=>{
    if(!projectId)return;
    setActiveId(projectId);followChat.current=false;
    setTimeout(()=>{if(questionId)document.getElementById('question-'+questionId)?.scrollIntoView({block:'center',behavior:'smooth'});else{const box=conversationRef.current;const summary=box?.querySelector('.completion-summary');if(summary)summary.scrollIntoView({block:'start',behavior:'smooth'});else if(box)box.scrollTop=box.scrollHeight;}},100);
  };
  async function refresh() {
    const version=streamVersion.current;
    const p = await api<Project[]>("/projects");
    void api<typeof usage>("/usage").then(setUsage).catch(()=>{});
    setProjects(current=>p.map(incoming=>{
      const existing=current.find(old=>old.id===incoming.id);
      if(version===streamVersion.current||!existing)return incoming;
      return {...incoming,messages:[...incoming.messages,...existing.messages.filter(m=>!incoming.messages.some(n=>n.id===m.id))].map(m=>{const old=existing.messages.find(n=>n.id===m.id);return old&&(old.revision??0)>(m.revision??0)?old:m;}),renders:incoming.renders.map(r=>{const old=existing.renders.find(n=>n.id===r.id);return old&&(old.revision??0)>(r.revision??0)?old:r;})};
    }));
  }
  useEffect(() => {
    api<User | null>("/auth/session")
      .then(setUser)
      .catch(() => {})
      .finally(() => setBooting(false));
  }, []);
  useEffect(() => {
    if (!user) return;
    void refresh().catch((e) => setError(e.message));
    api<BillingCatalog>("/billing/catalog")
      .then(setBilling)
      .catch((e) => setError(e.message));
    api<typeof capabilities>('/creation/capabilities').then(setCapabilities).catch(e=>setError(e.message));
  }, [user]);
  useEffect(() => {
    if (!user) return;
    let stopped = false;
    const id = setInterval(() => {
      if (!stopped)
        void refresh().catch((e) => {
          if (e.status === 401) setUser(null);
          else setError(e.message);
        });
    }, 2500);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [user]);
  useEffect(() => {
    if (modal) setError("");
  }, [modal]);
  useEffect(()=>{
    if(!user||!activeId)return;
    let stopped=false,controller:AbortController|undefined;
    const sync=async()=>{
      controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),5000);
      try{
        const response=await fetch(`/api/projects/${activeId}`,{cache:'no-store',credentials:'same-origin',signal:controller.signal});
        if(!response.ok)return;const incoming=await response.json() as Project;
        if(stopped)return;
        setProjects(all=>all.map(old=>old.id!==incoming.id?old:{...incoming,
          messages:incoming.messages.map(m=>{const current=old.messages.find(n=>n.id===m.id);return current&&(current.revision??0)>(m.revision??0)?current:m;}),
          renders:incoming.renders.map(r=>{const current=old.renders.find(n=>n.id===r.id);return current&&(current.revision??0)>(r.revision??0)?current:r;})}));
      }catch{}finally{clearTimeout(timeout);if(!stopped)timer=setTimeout(sync,2000);}
    };
    let timer:ReturnType<typeof setTimeout>;void sync();
    const resume=()=>{if(document.visibilityState==='visible'){clearTimeout(timer);controller?.abort();}};
    document.addEventListener('visibilitychange',resume);
    return()=>{stopped=true;clearTimeout(timer);controller?.abort();document.removeEventListener('visibilitychange',resume);};
  },[user?.id,activeId]);
  const [progressNow,setProgressNow]=useState(Date.now());
  useEffect(()=>{if(!rendering)return;const timer=setInterval(()=>setProgressNow(Date.now()),1000);return()=>clearInterval(timer);},[!!rendering]);
  const [toolActivity,setToolActivity]=useState('');
  useEffect(()=>{
    if(!user||!activeId)return;
    const events=new EventSource(`/api/projects/${activeId}/events`);
    events.onopen=()=>{streamConnected.current=true;void refresh().catch(()=>{});};events.onerror=()=>{streamConnected.current=false;void refresh().catch(()=>{});};
    const update=(fn:(p:Project)=>Project)=>{streamVersion.current++;setProjects(all=>all.map(p=>p.id===activeId?fn(p):p));};
    events.addEventListener('project',event=>{const p=JSON.parse((event as MessageEvent).data) as Project;streamVersion.current++;setProjects(all=>all.some(old=>old.id===p.id)?all.map(old=>old.id===p.id?p:old):[p,...all]);});
    events.addEventListener('message',event=>{
      const e=JSON.parse((event as MessageEvent).data),m=e.data;
      update(p=>({...p,messages:p.messages.some(old=>old.id===m.id)?p.messages.map(old=>old.id===m.id&&(m.revision??0)>=(old.revision??0)?{...old,...m}:old):[...p.messages,{role:'assistant',jobId:e.jobId,createdAt:new Date().toISOString(),...m}]}));
    });
    events.addEventListener('artifact',event=>{const m=JSON.parse((event as MessageEvent).data).data;update(p=>({...p,messages:p.messages.some(old=>old.id===m.id)?p.messages.map(old=>old.id===m.id&&(m.revision??0)>=(old.revision??0)?m:old):[...p.messages,m]}));});
    events.addEventListener('tool',event=>{
      const d=JSON.parse((event as MessageEvent).data).data;
      if(d.message)update(p=>({...p,messages:p.messages.some(m=>m.id===d.message.id)?p.messages.map(m=>m.id===d.message.id&&(d.message.revision??0)>=(m.revision??0)?d.message:m):[...p.messages,d.message]}));
      const labels:Record<string,string>={write_file:'制作工程文件',edit_file:'调整作品',search_assets:'寻找参考素材',import_asset:'导入素材',process_image:'处理图片',render_still:'制作关键画面',render_preview:'制作动态预览',inspect_artifact:'查看画面',synthesize_voice:'制作配音',synthesize_music:'制作音乐',export_video:'导出成片',review_video:'检查成片',execute_script:'运行创作工程',read_skill:'阅读创作参考',search_skills:'寻找创作方法'};
      setToolActivity(d.status==='running'?(labels[d.name]??'推进创作任务'):d.status==='error'?'AI 正在处理执行结果':'');
    });
    events.addEventListener('state',event=>{const e=JSON.parse((event as MessageEvent).data);update(p=>({...p,storyboard:e.data.storyboard??p.storyboard,renders:p.renders.map(r=>r.id===e.jobId&&(e.data.revision===undefined||e.data.revision>=(r.revision??0))?{...r,...e.data}:r)}));if(['completed','failed'].includes(e.data.status))void refresh().catch(()=>{});});
    return ()=>{events.close();streamConnected.current=false;setToolActivity('');};
  },[user?.id,activeId]);
  useEffect(() => {
    if(!followChat.current)return;
    if(job?.status==='completed'&&completionScrolled.current===job.id)return;
    const frame=requestAnimationFrame(()=>{
      const box=conversationRef.current;
      if(!box)return;
      if(job?.status==='completed'){
        completionScrolled.current=job.id;
        box.querySelector('.completion-summary')?.scrollIntoView({block:'start'});
      }else box.scrollTop=box.scrollHeight;
    });
    return ()=>cancelAnimationFrame(frame);
  }, [project?.messages,job?.id,job?.status]);
  useEffect(()=>{followChat.current=true;completionScrolled.current=null;},[activeId]);
  useEffect(() => {
    setSelectedScene(0);
    if (project?.brief) {
      setDuration(project.brief.duration);
      setSpecMode(project.brief.specMode??'auto');
      setExportFps(project.brief.exportFps??30);
      setAspect(project.brief.aspect);
      setExportResolution(project.brief.exportResolution??"original");
      setStyle(project.brief.style);
      setWorkflow(project.brief.workflow ?? 'auto');
      setSourceUrl(project.brief.sourceUrl ?? '');
      setNarrationEnabled(project.brief.narrationEnabled ?? false);
      setCaptionsEnabled(project.brief.captionsEnabled ?? false);
      setMusic(project.brief.music ?? 'none');
      setEngine(project.brief.engine&&project.brief.engine!=='auto'?project.brief.engine:job?.projectConfiguration?.engine??project.brief.engine??'auto');setVoiceProvider(project.brief.voiceProvider??'auto');
      setTaskMode(project.brief.taskMode??'auto');
    }
  }, [activeId,JSON.stringify(project?.brief),JSON.stringify(job?.projectConfiguration)]);
  const configureProject=(patch:Omit<Partial<Brief>,'exportResolution'>&{exportResolution?:Brief['exportResolution']|null})=>{
    if(['duration','aspect','exportResolution','exportFps','style','engine'].some(key=>key in patch)){
      setSpecMode('manual');patch={...patch,specMode:'manual'};
    }
    if(!activeId||!project?.brief)return;
    void api<Project>(`/projects/${activeId}/settings`,"PATCH",patch).then(updated=>setProjects(current=>current.map(p=>p.id===updated.id?updated:p))).catch(e=>setError(e.message));
  };
  async function generate() {
    if (busy) return;
    if(rendering&&activeId) {
      if(!prompt.trim())return;setBusy(true);setError('');
      setPolish({result:null});
      polishController.current=new AbortController();
      try {const result=await api<{refinedPrompt:string}>(`/projects/${activeId}/message`,'POST',{text:prompt.trim()},polishController.current.signal);setPolish({result:result.refinedPrompt});setPrompt('');await refresh();}
      catch(e){setPolish(null);if((e as Error).name!=='AbortError')setError((e as Error).message);}finally{polishController.current=null;setBusy(false);}return;
    }
    if (!prompt.trim()) {
      setError("输入你的消息或创作要求。");
      promptRef.current?.focus();
      return;
    }
    setBusy(true);
    setError("");
    setPolish({result:null});
    polishController.current=new AbortController();
    try {
      let id = activeId;
      if (!id) {
        const p = await api<Project>("/projects", "POST", {
          name: prompt.slice(0, 24),
        });
        id = p.id;
        setActiveId(id);
      }
      const result=await api<{refinedPrompt:string}>(`/projects/${id}/generate`, "POST", {
        prompt,
        specMode,
        exportFps,
        duration,
        aspect,
        style,
        workflow,
        sourceUrl: sourceUrl.trim() || undefined,
        narrationEnabled,
        captionsEnabled,
        music,
        engine,voiceProvider,taskMode,exportResolution:exportResolution==='original'?undefined:exportResolution,
        assetIds: project?.assets?.map(a => a.id) ?? [],
      },polishController.current.signal);
      setPolish({result:result.refinedPrompt});
      setPrompt("");
      await refresh();
    } catch (e) {
      setPolish(null);
      if((e as Error).name!=='AbortError')setError((e as Error).message);
      await refresh().catch(() => {});
    } finally {
      polishController.current=null;
      setBusy(false);
    }
  }
  async function uploadAssets(files: FileList | null) {
    if (!files?.length || busy || rendering) return;
    setBusy(true); setError('');
    try {
      let id = activeId;
      if (!id) {
        const p = await api<Project>('/projects', 'POST', { name: '素材创作项目' });
        id = p.id; setActiveId(id);
      }
      for (const file of Array.from(files)) {
        const response = await fetch(`/api/projects/${id}/assets?name=${encodeURIComponent(file.name)}`, {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/octet-stream', 'X-Cocode-Request': 'studio' }, body: file,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? '素材上传失败');
      }
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function removeAsset(id: string) {
    if (!activeId || busy || rendering) return;
    setBusy(true); setError('');
    try { await api(`/projects/${activeId}/assets/${id}`, 'DELETE'); await refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function modalAction(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (modal === "delete") {
        if (!modalProject) return;
        await api(`/projects/${modalProject.id}`, "DELETE");
        if (activeId === modalProject.id) setActiveId(null);
      } else if (modal === "rename") {
        if (!modalProject) return;
        await api(`/projects/${modalProject.id}`, "PATCH", {
          name: projectName,
        });
      } else {
        const p = await api<Project>("/projects", "POST", {
          name: projectName,
        });
        setProjects(old=>old.some(item=>item.id===p.id)?old:[p,...old]);
        setActiveId(p.id);
        setPrompt("");
      }
      setModal(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (booting)
    return (
      <div className="boot">
        <Brand />
        <LoaderCircle className="spin" />
      </div>
    );
  if (!user) return <Auth onAuth={setUser} />;
  return (
    <div className="studio">
      {polish&&<PromptPolish result={polish.result} onClose={()=>{if(polish.result===null)polishController.current?.abort();setPolish(null);}}/>}
      <aside className={`sidebar ${sidebar ? "open" : ""}`}>
        <Brand />
        <button
          className="new-project"
          onClick={() => {
            setProjectName("");
            setModal("create");
          }}
        >
          <Plus size={18} /> 新建对话 <span>＋</span>
        </button>
        <div className="sidebar-heading">工作空间</div>
        <button
          className={`nav-item ${!activeId ? "active" : ""}`}
          onClick={() => {
            setActiveId(null);
            setSidebar(false);
          }}
        >
          <Clapperboard size={18} /> 创作工作室 <span className="nav-dot" />
        </button>
        <div className="project-heading">
          我的对话 <span>{projects.length}</span>
        </div>
        <label className="search">
          <Search size={15} />
          <input
            aria-label="搜索对话"
            placeholder="搜索对话…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="project-list">
          {projects
            .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
            .map((p) => (
              <div
                key={p.id}
                className={`project-row ${activeId === p.id ? "selected" : ""}`}
              >
                <button
                  className={`project-item ${activeId === p.id ? "selected" : ""}`}
                  onClick={() => {
                    setActiveId(p.id);
                    setSidebar(false);
                  }}
                >
                  <span className="project-icon">
                    <Film size={17} />
                  </span>
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      {new Date(p.updatedAt).toLocaleDateString("zh-CN", {
                        month: "short",
                        day: "numeric",
                      })}{" "}
                      ·{" "}
                      {p.renders.at(-1)?.status === "completed"
                        ? "已完成"
                        : p.renders.some((r) => activeStatus(r.status))
                          ? "制作中"
                          : "草稿"}
                    </small>
                  </span>
                  {p.renders.some((r) => activeStatus(r.status)) && (
                    <LoaderCircle size={13} className="spin" />
                  )}
                </button>
                <ProjectMenu
                  name={p.name}
                  rendering={p.renders.some((r) => activeStatus(r.status))}
                  onAction={(action) => {
                    setModalProject(p);
                    setProjectName(p.name);
                    setModal(action);
                  }}
                />
              </div>
            ))}
          {!projects.length && (
            <div className="empty-projects">
              每一个好作品，
              <br />
              都从一个想法开始。
            </div>
          )}
        </div>
        <div className="usage-card">
          <div>
            <Sparkles size={16} />
            <strong>让创作持续发生</strong>
            <span>STUDIO</span>
          </div>
          <p>
            可用积分{" "}
            <b>
              {usage.availableUnits} 积分
            </b>
          </p>
          <div className="usage-track">
            <i
              style={{
                width: `${usage.availableUnits ? 100 : 0}%`,
              }}
            />
          </div>
          <small>
            {usage.plan.toUpperCase()} · 本地 {usage.internalAvailableUnits} · 官网 {usage.official.availableUnits} · 已完成 {usage.generated} 部作品
          </small>
          {usage.invitePromo && (
            <small>
              邀请码福利：同注册 IP 共用 {usage.invitePromo.limit} 个免费视频，
              已完成 {usage.invitePromo.completed} 个，剩余 {usage.invitePromo.remaining} 个
            </small>
          )}
          <button
            className="usage-action"
            type="button"
            onClick={() => setModal("billing")}
          >
            {usage.official.connected ? "管理酷码会员" : "连接酷码账号"}
            <ArrowUpRight size={14} />
          </button>
        </div>
        <div className="user-row">
          <div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div>
          <span>
            <strong>{user.name}</strong>
            <small>个人工作空间</small>
          </span>
          <button
            title="退出登录"
            aria-label="退出登录"
            onClick={async () => {
              try {
                await api("/auth/logout", "POST");
                setUser(null);
                setProjects([]);
                setActiveId(null);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <LogOut size={16} />
          </button>
        </div>
        <div className="sidebar-copyright">cocode 酷码工作室</div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="mobile-menu"
              onClick={() => setSidebar(!sidebar)}
              aria-label="打开项目列表"
            >
              <PanelLeft size={19} />
            </button>
            <span className="breadcrumb">工作空间</span>
            <span className="slash">/</span>
            <strong>{project?.name || "创作工作室"}</strong>
          </div>
          <div className="top-actions"><button className="theme-toggle" aria-label={theme==='light'?'切换深色外观':'切换浅色外观'} onClick={()=>setTheme(theme==='light'?'dark':'light')}><Sun size={16}/><span>{theme==='light'?'浅色':'深色'}</span></button>
            <span className="saved">
              <span className="live-dot" />
              {rendering ? "正在创作" : "工作区已同步"}
            </span>
            <span className="top-avatar">{user.name.slice(0, 1)}</span>
          </div>
        </header>
        <div className={`workspace ${previewOpen ? "preview-open" : "preview-hidden"}`}>
          <main className="chat-panel">
            <div className="panel-heading">
              <span>
                <span className="director-icon">
                  <Sparkles size={17} />
                </span>{" "}
                AI 创意导演 <span className="beta">CREATIVE PARTNER</span>
              </span>
              <button className="preview-toggle" title="开启完成和提问的桌面提醒" onClick={()=>void enableDesktopNotices()}><Bell size={14}/>桌面提醒</button>
              <button className="preview-toggle" aria-expanded={previewOpen} aria-controls="workspace-preview" onClick={() => setPreviewOpen(v => !v)}><Play size={14}/>{previewOpen ? "收起预览" : "预览与参数"}</button>
            </div>
            {pendingQuestion&&<button className="answer-banner" onClick={()=>showAttention(activeId!,pendingQuestion.id)}><Bell size={16}/><span><strong>需要你的回答</strong> · AI 将等待你确认后继续</span><ArrowRight size={15}/></button>}
            <div ref={conversationRef} className="conversation" onScroll={e=>{const box=e.currentTarget;followChat.current=box.scrollHeight-box.scrollTop-box.clientHeight<100;}}>
              {!project?.messages.length ? (
                <div className="welcome">
                  <div className="welcome-kicker">
                    <span className="tiny-spark">✳</span> A LITTLE IDEA. A GREAT
                    FILM.
                  </div>
                  <h1>
                    你的想象，
                    <br />
                    值得被<span>看见。</span>
                  </h1>
                  <p>
                    描述脑海里的画面，让 AI 导演为你安排
                    <br className="desktop-br" />
                    分镜、运镜与节奏，创作属于你的作品。
                  </p>
                  <div className="start-label">
                    从一个灵感开始 <span>↘</span>
                  </div>
                  <div className="inspiration-grid">
                    {suggestions.map((s) => (
                      <button
                        key={s.tag}
                        className={`inspiration ${s.tone}`}
                        onClick={() => {
                          setPrompt(s.prompt);
                          if (s.tag === "SOCIAL") setDuration(15);
                          promptRef.current?.focus();
                        }}
                      >
                        <div className="inspiration-art">
                          <s.icon size={38} strokeWidth={1} />
                          <span className="mini-star">✦</span>
                        </div>
                        <span>
                          {s.label}
                          <ArrowUpRight size={15} />
                        </span>
                        <small>{s.tag}</small>
                      </button>
                    ))}
                  </div>
                  <div className="welcome-tip">
                    <span className="live-dot" />{" "}
                    不需要懂剪辑，只需要一个好想法。
                  </div>
                </div>
              ) : (
                <div className="messages">
                  {(()=>{
                    const finalId=job?.status==='completed'?project.messages.filter(m=>m.role==='assistant'&&!m.kind&&!m.attachments?.length&&m.jobId===job.id).at(-1)?.id:undefined;
                    const items=conversationItems(project.messages).filter(({message:m})=>m.id!==finalId);
                    const renderItem=({message:m,tools}:ReturnType<typeof conversationItems>[number])=> tools ? <ToolActivity key={m.id} messages={tools}/> : (
                    <div key={m.id} className={`message ${m.role} ${m.attachments?.length?"has-artifact":""}`}>
                      <div>
                        {!(m.attachments?.length&&m.attachments.some(a=>a.label===m.text))&&                        <AgentMessage message={m} answerEnabled={!!rendering&&m.jobId===job?.id} onAnswer={async text=>{if(activeId)try{await api(`/projects/${activeId}/message`,'POST',{text});}catch(e){setError((e as Error).message);throw e;}}}/>}
                        {m.streaming&&<span className="streaming-dot" aria-label="AI 正在回复" />}
                        {m.attachments?.map(a=>{
                          const url=`/api/projects/${activeId}/jobs/${m.jobId}/artifact?path=${encodeURIComponent(a.path)}&revision=${m.revision??0}`;
                          return <ArtifactPreview key={a.path} artifact={a} url={url}/>;
                        })}
                      </div>
                    </div>
                 );
                    if(job?.status!=='completed')return items.map(renderItem);
                    const isProcess=({message:m}:ReturnType<typeof conversationItems>[number])=>m.jobId===job.id&&m.role!=='user';
                    return <>
                      {items.filter(item=>!isProcess(item)).map(renderItem)}
                      <details key={job.id} className="completion-summary">
                        <summary>用时 {elapsedLabel(job.createdAt,job.completedAt)} <ChevronDown size={13}/></summary>
                        <div className="completion-process">
                          {items.filter(isProcess).map(renderItem)}
                          {job.plan?.length?<details className="plan-summary"><summary><ListChecks size={15}/><span>创作计划</span><small>{job.plan.filter(step=>step.status==='done').length}/{job.plan.length}</small><ChevronDown size={13}/></summary><ol>{job.plan.map((step,i)=><li key={i}>{step.title}</li>)}</ol></details>:null}
                          {job.generationMode==='harness'&&<a href={`/api/projects/${activeId}/jobs/${job.id}/source`}>下载可编辑工程</a>}
                        </div>
                      </details>
                    </>;
                  })()}
                  {job?.status==="completed"&&(()=>{const final=project.messages.filter(m=>m.role==="assistant"&&!m.kind&&!m.attachments?.length&&m.jobId===job.id).at(-1);return final?<div className="final-response"><div className="message-text">{final.text}</div><button aria-label="复制最终回复" title="复制回复" onClick={()=>void navigator.clipboard.writeText(final.text).catch(()=>setError("复制失败，请选择文字复制"))}><Copy size={15}/></button></div>:null;})()}
                  {job?.status==='completed'&&job.video&&<FinalVideo key={job.id} url={`/api/projects/${activeId}/video/${job.id}`} duration={job.duration??project.brief?.duration}/>}
                  {job && !["completed"].includes(job.status) && (
                    <div className={`job-card ${job.status}`}>
                      <span>
                        {job.status === "completed" ? (
                          <CheckCircle2 size={20} />
                        ) : job.status === "failed" ? (
                          <AlertCircle size={20} />
                        ) : (
                          <LoaderCircle size={20} className="spin" />
                        )}
                      </span>
                      <div>
                        <strong>{rendering ? "正在创作你的作品" : job.status === "completed" ? "本轮创作已完成" : job.status === "failed" ? "创作暂时遇到问题" : "创作已暂停"}</strong>
                        
                        {job.plan?.length ? <details className="plan-summary"><summary><ListChecks size={15}/><span>创作计划</span><small>{job.plan.filter(step=>step.status==='done').length}/{job.plan.length}</small><ChevronDown size={13}/></summary><ol>{job.plan.map((step,i)=><li key={i} className={step.status}>{step.status==='done'?<Check size={14}/>:step.status==='active'?<LoaderCircle size={14} className="spin"/>:<span className="plan-pending"/>}<span>{step.title}</span></li>)}</ol></details> : null}
                        {job.generationMode!=='harness'&&<div className="progress-track">
                          <i style={{ width: `${job.progress}%` }} />
                        </div>}
                        <small>
                          {job.status === "completed"
                            ? (job.video?"视频已交付":"本轮回复完成")
                            : job.status === "failed"
                              ? "可以调整描述后重新生成"
                              : job.generationMode==='harness'?`${job.status==='assembling'?job.message:'任务会在后台继续，你可以切换对话'}`:`${job.progress}% · 你可以离开页面，任务会继续`}
                        </small>
                        {rendering&&job.lastProgressAt&&progressNow-Date.parse(job.lastProgressAt)>30000&&<small className="progress-wait">暂未收到新进度，正在等待当前阶段完成</small>}
                        {rendering&&<button className="text-danger" onClick={()=>void api(`/projects/${activeId}/jobs/${job.id}/cancel`,'POST',{}).then(refresh).catch(e=>setError(e.message))}>停止并保存</button>}
                        {job.status==='failed'&&job.generationMode==='harness'&&<button className="secondary" onClick={()=>void api(`/projects/${activeId}/jobs/${job.id}/resume`,'POST',{}).then(refresh).catch(e=>setError(e.message))}>继续当前工程</button>}
                        {job.generationMode==='harness'&&<a className="source-download" href={`/api/projects/${activeId}/jobs/${job.id}/source`}>下载可编辑工程</a>}
                      </div>
                    </div>
                  )}
                  <div ref={chatEnd} />
                </div>
              )}
            </div>
            <div className="composer-wrap">
              {error && (
                <div className="error-banner" role="alert">
                  <AlertCircle size={16} />
                  <span>{error}</span>
                  <button aria-label="关闭提示" onClick={() => setError("")}>
                    <X size={15} />
                  </button>
                </div>
              )}
              <div className={`composer ${busy ? "busy" : ""}`}>
                <textarea
                  ref={promptRef}
                  aria-label="视频创意"
                  placeholder={
                    project?.messages.length
                      ? "继续描述你的调整方向…"
                      : "试试：“一支 30 秒的科技产品宣传片，极简、未来感…”"
                  }
                  value={prompt}
                  maxLength={4000}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      void generate();
                    }
                  }}
                />
                <div className="composer-bottom">
                  <div className="composer-options">
                    <StudioSelect label="规格规划" value={specMode} onChange={value=>{setSpecMode(value);configureProject({specMode:value});}} options={[
                      {value:'auto',label:'AI 决定规格',description:'根据你的需求规划时长、画幅与画质'},
                      {value:'manual',label:'手动指定规格',description:'采用你在界面指定的成品规格'},
                    ]}/>
                    {specMode==='manual'&&<>
                    <StudioSelect
                      label="视频时长"
                      icon={<Clock size={14} />}
                      value={duration}
                      onChange={value=>{setDuration(value);configureProject({duration:value});}}
                      options={[
                        ...(![15,30,60].includes(duration)?[{value:duration,label:`${duration} 秒`,description:'自定义视频时长'}]:[]),
                        {
                          value: 15,
                          label: "15 秒",
                          description: "简短有力，适合社交预告",
                        },
                        {
                          value: 30,
                          label: "30 秒",
                          description: "从容展开，适合产品与品牌",
                        },
                        {
                          value: 60,
                          label: "60 秒",
                          description: "完整叙事，留出更多表达空间",
                        },
                      ]}
                    />
                    <StudioSelect
                      label="画面比例"
                      icon={<Monitor size={14} />}
                      value={aspect}
                      onChange={value=>{setAspect(value);configureProject({aspect:value});}}
                      options={[
                        {
                          value: "16:9",
                          label: "16:9",
                          description: "横屏 · 适合电脑与大屏",
                        },
                        {
                          value: "9:16",
                          label: "9:16",
                          description: "竖屏 · 适合手机短视频",
                        },
                        {
                          value: "1:1",
                          label: "1:1",
                          description: "方形 · 适合社交动态",
                        },
                      ]}
                    />
                    <span className="creative-hint">
                      <Sparkles size={13} /> 自由创作
                    </span>
                    </>}
                  </div>
                  <button
                    className="generate-button"
                    onClick={() => void generate()}
                    disabled={busy}
                    title={
                      rendering
                        ? "发送修改要求，AI 会继续当前工程"
                        : busy
                          ? "正在提交…"
                          : "发送消息，让 AI 开始处理"
                    }
                    aria-label={rendering?'发送修改要求':'发送消息'}
                  >
                    {busy ? (
                      <LoaderCircle size={18} className="spin" />
                    ) : (
                      <ArrowUp size={19} />
                    )}
                  </button>
                </div>
              </div>
              <div className="composer-foot">
                <span>由你的创意驱动，由 VideoForge 实现。</span>
                <span>⌘ / Ctrl + Enter 发送</span>
              </div>
            </div>
          </main>
          {previewOpen && <aside id="workspace-preview" className="preview-panel">
            <div className="preview-tabs">
              <button
                className={tab === "preview" ? "active" : ""}
                onClick={() => setTab("preview")}
              >
                <Play size={14} /> 视频预览
              </button>
              <button
                className={tab === "settings" ? "active" : ""}
                onClick={() => setTab("settings")}
              >
                <Layers size={15} /> 创作参数
              </button>
            </div>
            {tab === "preview" ? (
              <>
                <div className="preview-card">
                  <div className="preview-screen">
                    {completed ? (
                      <video
                        ref={videoRef}
                        key={completed.id}
                        src={`/api/projects/${activeId}/video/${completed.id}`}
                        controls
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      <>
                        <div className="preview-empty">
                          <span
                            className="preview-placeholder-icon"
                            aria-hidden="true"
                          >
                            <Clapperboard size={24} />
                          </span>
                          <strong>
                            {rendering
                              ? "你的作品正在成形"
                              : "好故事，即将开场"}
                          </strong>
                          <small>
                            {rendering
                              ? "渲染完成后将在这里呈现"
                              : "从左侧描述你的第一个创意"}
                          </small>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="preview-controls">
                    <span>
                      {completed ? "MP4 · H.264" : "预览画布"}
                      <span className="control-divider" /> {aspect}
                    </span>
                    <button
                      aria-label="全屏预览"
                      disabled={!completed}
                      title={completed ? "全屏播放" : "视频生成后可全屏播放"}
                      onClick={() => {
                        const video = videoRef.current;
                        if (!video?.requestFullscreen) {
                          setError(
                            "此浏览器暂不支持全屏，请使用视频播放器内的全屏按钮。",
                          );
                          return;
                        }
                        void video
                          .requestFullscreen()
                          .catch(() =>
                            setError(
                              "全屏未能打开，请使用视频播放器内的全屏按钮。",
                            ),
                          );
                      }}
                    >
                      <Maximize2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="section-title">
                  {job?.generationMode==='whole-film'?'全片节拍':'分镜故事板'}{" "}
                  <span>
                    {project?.storyboard
                      ? `${project.storyboard.scenes.length} 个${job?.generationMode==='whole-film'?'阶段':'镜头'}`
                      : "STORYBOARD"}
                  </span>
                </div>
                {project?.storyboard ? (
                  <>
                    <div className="storyboard-list">
                      {project.storyboard.scenes.map((s, i) => (
                        <SceneCard
                          key={s.id}
                          scene={s}
                          index={i}
                          selected={selectedScene === i}
                          onSelect={() => setSelectedScene(i)}
                        />
                      ))}
                    </div>
                    {scene && (
                      <div className="scene-detail">
                        <h4>{scene.title}</h4>
                        <p>{scene.description}</p>
                        <div>
                          <span>
                            <Camera size={12} />
                            {scene.camera ? cameraNames[scene.camera]??scene.camera : '全片统一运动'}
                          </span>
                          {scene.transition && <span>{transitionNames[scene.transition]??scene.transition}</span>}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="storyboard-empty">
                    <div className="empty-frames">
                      <span />
                      <span />
                      <span />
                    </div>
                    <strong>每一个镜头，都有它的用意</strong>
                    <p>
                      AI 导演会先规划叙事与分镜，
                      <br />
                      再让每一个画面动起来。
                    </p>
                  </div>
                )}
                <div className="workflow-note">
                  <div>
                    <span className="step-dot">1</span> 创意描述 <i />
                    <span className="step-dot">2</span> 导演分镜 <i />
                    <span className="step-dot">3</span> 视频成片
                  </div>
                </div>
                <div className="export-area">
                  <div>
                    <Film size={17} />
                    <span>
                      你的下一部作品
                      <small>
                        {completed
                          ? `${completed.duration?.toFixed(1)} 秒 · 可下载`
                          : "完成后即可导出 MP4"}
                      </small>
                    </span>
                  </div>
                  {completed ? (
                    <a
                      className="export-button ready"
                      href={`/api/projects/${activeId}/video/${completed.id}?download=1`}
                    >
                      <Download size={15} /> 导出视频
                    </a>
                  ) : (
                    <button
                      className="export-button"
                      disabled
                      title="视频生成完成后即可下载"
                    >
                      <Download size={15} />{" "}
                      {rendering ? "生成完成后可导出" : "生成视频后可导出"}
                    </button>
                  )}
                </div>
                {completed?.tokenUsage && (
                  <div className="billing-result">
                    <strong>本次模型使用量</strong>
                    <span>
                      {completed.tokenUsage.totalTokens.toLocaleString()} tokens · {completed.tokenUsage.calls} 次调用
                    </span>
                      {completed.quotaUnits === 0 ? (
                        <div className="billing-result">
                          邀请码免费视频名额已使用，本次不扣积分。
                        </div>
                      ) : completed.billingEstimate?.status === "estimated" ? (
                      <span>
                        预计按 {completed.billingEstimate.model} 扣除 {completed.billingEstimate.units} 积分
                      </span>
                    ) : (
                      <small>当前模型尚未配置正式扣费系数，暂不自动按 Token 扣费。</small>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="settings">
                <h3>让画面更贴近你的想象</h3>
                <p>这些参数会应用于下一次视频创作。</p>
                <label>画面比例</label>
                <div className="aspect-options">
                  {(["16:9", "9:16", "1:1"] as const).map((a, i) => (
                    <button
                      key={a}
                      className={aspect === a ? "active" : ""}
                      onClick={() => {setAspect(a);configureProject({aspect:a});}}
                    >
                      {i === 0 ? (
                        <Monitor size={22} />
                      ) : i === 1 ? (
                        <Smartphone size={22} />
                      ) : (
                        <Square size={22} />
                      )}
                      <span>{a}</span>
                    </button>
                  ))}
                </div>
                <label>视频时长</label>
                <div className="duration-options">
                  {(workflow === 'motion-graphics' ? [3, 5, 8] : [15, 30, 60]).map((d) => (
                    <button
                      key={d}
                      className={duration === d ? "active" : ""}
                      onClick={() => {setDuration(d);configureProject({duration:d});}}
                    >
                      {d} 秒
                    </button>
                  ))}
                </div>
                <label className="audio-option">自定义秒数 <input aria-label="自定义视频秒数" type="number" min="1" max="600" value={duration} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=600){setDuration(n);configureProject({duration:n});}}} /></label>
                <label>视觉风格</label>
                <StudioSelect
                  label="视觉风格"
                  wide
                  value={style}
                  onChange={value=>{setStyle(value);configureProject({style:value});}}
                  options={[
                    {
                      value: "cinematic",
                      label: "电影感",
                      description: "叙事与氛围 · 细腻的光影和情绪",
                    },
                    {
                      value: "minimal",
                      label: "极简",
                      description: "克制与留白 · 让主体更鲜明",
                    },
                    {
                      value: "vibrant",
                      label: "活力",
                      description: "色彩与节奏 · 大胆表达创意",
                    },
                  ]}
                />
                <StudioSelect label="导出画质" wide value={exportResolution} onChange={value=>{setExportResolution(value);configureProject({exportResolution:value==='original'?null:value});}} options={[
                  {value:'original',label:'保持工程画质',description:'不改变已有工程的分辨率'},
                  {value:'720p',label:'720p',description:'轻量文件 · 由你选择降低分辨率'},
                  {value:'1080p',label:'1080p',description:'默认 · 清晰全高清'},
                  {value:'4k',label:'4K',description:'超高清 · 渲染耗时更长'},
                ]}/>
                <StudioSelect label="视频帧率" wide value={exportFps} onChange={value=>{setExportFps(value);configureProject({exportFps:value});}} options={[
                  ...(![24,30,60].includes(exportFps)?[{value:exportFps,label:`${exportFps} FPS`,description:'AI 规划的帧率'}]:[]),
                  {value:24,label:'24 FPS',description:'适合克制的电影节奏'},
                  {value:30,label:'30 FPS',description:'适合一般演示与图解'},
                  {value:60,label:'60 FPS',description:'适合细腻快速的运动'},
                ]}/>
                <label>创作类型</label>
                <StudioSelect label="本轮任务" wide value={taskMode} onChange={value=>{setTaskMode(value);configureProject({taskMode:value});}} options={[
                  {value:'auto',label:'智能处理',description:'根据你的消息讨论、研究或制作'},
                  {value:'chat',label:'先讨论',description:'正常沟通，不要求交付视频'},
                  {value:'video',label:'制作成片',description:'本轮必须完成视频并交付'},
                ]}/>
                <StudioSelect label="创作类型" wide value={workflow}
                  onChange={(value) => { setWorkflow(value); setDuration(value === 'motion-graphics' ? 5 : 30);configureProject({workflow:value,duration:value==='motion-graphics'?5:30}); }}
                  options={[{ value: 'auto', label: '自动判断', description: '按需求与素材选择，通用流程兜底' }, ...workflows.map(w => ({ value: w.id, label: w.label, description: w.description }))]} />
                <label>网站、Figma 或 PR 链接</label>
                <input className="source-url-input" type="url" aria-label="素材来源链接" placeholder="https://…" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} />
                <label>项目素材</label>
                <input type="file" multiple aria-label="上传项目素材" disabled={busy || !!rendering}
                  accept=".png,.jpg,.jpeg,.webp,.mp4,.webm,.wav,.mp3,.m4a,.srt,.vtt,.json,.tsx,.ts,.jsx,.js,.css,.txt,.md"
                  onChange={e => { void uploadAssets(e.target.files); e.target.value = ''; }} />
                <small>单文件最大 100 MB；支持图片、视频、声音、字幕和源码。</small>
                {project?.assets?.map(a => <div className="asset-row" key={a.id}>
                  <span title={a.name}>{a.name}</span>
                  <button type="button" aria-label={`删除素材 ${a.name}`} disabled={busy || !!rendering} onClick={() => void removeAsset(a.id)}><Trash2 size={14} /></button>
                </div>)}
                <label className="audio-option"><input type="checkbox" checked={narrationEnabled} disabled={!capabilities.narration} onChange={e => {setNarrationEnabled(e.target.checked);configureProject({narrationEnabled:e.target.checked});}} /> 自动配音</label>
                {job?.projectConfiguration&&<p className="composer-foot">当前工程：{job.projectConfiguration.width} × {job.projectConfiguration.height} · {job.projectConfiguration.fps} FPS · {job.projectConfiguration.duration} 秒</p>}
                <label className="audio-option">创作方式 <select aria-label="创作技术选择" value={engine} onChange={e=>{const engine=e.target.value as NonNullable<Brief['engine']>;setEngine(engine);configureProject({engine});}}><option value="auto">让 AI 选择</option><option value="browser">浏览器图形与动画</option><option value="hyperframes">Hyperframes</option><option value="remotion">Remotion</option><option value="blender">Blender 3D</option></select></label>
                <label className="audio-option">配音服务 <select aria-label="配音服务选择" value={voiceProvider} onChange={e=>{const voiceProvider=e.target.value as NonNullable<Brief['voiceProvider']>;setVoiceProvider(voiceProvider);configureProject({voiceProvider});}}><option value="auto">自动选择</option>{['gateway','kokoro','elevenlabs','edge','minimax'].map(id=><option key={id} value={id} disabled={!capabilities.voices.find(v=>v.id===id)?.configured}>{({gateway:'配音网关',kokoro:'本地 Kokoro',elevenlabs:'ElevenLabs',edge:'edge-tts',minimax:'MiniMax'} as Record<string,string>)[id]}{capabilities.voices.find(v=>v.id===id)?.configured?'':'（待配置）'}</option>)}</select></label>
                {!capabilities.narration && <small>配音服务配置后可用，也可以上传声音素材。</small>}
                <label className="audio-option"><input type="checkbox" checked={captionsEnabled} onChange={e => {setCaptionsEnabled(e.target.checked);configureProject({captionsEnabled:e.target.checked});}} /> 使用上传字幕</label>
                <label>背景音乐</label>
                <StudioSelect label="背景音乐" wide value={music} onChange={value=>{setMusic(value);configureProject({music:value});}} options={[
                  { value: 'none', label: '无背景音乐' },
                  { value: 'generated', label: '自动配乐', description: '按画面节奏编排旋律、和声与鼓点' },
                  { value: 'uploaded', label: '使用上传音乐' },
                ]} />
                <div className="settings-note">
                  <Sparkles size={19} />
                  <p>
                    DeepSeek 自主制作工程，可在对话中随时追加修改。{capabilities.mediaGeneration ? '可按需生成原创画面。' : '可导入图片或视频素材。'}{capabilities.vision ? '支持实际画面评审。' : '当前使用内容与代码检查。'}
                  </p>
                </div>
              </div>
            )}
            <footer className="preview-footer">
              Cocode Studio VideoForge
              <br />© {new Date().getFullYear()} cocode 酷码工作室
            </footer>
          </aside>}
        </div>
      </div>
      {modal === "billing" && (
        <OfficialQuotaModal
          official={usage.official}
          catalog={billing ?? {
            version: "V1.5",
            unit: "积分",
            tokenFormula: "max(50, ceil(tokens / 1000 × 模型抵扣系数))",
            minimumCharge: 50,
            packages: [],
            products: [],
            models: [],
          }}
          onClose={() => setModal(null)}
          onRefresh={refresh}
        />
      )}
      {modal && modal !== "billing" && (
        <div className="modal-backdrop" onClick={() => !busy && setModal(null)}>
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="项目操作"
            onSubmit={modalAction}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) setModal(null);
            }}
          >
            <button
              className="modal-close"
              type="button"
              aria-label="关闭"
              disabled={busy}
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            <span className="modal-icon">
              <Folder size={24} />
            </span>
            <h2>
              {modal === "delete"
                ? "删除这个项目？"
                : modal === "rename"
                  ? "给项目一个新名字"
                  : "一个新故事，从这里开始"}
            </h2>
            <p>
              {modal === "delete"
                ? `「${modalProject?.name}」中的分镜、记录和视频会一并删除。`
                : "用一个名字，把灵感收好。"}
            </p>
            {modal !== "delete" && (
              <input
                aria-label="项目名称"
                autoFocus
                placeholder="例如：我的第一支品牌短片"
                value={projectName}
                maxLength={80}
                required
                onChange={(e) => setProjectName(e.target.value)}
              />
            )}
            {error && (
              <div className="form-error" role="alert">
                <AlertCircle size={16} />
                {error}
              </div>
            )}
            <button
              className={`primary ${modal === "delete" ? "danger" : ""}`}
              disabled={busy}
            >
              {busy
                ? "处理中…"
                : modal === "delete"
                  ? "确认删除"
                  : modal === "rename"
                    ? "保存名称"
                    : "创建项目"}
              <ArrowRight size={17} />
            </button>
          </form>
        </div>
      )}
      {notice&&<div className="attention-toast" role="status" aria-live="polite"><Bell size={21}/><div><strong>{notice.title}</strong><button onClick={()=>{showAttention(notice.projectId,notice.questionId);if(!notice.questionId)setNotice(null);}}>{notice.questionId?'查看并回答':'点击查看'}</button></div><button className="attention-close" aria-label="关闭提醒" onClick={()=>setNotice(null)}><X size={16}/></button></div>}
    </div>
  );
}
export function activate(
  element: HTMLElement = document.getElementById("root")!,
) {
  const root = createRoot(element);
  root.render(<App />);
  return () => root.unmount();
}
