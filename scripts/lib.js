import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..');
export const now = () => new Date().toISOString();
export async function json(path) { return JSON.parse(await readFile(resolve(ROOT, path), 'utf8')); }
export async function save(path, value) { const file = resolve(ROOT, path); await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value, null, 2) + '\n'); }
export const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
export const metricKey = m => `${m.asset_id}:${m.metric}:${m.observation_date}`;
export const validNumber = value => typeof value === 'number' && Number.isFinite(value);
export function record({ asset_id, metric, value, unit, observation_date, published_date = null, source, source_url, quality = 'official', status = 'available', retrieved_at = now(), latest_available_checked_at = retrieved_at }) {
  return { asset_id, metric, value, unit, observation_date, published_date, source, source_url, retrieved_at, latest_available_checked_at, quality, status };
}
export function latestBy(records) { const map = new Map(); for (const row of records) { const key = `${row.asset_id}:${row.metric}`; if (!map.has(key) || row.observation_date > map.get(key).observation_date) map.set(key, row); } return [...map.values()].sort((a,b) => `${a.asset_id}:${a.metric}`.localeCompare(`${b.asset_id}:${b.metric}`)); }
export function daysSince(iso) { return Math.floor((Date.now() - Date.parse(iso)) / 86400000); }
