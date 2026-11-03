import { z } from 'zod';

export const PLATFORM = ['FACEBOOK', 'INSTAGRAM'] as const;
export type Platform = typeof PLATFORM[number];
export const PUBLISHING_STATUS = ['DRAFT','SCHEDULED','PREPARING','READY','PUBLISHING','PUBLISHED','RETRY_WAIT','FAILED','ACTION_REQUIRED','UNKNOWN','CANCELLED'] as const;
export type PublishingStatus = typeof PUBLISHING_STATUS[number];
export const createPostSchema = z.object({
  caption: z.string().max(15000).default(''),
  mediaAssetId: z.uuid().nullable().optional(),
  accountIds: z.array(z.uuid()).max(20).default([]),
  overrides: z.record(z.string(), z.string().max(15000)).default({}),
  scheduledAtUtc: z.iso.datetime({offset:true}).nullable().optional(),
  saveDraft: z.boolean().default(false),
  contentOrigin: z.enum(['HUMAN_UPLOAD','IMPORTED','AI_ASSISTED']).default('HUMAN_UPLOAD')
}).superRefine((v, ctx) => {
  if (!v.saveDraft && !v.accountIds.length) ctx.addIssue({code:'custom',path:['accountIds'],message:'Select at least one connected account'});
  if (!v.saveDraft && !v.caption.trim() && !v.mediaAssetId) ctx.addIssue({code:'custom',path:['caption'],message:'Add a caption or media'});
});
export const rescheduleSchema = z.object({ scheduledAtUtc: z.iso.datetime({offset:true}) });
export function aggregateStatus(statuses: PublishingStatus[]): string {
  if (!statuses.length) return 'DRAFT';
  if (statuses.every(s => s === 'PUBLISHED')) return 'PUBLISHED';
  if (statuses.includes('PUBLISHED') && statuses.some(s => s !== 'PUBLISHED')) return 'PARTIALLY_PUBLISHED';
  if (statuses.every(s => s === 'CANCELLED')) return 'CANCELLED';
  if (statuses.some(s => s === 'UNKNOWN')) return 'UNKNOWN';
  if (statuses.some(s => s === 'ACTION_REQUIRED')) return 'ACTION_REQUIRED';
  if (statuses.some(s => s === 'FAILED')) return 'FAILED';
  if (statuses.some(s => s === 'PUBLISHING')) return 'PUBLISHING';
  return 'SCHEDULED';
}
export function retryDelaySeconds(attempt: number): number { return Math.min(3600, 30 * 2 ** Math.min(7, Math.max(0, attempt - 1))); }
export function isUncertainHttpStatus(status: number | null): boolean { return status === null || status >= 500 || status === 408; }
