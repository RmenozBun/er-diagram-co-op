import { MongoMemoryServer } from 'mongodb-memory-server'
const t=Date.now()
try { const m = await MongoMemoryServer.create(); console.log('OK', m.getUri(), Date.now()-t,'ms'); await m.stop() } catch(e){ console.log('FAIL', e.message) }
