import { transform } from "esbuild";
import { AppError } from "../../shared/contracts.js";
/** Syntax only. No code behavior whitelist, sanitization or template restriction. */
export async function validateHtmlSyntax(html: string) {
  try {
    for (const match of html.matchAll(
      /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
    )) {
      const attrs = match[1],
        code = match[2];
      if (
        /\bsrc\s*=/i.test(attrs) ||
        /\btype\s*=\s*["'](?:application\/(?:ld\+)?json|importmap)["']/i.test(
          attrs,
        ) ||
        !code.trim()
      )
        continue;
      await transform(code, {
        loader: "js",
        target: "esnext",
        logLevel: "silent",
      });
    }
    for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi))
      await transform(match[1], { loader: "css", logLevel: "silent" });
  } catch (e) {
    throw Object.assign(new AppError(503, "镜头代码存在语法错误，请重新生成"), {
      diagnostic: e instanceof Error ? e.message : String(e),
    });
  }
}
