import { json, date, metricKey, validNumber } from './lib.js';
const files = ['data/latest-market.json', 'data/latest-valuation.json', 'history/metrics.json'];
let failed = false;
for (const file of files) {
  const document = await json(file);
  const rows = document.metrics || document.records || [];
  const keys = new Set();
  for (const row of rows) {
    const required = ['asset_id','metric','unit','observation_date','source','source_url','retrieved_at','latest_available_checked_at','quality','status'];
    const missing = required.filter(k => !row[k]);
    if (missing.length || !validNumber(row.value) || !date(row.observation_date) || !date(row.published_date ?? row.observation_date)) { console.error(`${file}: invalid metric ${row.asset_id}:${row.metric}`); failed = true; }
    if (file.includes('history')) { const key = metricKey(row); if (keys.has(key)) { console.error(`${file}: duplicate ${key}`); failed = true; } keys.add(key); }
  }
}
if (failed) process.exit(1); console.log('Data validation passed.');
