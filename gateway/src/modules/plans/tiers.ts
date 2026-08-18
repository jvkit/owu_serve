import { db } from '../../lib/db';
import { parsePlanTiers } from '../../config';
import { utcNow } from '../../lib/utils';

const GB = 1024 * 1024 * 1024;

export type PlanTier = {
    id: number;
    name: string;
    storage_gb: number;
    file_count: number;
    chat_quota_usd: number;
    is_active: number;
    created_at: string;
    updated_at: string;
};

export type TierQuotas = {
    storage_quota: number;
    file_count_quota: number;
    chat_quota_usd: number;
};

export function seedPlanTiersFromEnv(): void {
    const row = db.prepare('SELECT COUNT(*) as c FROM plan_tiers').get() as { c: number } | undefined;
    if (!row || row.c > 0) return;

    const raw = process.env.PLAN_TIERS || '1,100,5|5,500,10|15,1500,20|30,3000,40|100,10000,150';
    const envTiers = parsePlanTiers(raw);
    const now = utcNow();
    const stmt = db.prepare(
        'INSERT INTO plan_tiers (id, name, storage_gb, file_count, chat_quota_usd, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)'
    );

    for (const [idStr, t] of Object.entries(envTiers)) {
        const id = Number(idStr);
        const name = `等级${id}`;
        const storageGb = Math.round(t.storage_quota / GB);
        stmt.run(id, name, storageGb, t.file_count_quota, t.chat_quota_usd, now, now);
    }
}

export function getPlanTiers(): Record<number, TierQuotas> {
    const rows = db.prepare('SELECT * FROM plan_tiers WHERE is_active = 1 ORDER BY id ASC').all() as PlanTier[];
    const tiers: Record<number, TierQuotas> = {};
    for (const r of rows) {
        tiers[r.id] = {
            storage_quota: r.storage_gb * GB,
            file_count_quota: r.file_count,
            chat_quota_usd: r.chat_quota_usd,
        };
    }
    return tiers;
}

export function listPlanTiers(): PlanTier[] {
    return db.prepare('SELECT * FROM plan_tiers ORDER BY id ASC').all() as PlanTier[];
}

export function createPlanTier(tier: Omit<PlanTier, 'created_at' | 'updated_at'>): void {
    const now = utcNow();
    db.prepare(
        'INSERT INTO plan_tiers (id, name, storage_gb, file_count, chat_quota_usd, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(tier.id, tier.name, tier.storage_gb, tier.file_count, tier.chat_quota_usd, tier.is_active, now, now);
}

export function updatePlanTier(id: number, patch: Partial<PlanTier>): void {
    const existing = db.prepare('SELECT 1 FROM plan_tiers WHERE id = ?').get(id);
    if (!existing) throw new Error('Tier not found');

    const allowed = ['name', 'storage_gb', 'file_count', 'chat_quota_usd', 'is_active'] as const;
    const sets: string[] = [];
    const values: any[] = [];
    for (const key of allowed) {
        if (key in patch) {
            sets.push(`${key} = ?`);
            values.push((patch as any)[key]);
        }
    }
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    values.push(utcNow());
    values.push(id);
    db.prepare(`UPDATE plan_tiers SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function deletePlanTier(id: number): void {
    const inUse = db.prepare('SELECT 1 FROM user_plans WHERE tier = ? LIMIT 1').get(id);
    if (inUse) throw new Error('该档位仍有用户使用，无法删除');
    db.prepare('DELETE FROM plan_tiers WHERE id = ?').run(id);
}
