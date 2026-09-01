// Frozen production-score formulas. This file changes data only; it does not change model weights.
import { json, save, now } from './lib.js';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const valuation=(pe,mean)=>clamp(50-((pe/mean-1)*100)*1.25,0,100);
const growth=n=>clamp(50+n*.5,0,100);
const condition=(drawdown,trend)=>clamp(50+Math.min(30,Math.max(0,-drawdown*1.5))+(trend>45?-10:trend<-25?-5:0),20,100);
const riskHealth=volatility=>clamp(85-volatility*1.6,15,85);
const score=(v,f,m,r)=>Math.round(v*.55+f*.20+m*.15+r*.10);
const status=s=>s>=80?'非常有吸引力':s>=65?'偏有吸引力':s>=45?'中性':s>=30?'偏低':'明显偏低';
const metric=(rows,id,name)=>rows.find(r=>r.asset_id===id&&r.metric===name)?.value ?? null;
const market=await json('data/latest-market.json'), valuationData=await json('data/latest-valuation.json');
const all=[...market.metrics,...valuationData.metrics], existing=await json('data/market-snapshot.json');
const assets=Object.fromEntries(Object.entries(existing.assets).map(([id, old])=>[id,{...old}]));
for(const id of ['nasdaq100','sp500']) { const pe=metric(all,id,'forward_pe'), mean=metric(all,id,'forward_pe_10y_mean'), eg=metric(all,id,'earnings_growth'), dd=metric(all,id,'drawdown'), tr=metric(all,id,'trend'), vol=metric(all,id,'volatility'); if([pe,mean,eg,dd,tr,vol].every(Number.isFinite)){const v=Math.round(valuation(pe,mean)),f=Math.round(growth(eg)),m=Math.round(condition(dd,tr)),r=Math.round(riskHealth(vol)),s=score(v,f,m,r);assets[id]={...assets[id],score:s,investment_status:status(s),valuation:v,fundamentals:f,market_condition:m,risk_health:r,model:'production-v1'};} }
const gold=assets.gold; if(gold?.components){const c=gold.components; const s=Math.round(c.real_yield*.30+c.usd*.20+c.price_position*.25+c.long_term_trend*.15+c.risk_health*.10);assets.gold={...gold,score:s,investment_status:status(s)};}
await save('data/market-snapshot.json',{...existing,generated_at:now(),model_version:'production-v1-frozen',assets});
console.log('Scores recalculated using frozen production formulas.');
