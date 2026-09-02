export const ASSETS = [
  { id: 'nasdaq100', name: 'Nasdaq 100', category: 'US Broad / Growth Index' },
  { id: 'sp500', name: 'S&P 500', category: 'US Broad / Growth Index' },
  { id: 'gold', name: 'Gold', category: 'Alternative Asset' },
  { id: 'csi_a500', name: '中证A500', category: 'China Broad Index' },
  { id: 'dividend_lowvol100', name: '红利低波100', category: 'Dividend / Defensive' },
  { id: 'hangseng_tech', name: '恒生科技', category: 'Growth / Tech' },
  { id: 'csi_healthcare', name: '中证医疗', category: 'Sector' },
  { id: 'csi_securities', name: '证券板块', category: 'Sector' }
];

// Sources are deliberately explicit. `auto` means a stable machine-readable series;
// `check_only` means the workflow verifies availability but never invents a new value;
// `manual` requires a reviewed entry in data/manual-overrides.json.
export const SOURCES = {
  nasdaq100: {
    price: { mode: 'auto', fred: 'NASDAQ100', unit: 'index points', source: 'FRED', source_url: 'https://fred.stlouisfed.org/series/NASDAQ100' },
    volatility: { mode: 'derived', from: 'price' },
    drawdown: { mode: 'derived', from: 'price' }, trend: { mode: 'derived', from: 'price' },
    forward_pe: { mode: 'manual', source: 'Nasdaq Index Insights / FactSet', source_url: 'https://www.nasdaq.com/articles/global-indexes/biweekly-investment-insights-earnings-remain-the-clear-driver-for-equity-returns' },
    earnings_growth: { mode: 'manual', source: 'Nasdaq Index Insights / FactSet', source_url: 'https://www.nasdaq.com/articles/global-indexes/biweekly-investment-insights-earnings-remain-the-clear-driver-for-equity-returns' }
  },
  sp500: {
    price: { mode: 'auto', fred: 'SP500', unit: 'index points', source: 'FRED', source_url: 'https://fred.stlouisfed.org/series/SP500' },
    volatility: { mode: 'derived', from: 'price' }, drawdown: { mode: 'derived', from: 'price' }, trend: { mode: 'derived', from: 'price' },
    forward_pe: { mode: 'manual', source: 'FactSet S&P 500 Earnings Season Update', source_url: 'https://insight.factset.com/sp-500-earnings-season-update-august-7-2026' },
    earnings_growth: { mode: 'manual', source: 'FactSet S&P 500 Earnings Season Update', source_url: 'https://insight.factset.com/sp-500-earnings-season-update-august-7-2026' }
  },
  gold: {
    price: { mode: 'auto', url: 'https://api.gold-api.com/price/XAU', unit: 'USD/troy oz', source: 'Gold API', source_url: 'https://api.gold-api.com/price/XAU' },
    real_yield: { mode: 'auto', fred: 'DFII10', unit: '%', source: 'FRED', source_url: 'https://fred.stlouisfed.org/series/DFII10' },
    usd_index: { mode: 'auto', fred: 'DTWEXBGS', unit: 'index', source: 'FRED', source_url: 'https://fred.stlouisfed.org/series/DTWEXBGS' },
    volatility: { mode: 'derived', from: 'price' }, trend: { mode: 'derived', from: 'price' }, drawdown: { mode: 'derived', from: 'price' }
  },
  csi_a500: { price: { mode: 'check_only', source: 'China Securities Index', source_url: 'https://www.csindex.com.cn/' }, trailing_pe: { mode: 'manual', source: 'China Securities Index factsheet', source_url: 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/000510factsheet.pdf' }, pb: { mode: 'manual', source: 'China Securities Index factsheet' }, dividend_yield: { mode: 'manual', source: 'China Securities Index factsheet' }, roe: { mode: 'manual', source: 'China Securities Index factsheet' } },
  dividend_lowvol100: { price: { mode: 'check_only', source: 'China Securities Index', source_url: 'https://www.csindex.com.cn/' }, trailing_pe: { mode: 'manual', source: 'China Securities Index factsheet', source_url: 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/930955factsheet.pdf' }, pb: { mode: 'manual', source: 'China Securities Index factsheet' }, dividend_yield: { mode: 'manual', source: 'China Securities Index factsheet' }, roe: { mode: 'manual', source: 'China Securities Index factsheet' } },
  hangseng_tech: { price: { mode: 'check_only', source: 'Hang Seng Indexes', source_url: 'https://www.hsi.com.hk/' }, trailing_pe: { mode: 'manual', source: 'Hang Seng Indexes factsheet', source_url: 'https://www.hsi.com.hk/static/uploads/contents/en/dl_centre/factsheets/hsteche.pdf' }, dividend_yield: { mode: 'manual', source: 'Hang Seng Indexes factsheet' }, earnings_growth: { mode: 'manual', source: 'Hang Seng Indexes' } },
  csi_healthcare: { price: { mode: 'check_only', source: 'China Securities Index', source_url: 'https://www.csindex.com.cn/' }, trailing_pe: { mode: 'manual', source: 'China Securities Index factsheet', source_url: 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/399989factsheet.pdf' }, pb: { mode: 'manual', source: 'China Securities Index factsheet' }, roe: { mode: 'manual', source: 'China Securities Index factsheet' } },
  csi_securities: { price: { mode: 'check_only', source: 'China Securities Index', source_url: 'https://www.csindex.com.cn/' }, trailing_pe: { mode: 'manual', source: 'China Securities Index factsheet', source_url: 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/399975factsheet.pdf' }, pb: { mode: 'manual', source: 'China Securities Index factsheet' }, roe: { mode: 'manual', source: 'China Securities Index factsheet' } }
};
