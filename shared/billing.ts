export const BILLING_VERSION = "V1.5";

export type ProductType = "courseware" | "video" | "agent";

export type CreditPackage = {
  name: "lite" | "pro" | "pro5x" | "max" | "topup";
  label: string;
  priceYuan: number;
  credits: number;
};

export type ModelPricing = {
  model: string;
  coefficient: number | null;
  note: string;
};

export type BillingCatalog = {
  version: string;
  unit: "积分";
  tokenFormula: string;
  minimumCharge: number;
  packages: CreditPackage[];
  products: {
    type: ProductType;
    label: string;
    tool: string;
    model: string;
    formula: string;
  }[];
  models: ModelPricing[];
};

export const creditPackages: CreditPackage[] = [
  { name: "lite", label: "lite", priceYuan: 19, credits: 20_000 },
  { name: "pro", label: "pro", priceYuan: 69, credits: 80_000 },
  { name: "pro5x", label: "pro5x", priceYuan: 399, credits: 400_000 },
  { name: "max", label: "max", priceYuan: 690, credits: 1_000_000 },
  { name: "topup", label: "加油包", priceYuan: 10, credits: 10_000 },
];

export const modelPricing: ModelPricing[] = [
  { model: "ds v4 flash", coefficient: 2.5, note: "flash 系列统一" },
  { model: "glm 5.3 flash", coefficient: 2.5, note: "flash 系列统一" },
  { model: "qwen 3.8 flash", coefficient: 2.5, note: "flash 系列统一" },
  { model: "ds v4 pro", coefficient: 10, note: "pro 系列" },
  { model: "HY 4 pro", coefficient: 10, note: "pro 系列" },
  { model: "minimax m3", coefficient: 10, note: "" },
  { model: "glm 5.3", coefficient: 20, note: "glm 系列" },
  { model: "glm 5.2", coefficient: 20, note: "glm 系列" },
  { model: "kimi 2.6", coefficient: 20, note: "kimi 系列" },
  { model: "kimi 2.7", coefficient: 20, note: "kimi 系列" },
  { model: "kimi 2.8", coefficient: 20, note: "kimi 系列" },
  { model: "kimi k3", coefficient: null, note: "暂未开放" },
  { model: "Claude opus", coefficient: 12.5, note: "国外模型" },
  { model: "Claude sonnet", coefficient: 5, note: "国外模型" },
  { model: "ChatGPT", coefficient: null, note: "官网 API 计价 ÷ 2" },
];

export const billingCatalog: BillingCatalog = {
  version: BILLING_VERSION,
  unit: "积分",
  // The document contains a conflicting ×1000 expression. The normalized
  // implementation uses the standard tokens/1000 formula.
  tokenFormula: "max(50, ceil(tokens / 1000 × 模型抵扣系数))",
  minimumCharge: 50,
  packages: creditPackages,
  products: [
    {
      type: "courseware",
      label: "课件制作",
      tool: "开源工具",
      model: "ds4.1flash",
      formula: "tokens / 1000 × 2.5，最低 50 积分",
    },
    {
      type: "video",
      label: "视频制作",
      tool: "HyperFrames + Remotion",
      model: "ds4.1flash",
      formula: "tokens / 1000 × 2.5，最低 50 积分",
    },
    {
      type: "agent",
      label: "Rabbit Agent",
      tool: "酷码工作室 AI 工具",
      model: "按实际调用模型",
      formula: "tokens / 1000 × 模型抵扣系数，最低 50 积分",
    },
  ],
  models: modelPricing,
};

export function resolveModelCoefficient(model: string): number | null {
  const normalized = model.trim().toLowerCase();
  const exact = modelPricing.find((item) =>
    normalized.includes(item.model.toLowerCase()),
  );
  if (exact) return exact.coefficient;
  if (normalized.includes("flash")) return 2.5;
  if (normalized.includes("pro")) return 10;
  if (normalized.includes("glm") || normalized.includes("kimi")) return 20;
  return null;
}

export function calculateTokenCredits(
  tokens: number,
  coefficient: number,
  minimumCharge = billingCatalog.minimumCharge,
) {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  if (!Number.isFinite(coefficient) || coefficient < 0)
    throw new Error("模型抵扣系数不合法");
  return Math.max(minimumCharge, Math.ceil((tokens / 1000) * coefficient));
}
