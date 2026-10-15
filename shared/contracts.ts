import { z } from "zod";
import { workflowIds } from './workflows.js';
import { musicScoreSchema } from './music-score.js';

export const designSpecSchema = z.object({
  safeMargin: z.number().min(0.04).max(0.15),
  gridColumns: z.number().int().min(2).max(12),
  fontScale: z.array(z.number().min(12).max(200)).min(2).max(5),
  palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).min(3).max(6),
  subjectIdentity: z.string().min(1).max(500),
});
export const cameraPathSchema = z.array(z.object({
  progress: z.number().min(0).max(1), x: z.number().min(-2).max(2),
  y: z.number().min(-2).max(2), scale: z.number().min(0.2).max(5),
})).min(2).max(8);

export const BRAND = "cocode 酷码工作室 · Cocode Studio VideoForge";
export const sceneSchema = z.object({
  id: z.string().regex(/^s[1-9][0-9]?$/),
  title: z.string().min(1).max(24),
  duration: z.number().min(2).max(15),
  description: z.string().min(1).max(800),
  narration: z.string().max(200),
  camera: z.string().max(160).optional(),
  transition: z.string().max(160).optional(),
  emotion: z.string().min(1).max(80),
  headline: z.string().min(1).max(36),
  caption: z.string().max(80),
  palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).length(3),
  motif: z.string().max(160).optional(),
  cameraPath: cameraPathSchema.optional(),
  beats: z.array(z.object({ progress: z.number().min(0).max(1), action: z.string().max(300) })).max(12).optional(),
  sustainedMotion: z.string().max(300).optional(),
});
export const storyboardSchema = z
  .object({
    title: z.string().min(1).max(80),
    concept: z.string().min(1).max(1000),
    visualStyle: z.string().min(1).max(160),
    emotionalArc: z.string().min(1).max(300),
    scenes: z.array(sceneSchema).min(1).max(10),
    designSpec: designSpecSchema.optional(),
    musicScore: musicScoreSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (new Set(v.scenes.map((s) => s.id)).size !== v.scenes.length)
      ctx.addIssue({ code: "custom", message: "镜头 ID 重复" });
  });
export const briefSchema = z.object({
  prompt: z.string().trim().min(1).max(8000),
  duration: z.number().int().min(1).max(600).default(30),
  aspect: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
  exportResolution:z.enum(["720p","1080p","4k"]).optional(),
  exportFps:z.number().int().min(12).max(60).optional(),
  specMode:z.enum(['auto','manual']).optional(),
  style: z.enum(["cinematic", "minimal", "vibrant"]).default("cinematic"),
  workflow: z.enum(['auto', ...workflowIds]).optional(),
  assetIds: z.array(z.uuid()).max(30).optional(),
  sourceUrl: z.url().max(2048).optional(),
  narrationEnabled: z.boolean().optional(),
  captionsEnabled: z.boolean().optional(),
  music: z.enum(['none', 'generated', 'uploaded']).optional(),
  engine: z.enum(['auto','browser','hyperframes','remotion','blender']).optional(),
  taskMode: z.enum(['auto','video','chat']).optional(),
  voiceProvider: z.enum(['auto','gateway','kokoro','elevenlabs','edge','minimax']).optional(),
  voice: z.string().max(200).optional(),
});
export const wholeFilmSchema = z.object({
  storyboard: storyboardSchema.safeExtend({
    designSpec:designSpecSchema,
    scenes:z.array(sceneSchema.extend({duration:z.number().min(1/30).max(60)})).min(1).max(99),
  }),
  html: z.string().min(400).max(200000),
});
export type Scene = z.infer<typeof sceneSchema>;
export type Storyboard = z.infer<typeof storyboardSchema>;
export type Brief = z.infer<typeof briefSchema>;
export type User = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  officialId?: string;
};
export type Workspace = {
  id: string;
  ownerId: string;
  name: string;
  plan: "free" | "pro" | "max" | "custom";
  createdAt: string;
  updatedAt: string;
};
export type QuotaSummary = {
  workspaceId: string;
  plan: Workspace["plan"];
  grantedUnits: number;
  consumedUnits: number;
  reservedUnits: number;
  internalAvailableUnits: number;
  availableUnits: number;
  official: OfficialQuotaSummary;
};
export type OfficialQuotaSummary = {
  managed?: boolean;
  videoCosts?: Record<string, number>;
  chatCost?: number;
  connected: boolean;
  externalUserId?: string;
  label?: string;
  plan?: string;
  availableUnits: number;
  expiresAt?: string;
  status: "active" | "expired" | "suspended" | "unavailable";
  lastSyncedAt?: string;
};
export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  jobId?: string;
  streaming?: boolean;
  kind?: 'text'|'tool'|'activity'|'question'|'event';
  event?: {type:string;data:unknown};
  revision?: number;
  tool?: {name:string;status:'running'|'done'|'error'|'interrupted';args?:unknown;result?:unknown;startedAt:string;finishedAt?:string};
  question?: {options:string[];status:'open'|'answered'|'interrupted';answer?:string};
  attachments?: {path:string;kind:'image'|'video'|'audio'|'file';label:string}[];
};
export type JobStatus =
  | "queued"
  | "storyboarding"
  | "rendering"
  | "assembling"
  | "completed"
  | "failed";
