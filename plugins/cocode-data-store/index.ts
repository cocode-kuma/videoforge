import type { Context } from "@deepseek-ai/cordis";
import {
  randomBytes,
  randomUUID,
  scrypt as scryptCb,
  timingSafeEqual,
  createHash,
  createHmac,
} from "node:crypto";
import { isIP } from "node:net";
import { promisify } from "node:util";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  rm,
  lstat,
  open,
} from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  AppError,
  activeStatus,
  type Project,
  type User,
  type Brief,
  type QuotaSummary,
  type Workspace,
  type RenderRecord,
} from "../../shared/contracts.js";
import { readConfig, type Config } from "../../shared/config.js";
import {
  OfficialQuotaClient,
  type OfficialBalance,
} from "../../shared/official-quota.js";
import { log } from "../../shared/log.js";

const scrypt = promisify(scryptCb);
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type StoredUser = User & { salt: string; hash: string; inviteIpHash?: string };
type Session = { hash: string; userId: string; expires: number };
type QuotaWallet = {
  granted: number;
  consumed: number;
  reserved: number;
};
type QuotaReservation = {
  userId: string;
  projectId: string;
  workspaceId: string;
  units: number;
  allocations: QuotaAllocation[];
  inviteIpHash?: string;
  status: "reserved" | "committed" | "released";
  createdAt: string;
};
type QuotaAllocation = {
  source: "internal" | "official";
  units: number;
  externalUserId?: string;
  remoteReservationId?: string;
};
type QuotaLedgerEntry = {
  id: string;
  workspaceId: string;
  userId: string;
  projectId?: string;
  jobId?: string;
  source: "internal" | "official";
  type: "grant" | "reserve" | "consume" | "release";
  units: number;
  idempotencyKey: string;
  createdAt: string;
};
type StoredOfficialAccount = {
  workspaceId: string;
  externalUserId: string;
  label?: string;
  plan: string;
  availableUnits: number;
  expiresAt?: string;
  status: "active" | "expired" | "suspended";
  lastSyncedAt: string;
  connectedAt: string;
  videoCosts?: Record<string, number>;
  chatCost?: number;
  accessAllowed?: boolean;
};
type Accounts = {
  users: StoredUser[];
  sessions: Session[];
  usage?: Record<string, { attempts: number; daily: Record<string, number> }>;
  workspaces?: Workspace[];
  quotaWallets?: Record<string, QuotaWallet>;
  quotaReservations?: Record<string, QuotaReservation>;
  quotaLedger?: QuotaLedgerEntry[];
  officialAccounts?: Record<string, StoredOfficialAccount>;
  inviteIpHashKey?: string;
  inviteVideoBuckets?: Record<string, { completed: number; reserved: number }>;
};
const publicUser = ({ id, email, name, createdAt, officialId }: StoredUser): User => ({
  id,
  email,
  name,
  createdAt,
  officialId,
});
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export const quotaCost = (brief: Brief) =>
  brief.taskMode==='chat'?0:brief.duration === 15 ? 1 : brief.duration === 30 ? 2 : 4;
