import { z } from "zod";
import { AppError } from "./contracts.js";
import type { Config } from "./config.js";

const tokenSchema = z.object({
  ok: z.boolean().optional(),
  access_token: z.string().trim().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
});
const userSchema = z.object({
  ok: z.boolean().optional(),
  user: z.object({
    id: z.union([z.string(), z.number()]),
    email: z.string().email(),
    nickname: z.string().optional(),
    avatar: z.string().nullish(),
    is_vip: z.boolean().optional(),
    is_developer: z.boolean().optional(),
  }),
});
const providerErrorCodeSchema = z.enum([
  "missing_token",
  "invalid_token",
  "invalid_client",
  "invalid_grant",
  "redirect_mismatch",
  "unknown_client",
]);
const providerErrorSchema = z.object({
  error: providerErrorCodeSchema.optional(),
  code: providerErrorCodeSchema.optional(),
});

export type OfficialUserProfile = z.infer<typeof userSchema>["user"];

export class OfficialSsoClient {
  constructor(private readonly config: Config) {}

  private get baseUrl() {
    return this.config.officialSsoIssuer.replace(/\/$/, "");
  }

  get configured() {
    return Boolean(
      this.baseUrl &&
        this.config.officialSsoClientId &&
        this.config.officialSsoClientSecret &&
        this.config.officialSsoRedirectUri,
    );
  }

  private async readJson(response: Response) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AppError(502, "酷码账号服务返回了无效响应");
    }
    if (!response.ok) {
      const providerError = providerErrorSchema.safeParse(payload);
      const code = providerError.success
        ? providerError.data.error ?? providerError.data.code
        : undefined;
      throw new AppError(
        502,
        `酷码账号服务返回错误（${response.status}${code ? `：${code}` : ""}）`,
      );
    }
    return payload;
  }

  async getAuthorizeUrl(state: string) {
    if (!this.configured) throw new AppError(503, "酷码 SSO 尚未配置完成");
    const url = new URL(`${this.baseUrl}/api/authorize-url.php`);
    url.searchParams.set("client_id", this.config.officialSsoClientId);
    url.searchParams.set("redirect_uri", this.config.officialSsoRedirectUri);
    url.searchParams.set("state", state);
    const payload = await this.readJson(
      await fetch(url, { signal: AbortSignal.timeout(this.config.officialQuotaTimeout) }),
    );
    const parsed = z.object({ ok: z.boolean().optional(), authorize_url: z.string().url() }).safeParse(payload);
    if (!parsed.success) throw new AppError(502, "酷码授权地址响应格式不符合约定");
    return parsed.data.authorize_url;
  }

  async exchangeCode(code: string) {
    if (!this.configured) throw new AppError(503, "酷码 SSO 尚未配置完成");
    const body = new URLSearchParams({
      code,
      client_id: this.config.officialSsoClientId,
      client_secret: this.config.officialSsoClientSecret,
      redirect_uri: this.config.officialSsoRedirectUri,
    });
    const response = await fetch(`${this.baseUrl}/api/token.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(this.config.officialQuotaTimeout),
    });
    const parsed = tokenSchema.safeParse(await this.readJson(response));
    if (!parsed.success) throw new AppError(502, "酷码令牌响应格式不符合约定");
    return parsed.data;
  }

  async userInfo(accessToken: string) {
    const response = await fetch(`${this.baseUrl}/api/userinfo.php`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(this.config.officialQuotaTimeout),
    });
    const parsed = userSchema.safeParse(await this.readJson(response));
    if (!parsed.success) throw new AppError(502, "酷码用户信息响应格式不符合约定");
    return parsed.data.user;
  }
}