export type RenderRecord = {
  id: string;
  status: JobStatus;
  progress: number;
  message: string;
  quotaUnits?: number;
  createdAt: string;
  completedAt?: string;
  exportPhase?: 'prepare'|'capture'|'encode'|'mix'|'review'|'deliver';
  exportPhaseStartedAt?:string;
  lastProgressAt?:string;
  exportPhaseTimes?:Partial<Record<'prepare'|'capture'|'encode'|'mix'|'review'|'deliver',number>>;
  exportCache?:{image:boolean;final:boolean};
  exportMetrics?:{seekMs:number;captureMs:number;writeMs:number;progressMs:number;encodeMs:number;totalMs:number;frames:number;capture:string;workers:number;stream:boolean};
  video?: string;
  error?: string;
  duration?: number;
  tokenUsage?: TokenUsage;
  billingEstimate?: BillingEstimate;
  workflow?: import('./workflows.js').Workflow;
  generationMode?: 'whole-film' | 'scene-compositions' | 'harness';
  engine?: 'browser'|'hyperframes'|'remotion'|'blender';
  projectConfiguration?:{engine:'browser'|'hyperframes'|'remotion'|'blender';width:number;height:number;fps:number;duration:number;entry:string};
  checkpoint?: boolean;
  sourceJobId?: string;
  publicLogRecovered?: boolean;
  revision?: number;
  plan?: {title:string;status:'pending'|'active'|'done'}[];
  generationStage?: 'story' | 'design' | 'motion' | 'code' | 'delivery' | 'review' | 'repair';
  repairCount?: number;
  capabilityNotes?: string[];
  skillSnapshot?: SkillSnapshot;
  deliveryType?: 'video' | 'presentation';
  qualityReport?: { passed: boolean; checks: string[]; repairs: number;issueSummary?:string; reviewMode?:'vision'|'code'; visualReviewPassed?:boolean };
};
export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  calls: number;
  cacheReadTokens?:number;
  byModel?: Record<string,{promptTokens:number;completionTokens:number;totalTokens:number;calls:number;cacheReadTokens?:number}>;
};
export type BillingEstimate = {
  model: string;
  coefficient: number | null;
  tokens: number;
  units: number | null;
  minimumCharge: number;
  version: string;
  status: "estimated" | "model-not-configured";
};
export type Project = {
  id: string;
  userId: string;
  workspaceId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  brief?: Brief;
  storyboard?: Storyboard;
  messages: Message[];
  renders: RenderRecord[];
  assets?: AssetRecord[];
};
export type AssetRecord = {
  id: string; name: string; kind: 'image' | 'video' | 'audio' | 'captions' | 'source';
  file: string; mime: string; bytes: number; sha256: string; createdAt: string;
  duration?: number; sourceUrl?: string;
};
export type SkillSnapshot = {
  revision: string; promptVersion: string;
  files: { path: string; sha256: string }[];
};
export const activeStatus = (s: JobStatus) =>
  !["completed", "failed"].includes(s);
// Each plugin is independently bundled. Symbol.for preserves error identity
// across those bundles, unlike a constructor reference.
const appErrorBrand = Symbol.for("cocode.videoforge.AppError");
export class AppError extends Error {
  readonly [appErrorBrand] = true;
  static [Symbol.hasInstance](value: unknown): boolean {
    return (
      typeof value === "object" &&
      value !== null &&
      (value as AppError)[appErrorBrand] === true
    );
  }
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}
