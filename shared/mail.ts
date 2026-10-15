import { z } from "zod";
import { AppError } from "./contracts.js";
import type { Config } from "./config.js";

const address = z.email().max(254);
const responseSchema = z.unknown();

export type MailMessage = {
  to: string[];
  subject: string;
  text: string;
  replyTo?: string;
};

export type MailSendResult = {
  accepted: boolean;
  status: number | null;
  response?: unknown;
  reason?: "not-configured";
};

/** Server-side client for the administrator-provided mail relay. */
export class MailRelayClient {
  constructor(private readonly config: Config) {}

  get configured() {
    return Boolean(
      this.config.mailApiUrl && this.config.mailApiKey && this.config.mailFrom,
    );
  }

  async send(message: MailMessage): Promise<MailSendResult> {
    if (!this.config.mailApiUrl || !this.config.mailApiKey || !this.config.mailFrom)
      return { accepted: false, status: null, reason: "not-configured" };
    const parsed = z
      .object({
        to: z.array(address).min(1).max(20),
        subject: z.string().trim().min(1).max(200),
        text: z.string().min(1).max(100_000),
        replyTo: address.optional(),
      })
      .parse(message);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.mailTimeout);
    try {
      const response = await fetch(this.config.mailApiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.mailApiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          from: parsed.replyTo ?? this.config.mailFrom,
          to: parsed.to,
          subject: parsed.subject,
          text: parsed.text,
        }),
        signal: controller.signal,
      });
      const raw = await response.text();
      let responseBody: unknown = raw;
      try {
        responseBody = raw ? JSON.parse(raw) : undefined;
      } catch {
        // The relay may return plain text; preserve it for diagnostics.
      }
      if (!response.ok)
        throw new AppError(
          response.status === 401 ? 502 : response.status,
          `邮件中转服务返回错误（${response.status}）`,
        );
      responseSchema.parse(responseBody);
      return { accepted: true, status: response.status, response: responseBody };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if ((error as Error)?.name === "AbortError")
        throw new AppError(504, "邮件中转服务响应超时");
      throw new AppError(502, "暂时无法连接邮件中转服务");
    } finally {
      clearTimeout(timer);
    }
  }
}
