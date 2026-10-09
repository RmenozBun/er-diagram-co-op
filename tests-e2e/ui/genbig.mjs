import fs from 'fs'
const out=['id,name,email,score,created\n']
for(let i=0;i<110000;i++)out.push(`${i},user number ${i},user${i}@example.com,${i*1.5},2024-01-01T00:00:00Z\n`)
fs.writeFileSync(process.argv[2],out.join(''))
