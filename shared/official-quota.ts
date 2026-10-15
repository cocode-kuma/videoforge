import { z } from "zod";
import { AppError } from "./contracts.js";
import type { Config } from "./config.js";

const balanceSchema = z.object({
  accessAllowed: z.boolean().optional(),
  isVip: z.boolean().optional(),
  videoCosts: z.record(z.string(), z.number().int().min(0).max(100000000)).optional(),
  chatCost: z.number().int().min(0).max(100000000).optional(),
  externalUserId: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(120).optional(),
  plan: z.string().trim().min(1).max(40),
  availableUnits: z.number().finite().nonnegative(),
  expiresAt: z.string().trim().min(1).optional().nullable(),
  status: z.enum(["active", "expired", "suspended"]).optional().default("active"),
});
const reservationSchema = z.object({
  reservationId: z.string().trim().min(1).max(200),
  externalUserId: z.string().trim().min(1).max(200),
  availableUnits: z.number().finite().nonnegative(),
  reservedUnits: z.number().finite().positive(),
});

export type OfficialBalance = z.infer<typeof balanceSchema>;
export type OfficialReservation = z.infer<typeof reservationSchema>;

/**
 * Adapter for the official membership service.
 *
 * The official service should expose:
 * POST /v1/quota/bind { accountRef, bindingCode }
 * POST /v1/quota/sync { externalUserId }
 * POST /v1/quota/reserve { externalUserId, units, idempotencyKey }
 * POST /v1/quota/consume { externalUserId, reservationId }
 * POST /v1/quota/release { externalUserId, reservationId }
 * Bind/sync/consume/release return OfficialBalance. Reserve returns
 * OfficialReservation. The binding code is one-time and is
 * never persisted by VideoForge; only the returned external account identity
 * and read-only balance snapshot are stored locally.
 */
export class OfficialQuotaClient {
  constructor(private readonly config: Config) {}

  private get baseUrl() {
    return this.config.officialQuotaApiUrl.replace(/\/$/, "");
  }

  private async request<T>(
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    if (!this.baseUrl)
      throw new AppError(503, "官网额度接口尚未配置，请联系管理员");
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.config.officialQuotaTimeout,
    );
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      if (this.config.officialQuotaApiKey)
        headers.Authorization = `Bearer ${this.config.officialQuotaApiKey}`;
      const endpoint = this.baseUrl.includes('.php') ? new URL(this.baseUrl) : undefined;
      if (endpoint) endpoint.searchParams.set('action', path.split('/').pop()!);
      const response = await fetch(endpoint ?? this.baseUrl + path, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 403) throw new AppError(403, "此项目仅限官网 VIP 使用，请先开通 VIP");
        const status = response.status === 409 || response.status === 422 ? 409 : 502;
        throw new AppError(status, `官网额度服务返回错误（${response.status}）`);
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new AppError(502, "官网额度服务返回了无效响应");
      }
      const parsed = schema.safeParse(payload);
      if (!parsed.success)
        throw new AppError(502, "官网额度服务响应格式不符合约定");
      return parsed.data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if ((error as Error)?.name === "AbortError")
        throw new AppError(504, "官网额度服务响应超时");
      throw new AppError(502, "暂时无法连接官网额度服务");
    } finally {
      clearTimeout(timer);
    }
  }

  bind(accountRef: string, bindingCode: string) {
    return this.request("/v1/quota/bind", { accountRef, bindingCode }, balanceSchema);
  }

  sync(externalUserId: string) {
    return this.request("/v1/quota/sync", { externalUserId }, balanceSchema);
  }

  reserve(externalUserId: string, units: number, idempotencyKey: string) {
    return this.request(
      "/v1/quota/reserve",
      { externalUserId, units, idempotencyKey },
      reservationSchema,
    );
  }

  consume(externalUserId: string, reservationId: string) {
    return this.request(
      "/v1/quota/consume",
      { externalUserId, reservationId },
      balanceSchema,
    );
  }

  release(externalUserId: string, reservationId: string) {
    return this.request(
      "/v1/quota/release",
      { externalUserId, reservationId },
      balanceSchema,
    );
  }
}
