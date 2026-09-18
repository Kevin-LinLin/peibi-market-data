import { readFile, writeFile } from 'node:fs/promises';

const SERIES = {
  cpi: 'CPIAUCSL',
  real_yield: 'DFII10',
  usd_index: 'DTWEXBGS'
};

function parseFredCsv(text) {
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map(line => line.split(','))
    .filter(([, value]) => value && value !== '.')
    .map(([date, value]) => ({ date, value: Number(value) }))
    .filter(row => Number.isFinite(row.value));
}

const series = {};
for (const [name, id] of Object.entries(SERIES)) {
  const response = await fetch(
    `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`
  );
  if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`);
  series[name] = parseFredCsv(await response.text());
}

const gold = JSON.parse(
  await readFile('history/gold-history.json', 'utf8')
);

const output = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  purpose: 'Frozen Gold model historical baselines. Values are official observations, never interpolated.',
  sources: {
    gold_price: {
      name: gold.source,
      url: gold.source_url,
      unit: gold.unit,
      frequency: gold.frequency
    },
    cpi: {
      name: 'FRED CPIAUCSL',
      url: 'https://fred.stlouisfed.org/series/CPIAUCSL'
    },
    real_yield: {
      name: 'FRED DFII10',
      url: 'https://fred.stlouisfed.org/series/DFII10'
    },
    usd_index: {
      name: 'FRED DTWEXBGS',
      url: 'https://fred.stlouisfed.org/series/DTWEXBGS'
    }
  },
  gold_price: gold.observations,
  ...series
};

await writeFile(
  'history/gold-score-baseline.json',
  `${JSON.stringify(output, null, 2)}\n`
);

console.log(
  `Gold baseline written: price=${output.gold_price.length}, CPI=${output.cpi.length}, real yield=${output.real_yield.length}, USD=${output.usd_index.length}`
);
