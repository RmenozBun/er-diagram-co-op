const fs=require('fs');
for (const f of ['a','b','b2','c','c_clean','d','e','f']) { const r=JSON.parse(fs.readFileSync(f+'.json')); const by={}; for (const x of r){ (by[x.area]??={p:0,t:0}); by[x.area].t++; if(x.pass) by[x.area].p++ } console.log(f, r.filter(x=>x.pass).length+'/'+r.length, JSON.stringify(by)) }
