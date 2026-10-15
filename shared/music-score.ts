import { z } from 'zod';
export const musicScoreSchema = z.object({
  bpm: z.number().min(40).max(200),
  notes: z.array(z.object({
    beat: z.number().min(0).max(200), length: z.number().min(0.05).max(16),
    midi: z.number().int().min(24).max(96), gain: z.number().min(0).max(0.5),
    voice: z.enum(['sine', 'soft', 'pluck', 'bass', 'pad', 'bell', 'kick', 'snare', 'hat']),
  })).min(1).max(2048),
});
export type MusicScore = z.infer<typeof musicScoreSchema>;