export class DataStore {
  private tail: Promise<unknown> = Promise.resolve();
  private officialQuota: OfficialQuotaClient;
  constructor(public config: Config) {
    this.officialQuota = new OfficialQuotaClient(config);
  }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.tail.then(fn, fn);
    this.tail = p.catch(() => {});
    return p;
  }
  private ensureWorkspace(
    accounts: Accounts,
    userId: string,
    initialCredits = this.config.initialCredits,
  ) {
    accounts.workspaces ??= [];
    let workspace = accounts.workspaces.find((w) => w.ownerId === userId);
    if (!workspace) {
      const now = new Date().toISOString();
      workspace = {
        id: randomUUID(),
        ownerId: userId,
        name: "个人工作空间",
        plan: "free",
        createdAt: now,
        updatedAt: now,
      };
      accounts.workspaces.push(workspace);
    }
    accounts.quotaWallets ??= {};
    accounts.quotaReservations ??= {};
    accounts.quotaLedger ??= [];
    accounts.officialAccounts ??= {};
    if (!accounts.quotaWallets[workspace.id]) {
      accounts.quotaWallets[workspace.id] = {
        granted: initialCredits,
        consumed: 0,
        reserved: 0,
      };
      if (initialCredits > 0)
        accounts.quotaLedger.push({
          id: randomUUID(),
          workspaceId: workspace.id,
          userId,
          source: "internal",
          type: "grant",
          units: initialCredits,
          idempotencyKey: `workspace:${workspace.id}:initial-grant`,
          createdAt: new Date().toISOString(),
        });
    }
    return workspace;
  }
  private quotaSummary(
    workspace: Workspace,
    wallet: QuotaWallet,
    official?: StoredOfficialAccount,
  ): QuotaSummary {
    const internalAvailableUnits = this.config.officialAccountsOnly ? 0 : Math.max(
      0,
      wallet.granted - wallet.consumed - wallet.reserved,
    );
    return {
      workspaceId: workspace.id,
      plan: workspace.plan,
      grantedUnits: wallet.granted,
      consumedUnits: wallet.consumed,
      reservedUnits: wallet.reserved,
      internalAvailableUnits,
      availableUnits: internalAvailableUnits + (official?.availableUnits ?? 0),
      official: official
        ? {
            connected: true,
            managed: this.config.officialAccountsOnly,
            videoCosts: official.videoCosts,
            chatCost: official.chatCost,
            externalUserId: official.externalUserId,
            label: official.label,
            plan: official.plan,
            availableUnits: official.availableUnits,
            expiresAt: official.expiresAt,
            status: official.status,
            lastSyncedAt: official.lastSyncedAt,
          }
        : {
            connected: false,
            availableUnits: 0,
            status: "unavailable",
          },
    };
  }
  private addLedger(
    accounts: Accounts,
    entry: Omit<QuotaLedgerEntry, "id" | "createdAt">,
  ) {
    accounts.quotaLedger!.push({
      ...entry,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    });
  }
  async init() {
    await this.safeDir(this.config.dataRoot);
    try {
      await this.accounts();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      await this.atomic(join(this.config.dataRoot, "users.json"), {
        users: [],
        sessions: [],
      });
    }
    const accounts = await this.accounts();
    accounts.inviteIpHashKey ??= randomBytes(32).toString("hex");
    accounts.inviteVideoBuckets ??= {};
    for (const user of accounts.users) this.ensureWorkspace(accounts, user.id);
    await this.atomic(join(this.config.dataRoot, "users.json"), accounts);
    // In-flight work is never silently duplicated after a restart.
    for (const user of (await this.accounts()).users)
      for (const project of await this.listProjects(user.id)) {
        const activeJobs = project.renders.filter((r) => activeStatus(r.status));
        if (activeJobs.length) {
          await this.updateProject(user.id, project.id, (p) => {
            for (const r of p.renders)
              if (activeStatus(r.status))
                Object.assign(r, {
                  status: "failed",
                  message: r.generationMode==='harness'?"服务重启，工程已保存，可以继续创作。":"服务重启，任务已中断，请重新生成。",
                  error: "服务重启",
                  completedAt: new Date().toISOString(),
                });
          });
          for (const job of activeJobs)
            await this.releaseQuota(user.id, project.id, job.id);
        }
      }
  }
  private async safeDir(path: string) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    if ((await lstat(path)).isSymbolicLink())
      throw new AppError(400, "不允许符号链接目录");
  }
  private validate(...ids: string[]) {
    if (ids.some((id) => !uuid.test(id))) throw new AppError(404, "项目不存在");
  }
  async projectDir(userId: string, projectId: string) {
    this.validate(userId, projectId);
    const userDir = join(this.config.dataRoot, userId),
      dir = join(userDir, projectId);
    for (const p of [userDir, dir]) {
      const stat = await lstat(p).catch(() => null);
      if (!stat || stat.isSymbolicLink() || !stat.isDirectory())
        throw new AppError(404, "项目不存在");
    }
    return dir;
  }
  async artifact(userId: string, projectId: string, relative: string) {
    const dir = await this.projectDir(userId, projectId);
    const path = resolve(dir, relative);
    if (!path.startsWith(dir + sep)) throw new AppError(404, "文件不存在");
    let current = dir;
    for (const part of path.slice(dir.length + 1).split(sep)) {
      current = join(current, part);
      const s = await lstat(current).catch(() => null);
      if (!s || s.isSymbolicLink()) throw new AppError(404, "文件不存在");
    }
    return path;
  }
  private async atomic(path: string, value: unknown) {
    const existing = await lstat(path).catch(() => null);
    if (existing?.isSymbolicLink())
      throw new AppError(400, "不允许符号链接文件");
    const tmp = path + "." + randomUUID() + ".tmp";
    try {
      const f = await open(tmp, "wx", 0o600);
      try {
        await f.writeFile(JSON.stringify(value, null, 2));
        await f.sync();
      } finally {
        await f.close();
      }
      // Windows Defender/indexers can briefly hold the destination between
      // the close and rename. Keep the write atomic while tolerating that
      // transient sharing violation instead of failing an otherwise valid job.
      let renamed = false;
      for (let attempt = 0; attempt < 8 && !renamed; attempt++) {
        try {
          await rename(tmp, path);
          renamed = true;
        } catch (e) {
          const code = (e as NodeJS.ErrnoException).code;
          if (code !== "EPERM" && code !== "EBUSY") throw e;
          await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
        }
      }
      if (!renamed) throw new Error(`无法原子替换数据文件: ${path}`);
    } finally {
      await rm(tmp, { force: true });
    }
  }
  private async accounts(): Promise<Accounts> {
    const file = join(this.config.dataRoot, "users.json");
    if ((await lstat(file)).isSymbolicLink())
      throw new Error("用户数据不能是符号链接");
    return JSON.parse(await readFile(file, "utf8"));
  }
  private inviteIpHash(accounts: Accounts, invitationCode: string, ip: string) {
    if (!this.config.inviteCode)
      throw new AppError(403, "暂未开放新账号注册");
    if (invitationCode.trim().toLowerCase() !== this.config.inviteCode.toLowerCase())
      throw new AppError(403, "邀请码无效，请检查后重试");
    let address = ip.trim().toLowerCase();
    if (address.startsWith("::ffff:")) address = address.slice(7);
    if (!address || !isIP(address))
      throw new AppError(400, "无法确认注册 IP，请检查网络后重试");
    if (isIP(address) === 6)
      address = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    const key = accounts.inviteIpHashKey;
    if (!key) throw new AppError(503, "注册服务尚未初始化，请联系管理员");
    return createHmac("sha256", key).update(address).digest("hex");
  }
  async register(email: string, password: string, name: string, invitationCode: string, ip: string) {
    const salt = randomBytes(16).toString("hex");
    const hash = ((await scrypt(password, salt, 64)) as Buffer).toString("hex");
    return this.exclusive(async () => {
      const a = await this.accounts();
      email = email.trim().toLowerCase();
      if (a.users.some((u) => u.email === email))
        throw new AppError(409, "该邮箱已注册，请登录");
      const inviteIpHash = this.inviteIpHash(a, invitationCode, ip);
      const u: StoredUser = {
        id: randomUUID(),
        email,
        name,
        salt,
        hash,
        inviteIpHash,
        createdAt: new Date().toISOString(),
      };
      a.users.push(u);
      this.ensureWorkspace(a, u.id, 0);
      await this.atomic(join(this.config.dataRoot, "users.json"), a);
      return publicUser(u);
    });
  }
  async login(email: string, password: string) {
    const u = (await this.accounts()).users.find(
      (u) => u.email === email.trim().toLowerCase(),
    );
    const hash = (await scrypt(
      password,
      u?.salt ?? "cocode-dummy-salt",
      64,
    )) as Buffer;
    if (!u || !timingSafeEqual(hash, Buffer.from(u.hash, "hex")))
      throw new AppError(401, "邮箱或密码不正确");
    return publicUser(u);
  }
  async getUser(userId: string): Promise<User> {
    const account = (await this.accounts()).users.find((u) => u.id === userId);
    if (!account) throw new AppError(404, "用户不存在");
    return publicUser(account);
  }
  async loginOfficial(profile: {
    id: string;
    email: string;
    nickname?: string;
  }, invitationCode = "", ip = "") {
    return this.exclusive(async () => {
      const accounts = await this.accounts();
      const email = profile.email.trim().toLowerCase();
      let account = accounts.users.find((u) => u.officialId === profile.id);
      if (!account) account = accounts.users.find((u) => u.email === email);
      if (account) {
        account.officialId = profile.id;
        if (!account.email && email) account.email = email;
        if (profile.nickname?.trim()) account.name = profile.nickname.trim().slice(0, 40);
      } else {
        const inviteIpHash = this.config.officialAccountsOnly ? undefined : this.inviteIpHash(accounts, invitationCode, ip);
        const salt = randomBytes(16).toString("hex");
        const hash = ((await scrypt(randomUUID(), salt, 64)) as Buffer).toString("hex");
        account = {
          id: randomUUID(),
          email,
          name: profile.nickname?.trim().slice(0, 40) || email.split("@")[0] || "酷码用户",
          officialId: profile.id,
          salt,
          hash,
          inviteIpHash,
          createdAt: new Date().toISOString(),
        };
        accounts.users.push(account);
      }
      this.ensureWorkspace(accounts, account.id, this.config.officialAccountsOnly || account.inviteIpHash ? 0 : undefined);
      await this.atomic(join(this.config.dataRoot, "users.json"), accounts);
      return publicUser(account);
    });
  }
  async newSession(userId: string) {
    return this.exclusive(async () => {
      const a = await this.accounts(),
        token = randomBytes(32).toString("hex");
      a.sessions = a.sessions.filter((s) => s.expires > Date.now());
      // Limit live sessions per account without storing bearer tokens.
      const own = a.sessions.filter((s) => s.userId === userId);
      if (own.length >= 10)
        a.sessions = a.sessions.filter((s) => s.hash !== own[0].hash);
      a.sessions.push({
        hash: digest(token),
        userId,
        expires: Date.now() + 7 * 86400000,
      });
      await this.atomic(join(this.config.dataRoot, "users.json"), a);
      return token;
    });
  }
  async authenticate(token: string | undefined) {
    if (!token || !/^[a-f0-9]{64}$/.test(token))
      throw new AppError(401, "请先登录");
    const a = await this.accounts(),
      s = a.sessions.find(
        (s) => s.hash === digest(token) && s.expires > Date.now(),
      );
    const u = s && a.users.find((u) => u.id === s.userId);
    if (!u) throw new AppError(401, "登录已过期，请重新登录");
    if (this.config.officialAccountsOnly && !u.officialId) throw new AppError(401, "请使用官网账号重新登录");
    return publicUser(u);
  }
  async logout(token: string) {
    await this.exclusive(async () => {
      const a = await this.accounts();
      a.sessions = a.sessions.filter((s) => s.hash !== digest(token));
      await this.atomic(join(this.config.dataRoot, "users.json"), a);
    });
  }
  async createProject(userId: string, projectName: string) {
    this.validate(userId);
    return this.exclusive(async () => {
      const accounts = await this.accounts();
      if (!accounts.users.some((u) => u.id === userId))
        throw new AppError(401, "用户不存在");
      const workspace = this.ensureWorkspace(accounts, userId);
      if ((await this.listProjects(userId)).length >= this.config.projectLimit)
        throw new AppError(409, "项目数量已达上限，请先删除旧项目");
      const now = new Date().toISOString();
      const p: Project = {
        id: randomUUID(),
        userId,
        workspaceId: workspace.id,
        name: projectName.trim().slice(0, 80) || "未命名视频",
        createdAt: now,
        updatedAt: now,
        messages: [],
        renders: [],
      };
      await this.safeDir(join(this.config.dataRoot, userId));
      await this.safeDir(join(this.config.dataRoot, userId, p.id));
      await this.atomic(join(this.config.dataRoot, "users.json"), accounts);
      await this.atomic(
        join(this.config.dataRoot, userId, p.id, "project.json"),
        p,
      );
      return p;
    });
  }
  async loadProject(userId: string, projectId: string): Promise<Project> {
    const file = await this.artifact(userId, projectId, "project.json");
    const p: Project = JSON.parse(await readFile(file, "utf8"));
    if (p.userId !== userId || p.id !== projectId)
      throw new AppError(404, "项目不存在");
    if (!p.workspaceId) {
      const accounts = await this.accounts();
      p.workspaceId = this.ensureWorkspace(accounts, userId).id;
      await this.atomic(join(await this.projectDir(userId, projectId), "project.json"), p);
      await this.atomic(join(this.config.dataRoot, "users.json"), accounts);
    }
    return p;
  }
  async saveProject(userId: string, projectId: string, data: Project) {
    return this.updateProject(userId, projectId, (p) => {
      if (data.userId !== userId || data.id !== projectId)
        throw new AppError(403, "项目归属不可修改");
      const createdAt = p.createdAt;
      Object.assign(p, data, { createdAt });
    });
  }
  async updateProject(
    userId: string,
    projectId: string,
    update: (p: Project) => void,
  ) {
    return this.exclusive(async () => {
      const p = await this.loadProject(userId, projectId);
      update(p);
      p.updatedAt = new Date().toISOString();
      await this.atomic(
        join(await this.projectDir(userId, projectId), "project.json"),
        p,
      );
      return p;
    });
  }
  async listProjects(userId: string): Promise<Project[]> {
    this.validate(userId);
    const dir = join(this.config.dataRoot, userId);
    const stat = await lstat(dir).catch(() => null);
    if (!stat) return [];
    if (stat.isSymbolicLink()) throw new AppError(403, "非法用户目录");
    const ids = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && uuid.test(e.name))
      .map((e) => e.name);
    const projects = await Promise.all(
      ids.map((id) => this.loadProject(userId, id)),
    );
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async deleteProject(userId: string, projectId: string) {
    return this.exclusive(async () => {
      const p = await this.loadProject(userId, projectId);
      if (p.renders.some((r) => activeStatus(r.status)))
        throw new AppError(409, "请等待当前生成任务完成后删除");
      const dir = await this.projectDir(userId, projectId);
      if (!resolve(dir).startsWith(resolve(this.config.dataRoot, userId) + sep))
        throw new AppError(403, "非法项目目录");
      await rm(dir, { recursive: true, force: true });
    });
  }
  async quota(userId: string): Promise<QuotaSummary> {
    const accounts = await this.accounts();
    const workspace = this.ensureWorkspace(accounts, userId);
    return this.quotaSummary(
      workspace,
      accounts.quotaWallets![workspace.id],
      accounts.officialAccounts?.[workspace.id],
    );
  }
  async connectOfficialIdentity(userId: string) {
    const identity = await this.getUser(userId);
    if (!identity.officialId) throw new AppError(403, "请先使用官网账号登录");
    const balance = await this.officialQuota.sync(identity.officialId);
    if (balance.externalUserId !== identity.officialId) throw new AppError(502, "官网积分账户标识不匹配");
    if (balance.status !== 'active' || balance.accessAllowed === false) throw new AppError(403, "账号不可用，或此项目需要 VIP 身份");
    return this.exclusive(async () => {
      const accounts = await this.accounts();
      const workspace = this.ensureWorkspace(accounts, userId, 0);
      const existing = accounts.officialAccounts![workspace.id];
      if (existing && existing.externalUserId !== identity.officialId) throw new AppError(409, "请先处理旧的官网积分绑定");
      const connected: StoredOfficialAccount = existing ?? {workspaceId:workspace.id,externalUserId:identity.officialId,plan:balance.plan,availableUnits:0,status:'active',lastSyncedAt:'',connectedAt:new Date().toISOString()};
      this.updateOfficialAccount(connected, balance);
      accounts.officialAccounts![workspace.id] = connected;
      await this.atomic(join(this.config.dataRoot, 'users.json'), accounts);
      return this.quotaSummary(workspace, accounts.quotaWallets![workspace.id], connected);
    });
  }
  async bindOfficial(
    userId: string,
    accountRef: string,
    bindingCode: string,
  ) {
    const balance = await this.officialQuota.bind(accountRef, bindingCode);
    return this.exclusive(async () => {
      const accounts = await this.accounts();
      const workspace = this.ensureWorkspace(accounts, userId);
      const now = new Date().toISOString();
      const connected: StoredOfficialAccount = {
        workspaceId: workspace.id,
        externalUserId: balance.externalUserId,
        label: balance.label,
        plan: balance.plan,
        availableUnits: balance.availableUnits,
        expiresAt: balance.expiresAt ?? undefined,
        status: balance.status ?? "active",
        lastSyncedAt: now,
        connectedAt: now,
      };
      accounts.officialAccounts![workspace.id] = connected;
      await this.atomic(join(this.config.dataRoot, "users.json"), accounts);
      return this.quotaSummary(
        workspace,
        accounts.quotaWallets![workspace.id],
        connected,
      );
    });
  }
  async syncOfficial(userId: string) {
    const accounts = await this.accounts();
    const workspace = this.ensureWorkspace(accounts, userId);
    const current = accounts.officialAccounts?.[workspace.id];
    if (!current) throw new AppError(404, "尚未绑定官网账号");
    const balance = await this.officialQuota.sync(current.externalUserId);
    return this.exclusive(async () => {
      const latest = await this.accounts();
      const currentWorkspace = this.ensureWorkspace(latest, userId);
      const connected = latest.officialAccounts?.[currentWorkspace.id];
      if (!connected || connected.externalUserId !== current.externalUserId)
        throw new AppError(409, "官网账号绑定状态已变化，请刷新后重试");
      this.updateOfficialAccount(connected, balance);
      await this.atomic(join(this.config.dataRoot, "users.json"), latest);
      return this.quotaSummary(
        currentWorkspace,
        latest.quotaWallets![currentWorkspace.id],
        connected,
      );
    });
  }
  async disconnectOfficial(userId: string) {
    return this.exclusive(async () => {
      const accounts = await this.accounts();
      const workspace = this.ensureWorkspace(accounts, userId);
      const hasRemoteReservation = Object.values(accounts.quotaReservations ?? {}).some(
        (reservation) =>
          reservation.userId === userId &&
          reservation.workspaceId === workspace.id &&
          reservation.status === "reserved" &&
          reservation.allocations?.some((allocation) => allocation.source === "official"),
      );
      if (hasRemoteReservation)
        throw new AppError(409, "当前有任务正在使用官网额度，请稍候再解绑");
      delete accounts.officialAccounts![workspace.id];
      await this.atomic(join(this.config.dataRoot, "users.json"), accounts);
      return this.quotaSummary(
        workspace,
        accounts.quotaWallets![workspace.id],
      );
    });
  }
  private updateOfficialAccount(
    account: StoredOfficialAccount,
    balance: OfficialBalance,
  ) {
    account.externalUserId = balance.externalUserId;
    account.label = balance.label;
    account.plan = balance.plan;
    account.availableUnits = balance.availableUnits;
    account.expiresAt = balance.expiresAt ?? undefined;
    account.status = balance.status ?? "active";
    account.lastSyncedAt = new Date().toISOString();
    account.videoCosts = balance.videoCosts;
    account.chatCost = balance.chatCost;
    account.accessAllowed = balance.accessAllowed;
  }
  async commitQuota(userId: string, projectId: string, jobId: string) {
    return this.exclusive(async () => {
      const accounts = await this.accounts();
      const reservation = accounts.quotaReservations?.[jobId];
      if (!reservation || reservation.userId !== userId || reservation.projectId !== projectId)
        return;
      if (reservation.status !== "reserved") return;
      if (reservation.inviteIpHash) {
        const bucket = accounts.inviteVideoBuckets?.[reservation.inviteIpHash];
        if (!bucket || bucket.reserved < 1)
          throw new AppError(500, "邀请码免费视频预占状态异常，请联系管理员");
        bucket.reserved -= 1;
        bucket.completed += 1;
        reservation.status = "committed";
        await this.atomic(join(this.config.dataRoot, "users.json"), accounts);
        return;
      }
      const wallet = accounts.quotaWallets![reservation.workspaceId];
      const allocations = reservation.allocations ?? [
        { source: "internal" as const, units: reservation.units },
      ];
      const internalUnits = allocations
        .filter((a) => a.source === "internal")
        .reduce((sum, a) => sum + a.units, 0);
      if (!wallet || wallet.reserved < internalUnits)
        throw new AppError(500, "额度预占状态异常，请联系管理员");
      for (const allocation of allocations)
        if (allocation.source === "official") {
          const official = accounts.officialAccounts?.[reservation.workspaceId];
          if (!official || !allocation.externalUserId || !allocation.remoteReservationId)
            throw new AppError(500, "官网额度预占记录缺失，请联系管理员");
          const balance = await this.officialQuota.consume(
            allocation.externalUserId,
            allocation.remoteReservationId,
          );
          this.updateOfficialAccount(official, balance);
        }
      wallet.reserved -= internalUnits;
      wallet.consumed += internalUnits;
      reservation.status = "committed";
      for (const allocation of allocations)
        this.addLedger(accounts, {
          workspaceId: reservation.workspaceId,
          userId,
          projectId,
          jobId,
          source: allocation.source,
          type: "consume",
          units: allocation.units,
          idempotencyKey: `consume:${jobId}:${allocation.source}`,
        });
      await this.atomic(join(this.config.dataRoot, "users.json"), accounts);
    });
  }
  async releaseQuota(userId: string, projectId: string, jobId: string) {
    return this.exclusive(async () => {
      const accounts = await this.accounts();
      const reservation = accounts.quotaReservations?.[jobId];
      if (!reservation || reservation.userId !== userId || reservation.projectId !== projectId)
        return;
      if (reservation.status !== "reserved") return;
      if (reservation.inviteIpHash) {
        const bucket = accounts.inviteVideoBuckets?.[reservation.inviteIpHash];
        if (!bucket || bucket.reserved < 1)
          throw new AppError(500, "邀请码免费视频预占状态异常，请联系管理员");
        bucket.reserved -= 1;
        reservation.status = "released";
        await this.atomic(join(this.config.dataRoot, "users.json"), accounts);
        return;
      }
      const wallet = accounts.quotaWallets![reservation.workspaceId];
      const allocations = reservation.allocations ?? [
        { source: "internal" as const, units: reservation.units },
      ];
      const internalUnits = allocations
        .filter((a) => a.source === "internal")
        .reduce((sum, a) => sum + a.units, 0);
      if (!wallet || wallet.reserved < internalUnits)
        throw new AppError(500, "额度预占状态异常，请联系管理员");
      for (const allocation of allocations)
        if (allocation.source === "official") {
          const official = accounts.officialAccounts?.[reservation.workspaceId];
          if (!official || !allocation.externalUserId || !allocation.remoteReservationId)
            throw new AppError(500, "官网额度预占记录缺失，请联系管理员");
          const balance = await this.officialQuota.release(
            allocation.externalUserId,
            allocation.remoteReservationId,
          );
          this.updateOfficialAccount(official, balance);
        }
      wallet.reserved -= internalUnits;
      reservation.status = "released";
      for (const allocation of allocations)
        this.addLedger(accounts, {
          workspaceId: reservation.workspaceId,
          userId,
          projectId,
          jobId,
          source: allocation.source,
          type: "release",
          units: allocation.units,
          idempotencyKey: `release:${jobId}:${allocation.source}`,
        });
      await this.atomic(join(this.config.dataRoot, "users.json"), accounts);
    });
  }
  async enqueue(userId: string, projectId: string, brief: Brief) {
    if (this.config.officialAccountsOnly) await this.connectOfficialIdentity(userId);
    return this.exclusive(async () => {
      const p = await this.loadProject(userId, projectId);
      if (p.renders.some((r) => activeStatus(r.status)))
        throw new AppError(409, "当前对话正在执行，可以继续发消息，也可以新建对话处理其他任务");
      const accounts = await this.accounts();
      const workspace = this.ensureWorkspace(accounts, userId);
      const wallet = accounts.quotaWallets![workspace.id];
      const storedUser = accounts.users.find((u) => u.id === userId);
      const inviteIpHash = storedUser?.inviteIpHash;
      accounts.inviteVideoBuckets ??= {};
      const inviteBucket = inviteIpHash
        ? (accounts.inviteVideoBuckets[inviteIpHash] ??= {
            completed: 0,
            reserved: 0,
          })
        : undefined;
      const useInviteVideo = Boolean(
        !this.config.officialAccountsOnly && brief.taskMode!=='chat' && inviteBucket &&
          inviteBucket.completed + inviteBucket.reserved <
            this.config.inviteFreeVideosPerIp,
      );
      const policy = accounts.officialAccounts?.[workspace.id];
      const officialPrice = brief.taskMode === 'chat' ? policy?.chatCost : policy?.videoCosts?.[String(brief.duration)] ?? policy?.videoCosts?.other;
      if (this.config.officialAccountsOnly && officialPrice === undefined) throw new AppError(503, "官网尚未设置任务积分规则");
      const units = useInviteVideo ? 0 : this.config.officialAccountsOnly ? officialPrice! : quotaCost(brief);
      const internalAvailable = this.config.officialAccountsOnly ? 0 : Math.max(
        0,
        wallet.granted - wallet.consumed - wallet.reserved,
      );
      const jobId = randomUUID();
      const official = accounts.officialAccounts?.[workspace.id];
      const remoteUnits = useInviteVideo ? 0 :
        official?.status === "active"
          ? Math.min(units, Math.floor(official.availableUnits))
          : 0;
      let officialUnits = 0;
      let internalUnits = units;
      let remoteReservationId: string | undefined;
      if (useInviteVideo) inviteBucket!.reserved += 1;
      if (official && remoteUnits > 0) {
        try {
          const remote = await this.officialQuota.reserve(
            official.externalUserId,
            remoteUnits,
            `reserve:${jobId}`,
          );
          if (remote.reservedUnits !== remoteUnits)
            throw new AppError(502, "官网额度服务未完整预占本次额度");
          officialUnits = remote.reservedUnits;
          internalUnits = units - officialUnits;
          remoteReservationId = remote.reservationId;
          official.availableUnits = remote.availableUnits;
          official.lastSyncedAt = new Date().toISOString();
        } catch (error) {
          if (
            !(error instanceof AppError) ||
            ![409, 503].includes(error.status)
          )
            throw error;
        }
      }
      if (internalAvailable < internalUnits) {
        if (remoteReservationId && official) {
          const released = await this.officialQuota.release(
            official.externalUserId,
            remoteReservationId,
          );
          official.availableUnits = released.availableUnits;
          official.lastSyncedAt = new Date().toISOString();
        }
        const combinedAvailable = internalAvailable + (official?.availableUnits ?? 0);
        throw new AppError(
          402,
          `额度不足，本次需要 ${units} 积分，当前可用 ${combinedAvailable} 积分`,
        );
      }
      const createdAt = new Date().toISOString();
      wallet.reserved += internalUnits;
      const allocations: QuotaAllocation[] = [];
      if (internalUnits > 0) allocations.push({ source: "internal", units: internalUnits });
      if (officialUnits > 0 && official)
        allocations.push({
          source: "official",
          units: officialUnits,
          externalUserId: official.externalUserId,
          remoteReservationId,
        });
      accounts.quotaReservations![jobId] = {
        userId,
        projectId,
        workspaceId: workspace.id,
        units,
        allocations,
        ...(useInviteVideo && inviteIpHash ? { inviteIpHash } : {}),
        status: "reserved",
        createdAt,
      };
      for (const allocation of allocations)
        this.addLedger(accounts, {
          workspaceId: workspace.id,
          userId,
          projectId,
          jobId,
          source: allocation.source,
          type: "reserve",
          units: allocation.units,
          idempotencyKey: `reserve:${jobId}:${allocation.source}`,
        });
      const job: RenderRecord = {
        id: jobId,
        status: "queued",
        progress: 0,
        message: useInviteVideo
          ? `已使用邀请码免费视频名额（本 IP 已完成 ${inviteBucket!.completed}/${this.config.inviteFreeVideosPerIp} 次）`
          : "已加入渲染队列",
        quotaUnits: units,
        createdAt,
      };
      p.brief = brief;
      p.renders.push(job);
      p.messages.push({
        id: randomUUID(),
        role: "user",
        text: brief.prompt,
        createdAt: job.createdAt,
      });
      p.updatedAt = job.createdAt;
      await this.atomic(
        join(await this.projectDir(userId, projectId), "project.json"),
        p,
      );
      await this.atomic(join(this.config.dataRoot, "users.json"), accounts);
      return job;
    });
  }
  async usage(userId: string) {
    const renders = (await this.listProjects(userId)).flatMap((p) => p.renders);
    const accounts = await this.accounts();
    const meter = accounts.usage?.[userId];
    const quota = await this.quota(userId);
    const inviteIpHash = accounts.users.find((u) => u.id === userId)?.inviteIpHash;
    const inviteBucket = inviteIpHash
      ? accounts.inviteVideoBuckets?.[inviteIpHash]
      : undefined;
    return {
      generated: renders.filter((r) => r.status === "completed").length,
      attempts: meter?.attempts ?? 0,
      today: meter?.daily[new Date().toISOString().slice(0, 10)] ?? 0,
      dailyLimit: this.config.dailyLimit,
      invitePromo: inviteIpHash
        ? {
            limit: this.config.inviteFreeVideosPerIp,
            completed: inviteBucket?.completed ?? 0,
            reserved: inviteBucket?.reserved ?? 0,
            remaining: Math.max(
              0,
              this.config.inviteFreeVideosPerIp -
                (inviteBucket?.completed ?? 0) -
                (inviteBucket?.reserved ?? 0),
            ),
          }
        : undefined,
      ...quota,
    };
  }
}
declare module "@deepseek-ai/cordis" {
  interface Context {
    cocodeDataStore: DataStore;
  }
}
export const name = "cocode-data-store";
export const inject: string[] = [];
export async function apply(ctx: Context) {
  const store = new DataStore(readConfig());
  await store.init();
  ctx.provide("cocodeDataStore", store);
  await log(store.config.logsRoot, "独立数据服务已就绪");
}
