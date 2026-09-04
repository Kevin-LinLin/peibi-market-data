import { ASSETS, SOURCES } from './sources.js';
import { json, save, now, latestBy, metricKey, record } from './lib.js';
import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);

const started_at = now();
const safeTimestamp = started_at.replace(/[-:.TZ]/g, '');

const run = {
  run_id: `weekly-${safeTimestamp}`,
  run_type: 'weekly',
  started_at,
  finished_at: null,
  success: false,
  updated_metrics: [],
  unchanged_metrics: [],
  failed_metrics: [],
  failed_sources: [],
  warnings: [],
  validation_errors: []
};

const months = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12'
};

const isoFromEnglishDate = value => {
  const match = value?.match(/([A-Z][a-z]{2})\s+(\d{1,2})\s+(20\d{2})/);
  return match
    ? `${match[3]}-${months[match[1]]}-${match[2].padStart(2, '0')}`
    : null;
};

const isoFromChineseDate = value => {
  const match = value?.match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  return match
    ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
    : null;
};

const textFromHtml = body =>
  body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ');

async function fetchWithRetry(url) {
  let lastError;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: {
          'user-agent': 'peibi-market-data/1.0'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function pdfText(url, assetId, metric) {
  const response = await fetchWithRetry(url);
  const file = join(
    tmpdir(),
    `peibi-${assetId}-${metric}-${Date.now()}.pdf`
  );

  try {
    await writeFile(
      file,
      Buffer.from(await response.arrayBuffer())
    );

    return (
      await execFileAsync(
        'pdftotext',
        ['-layout', file, '-'],
        { maxBuffer: 12 * 1024 * 1024 }
      )
    ).stdout;
  } finally {
    await rm(file, { force: true });
  }
}

function parseStateStreetPe(body) {
  const text = textFromHtml(body);
  const start = text.indexOf('Index Characteristics as of');
  const section =
    start >= 0
      ? text.slice(start, start + 1800)
      : text;

  const date = isoFromEnglishDate(
    section.match(
      /Index Characteristics as of\s+([A-Z][a-z]{2}\s+\d{1,2}\s+20\d{2})/
    )?.[1]
  );

  const value = section.match(
    /Price\/Earnings\b.{0,900}?\b(\d+(?:\.\d+)?)\b/i
  )?.[1];

  return value && date
    ? {
        value: Number(value),
        observation_date: date
      }
    : null;
}

function parseCsiFactsheet(text, label) {
  const escaped = label.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  );

  const value = text.match(
    new RegExp(
      `${escaped}\\s+([0-9]*\\.?[0-9]+|--|—)`
    )
  )?.[1];

  const date = isoFromChineseDate(
    text.slice(0, 1200)
  );

  return value &&
    value !== '--' &&
    value !== '—' &&
    date
    ? {
        value: Number(value),
        observation_date: date
      }
    : null;
}

function parseHsTechFactsheet(text) {
  const lines = text.split(/\r?\n/);

  const headerIndex = lines.findIndex(line =>
    /Dividend Yield\s*\(%\)\s+PE Ratio\s*\(Times\)/i.test(line)
  );

  const row =
    headerIndex >= 0
      ? lines
          .slice(headerIndex + 1, headerIndex + 6)
          .find(line => /\bHSTECH\b/.test(line))
      : null;

  const cells = row
    ?.slice(
      row.indexOf('HSTECH') + 'HSTECH'.length
    )
    .match(/(?:\d+(?:\.\d+)?|--|—)/g);

  // Dividend Yield is the first numeric column.
  // PE Ratio is the second.
  const pe = cells?.[1];

  const dateMatch = text.match(
    /\bAll data\s+as at\s+(\d{1,2})\s+([A-Z][a-z]{2})\s+(20\d{2})\b/i
  );

  const month = dateMatch
    ? months[
        dateMatch[2].charAt(0).toUpperCase() +
          dateMatch[2].slice(1).toLowerCase()
      ]
    : null;

  const date =
    dateMatch && month
      ? `${dateMatch[3]}-${month}-${dateMatch[1].padStart(2, '0')}`
      : null;

  const value = Number(pe);

  return Number.isFinite(value) &&
    pe !== '--' &&
    pe !== '—' &&
    date
    ? {
        value,
        observation_date: date
      }
    : null;
}

async function parseMetric(asset, metric, config) {
  if (config.parser === 'state_street_pe') {
    return parseStateStreetPe(
      await (
        await fetchWithRetry(config.source_url)
      ).text()
    );
  }

  const text = await pdfText(
    config.source_url,
    asset.id,
    metric
  );

  if (config.parser === 'csi_factsheet') {
    return parseCsiFactsheet(
      text,
      config.label
    );
  }

  if (config.parser === 'hstech_factsheet') {
    return parseHsTechFactsheet(text);
  }

  throw new Error(
    `Unsupported parser: ${config.parser}`
  );
}

const [valuation, history] =
  await Promise.all([
    json('data/latest-valuation.json'),
    json('history/metrics.json')
  ]);

const next = valuation.metrics.map(row => ({
  ...row
}));

for (const asset of ASSETS) {
  for (const [metric, config] of Object.entries(
    SOURCES[asset.id]
  )) {
    if (config.mode !== 'auto_parsed') {
      continue;
    }

    const key = `${asset.id}:${metric}`;

    const position = next.findIndex(
      row =>
        `${row.asset_id}:${row.metric}` === key
    );

    const existing =
      position >= 0
        ? next[position]
        : null;

    try {
      const parsed = await parseMetric(
        asset,
        metric,
        config
      );

      const checked = now();

      if (
        !parsed ||
        !Number.isFinite(parsed.value) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(
          parsed.observation_date
        )
      ) {
        throw new Error(
          'Parser did not return both a finite value and observation_date'
        );
      }

      if (
        existing &&
        parsed.observation_date <=
          existing.observation_date
      ) {
        existing.latest_available_checked_at =
          checked;
        existing.retrieved_at = checked;

        if (
          parsed.observation_date ===
            existing.observation_date &&
          existing.value !== parsed.value
        ) {
          run.warnings.push({
            asset_id: asset.id,
            metric,
            warning:
              'Same-date value revision ignored pending review'
          });
        }

        if (
          parsed.observation_date <
          existing.observation_date
        ) {
          run.warnings.push({
            asset_id: asset.id,
            metric,
            warning:
              'Parsed observation is older than Last Known Good'
          });
        }

        run.unchanged_metrics.push(key);
        continue;
      }

      const row = record({
        asset_id: asset.id,
        metric,
        value: parsed.value,
        unit: config.unit,
        observation_date:
          parsed.observation_date,
        published_date:
          parsed.observation_date,
        source: config.source,
        source_url: config.source_url,
        quality: 'official parsed source',
        status: 'available',
        retrieved_at: checked,
        latest_available_checked_at: checked
      });

      if (position >= 0) {
        next[position] = row;
      } else {
        next.push(row);
      }

      run.updated_metrics.push(key);
    } catch (error) {
      run.failed_metrics.push(key);

      run.failed_sources.push({
        asset_id: asset.id,
        metric,
        error: String(error)
      });
    }
  }
}

const valid = next.filter(row =>
  Number.isFinite(row.value)
);

await save(
  'data/latest-valuation.json',
  {
    schema_version: 1,
    updated_at: now(),
    metrics: latestBy(valid)
  }
);

const known = new Set(
  history.records.map(metricKey)
);

for (const row of valid) {
  if (!known.has(metricKey(row))) {
    history.records.push(row);
    known.add(metricKey(row));
  }
}

await save(
  'history/metrics.json',
  history
);

run.finished_at = now();
run.success =
  run.failed_metrics.length === 0;

await save(
  'logs/refresh-latest.json',
  run
);

await save(
  `logs/refresh-${safeTimestamp}.json`,
  run
);

console.log(
  JSON.stringify(run, null, 2)
);

if (!run.success) {
  process.exitCode = 1;
}
