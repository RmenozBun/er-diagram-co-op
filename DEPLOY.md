# คู่มือ Deploy ฟรี: Vercel (เว็บ) + Cloudflare Workers (relay)

ใช้เวลาประมาณ 20-30 นาทีถ้าเริ่มจากศูนย์ ไม่ต้องใช้บัตรเครดิตทั้งสองเจ้า

```
ผู้ใช้ 5-6 คน ──► เว็บ (Vercel, ไฟล์ static)
        │
        └─ WebSocket (wss://) ──► relay (Cloudflare Worker + Durable Object)  ← ส่งต่อการแก้ไขระหว่างคน และบันทึกห้องไว้ในที่เก็บข้อมูลของตัวเอง (ลบเองเมื่อไม่มีใครเปิดเกิน 15 วัน)
```

- **Vercel** ทำหน้าที่แค่ส่งไฟล์เว็บ (Vercel รัน WebSocket server ไม่ได้ จึงต้องมี Cloudflare)
- **Cloudflare Worker** คือตัวกลางส่งต่อข้อความ real-time หนึ่งห้อง = Durable Object หนึ่งตัว ห้องอยู่ในหน่วยความจำขณะมีคนใช้ และถูกบันทึกลงที่เก็บข้อมูล (storage) ของ Durable Object ตัวนั้นเอง
- ไม่มีฐานข้อมูลแยกต่างหาก: ห้องถูกเก็บใน Durable Object **15 วันนับจากครั้งสุดท้ายที่มีคนเปิด** (ปรับได้ที่ `ROOM_TTL_DAYS`) ห้องที่ยังไม่มีใครเขียนอะไรจะไม่ถูกบันทึก
- สำรองเพิ่มได้เสมอ: ไฟล์ `.dbd.json` (File > Save project file) และ autosave ในเบราว์เซอร์ของแต่ละคน

---

## 0. สิ่งที่ต้องมี

| ของที่ต้องมี | หมายเหตุ |
|---|---|
| บัญชี **GitHub** (ส่วนตัว) | Vercel แผน Hobby เชื่อมต่อได้เฉพาะ repo ที่เป็นของบัญชีส่วนตัว **ไม่รองรับ repo ที่อยู่ใต้ Organization** |
| บัญชี **Cloudflare** (ฟรี) | สมัครที่ https://dash.cloudflare.com/sign-up |
| บัญชี **Vercel** (Hobby, ฟรี) | สมัครด้วย GitHub ได้เลย https://vercel.com/signup แผน Hobby ใช้ส่วนตัว/ไม่ใช่เชิงพาณิชย์ ตรวจเงื่อนไขล่าสุดที่ https://vercel.com/docs/limits/fair-use-guidelines |
| **Node.js 20+** และ **Git** ในเครื่อง | ตรวจด้วย `node -v` และ `git --version` |

## 1. นำโค้ดขึ้น GitHub

สร้าง repo เปล่าบน GitHub (ตั้งเป็น Private หรือ Public ก็ได้ ห้ามอยู่ใต้ Organization) แล้วในโฟลเดอร์โปรเจกต์:

```bash
cd D:\collaborative_tool
git init
git add .
git commit -m "ER Designer"
git branch -M main
git remote add origin https://github.com/<ชื่อคุณ>/<ชื่อ-repo>.git
git push -u origin main
```

`.gitignore` ตั้งไว้แล้ว: ไม่อัป `node_modules`, `dist`, `.env` และ `tests-e2e/**/node_modules` (ที่หนักประมาณ 300 MB)

## 2. Deploy relay บน Cloudflare Workers

```bash
cd D:\collaborative_tool
npm install                      # ติดตั้ง dependency ทั้ง monorepo (ครั้งเดียว)
cd apps/relay
npx wrangler login               # เปิดเบราว์เซอร์ให้กด Allow
npx wrangler deploy
```

- ครั้งแรก wrangler จะถามให้ **ตั้งชื่อ workers.dev subdomain** (ชื่อต้องไม่ซ้ำใคร เช่น `somchai-er`)
- ผลลัพธ์จะบอก URL ประมาณ `https://er-relay.<subdomain>.workers.dev` **จดไว้** (ใช้ในขั้นที่ 3 โดยไม่ต้องมี `https://`)
- ถ้าต้องการเปลี่ยนชื่อ Worker แก้ `name = "er-relay"` ใน `apps/relay/wrangler.toml` ก่อน deploy

ทดสอบว่า relay ทำงาน:

```bash
curl https://er-relay.<subdomain>.workers.dev/
# ต้องได้: ER relay is running. Connect via /parties/document/<room>.
```

ทดสอบ WebSocket แบบเต็ม (สคริปต์นี้เข้าห้องเป็น "คนที่สอง" แล้วเพิ่ม `Table from_bot`):

```bash
cd D:\collaborative_tool
node scripts/peer-smoke.mjs test-room-001 er-relay.<subdomain>.workers.dev
# ต้องเห็น: synced, chars: ...
```

ดู log แบบสดของ relay (มีประโยชน์เวลาแก้ปัญหา): `cd apps/relay && npx wrangler tail`

## 3. Deploy เว็บบน Vercel

1. เข้า https://vercel.com/new แล้วเลือก **Import** repo ที่เพิ่งอัป
2. ตั้งค่า (ไฟล์ `vercel.json` ที่ root กำหนด Install/Build/Output ให้แล้ว หน้าจอควรขึ้นค่าตามนี้ ถ้าไม่ตรงให้แก้):

| ช่อง | ค่า |
|---|---|
| Framework Preset | **Other** |
| Root Directory | **เว้นว่าง** (คือ root ของ repo ห้ามชี้ไป `apps/web` เพราะต้องใช้แพ็กเกจ `packages/schema` ด้วย) |
| Install Command | `npm install` |
| Build Command | `npm run build` |
| Output Directory | `apps/web/dist` |

3. เปิด **Environment Variables** แล้วเพิ่ม:

| Name | Value | Environments |
|---|---|---|
| `VITE_RELAY_HOST` | `er-relay.<subdomain>.workers.dev` (ไม่ใส่ `https://` ไม่ใส่ `/`) | Production + Preview |

4. กด **Deploy** รอ 1-2 นาที จะได้ URL เช่น `https://er-designer.vercel.app`

> **สำคัญ:** ตัวแปร `VITE_*` ถูก "ฝัง" ในไฟล์เว็บตอน build ถ้าแก้ค่าทีหลังต้องกด **Redeploy** (Deployments > ... > Redeploy) ไม่งั้นเว็บยังใช้ค่าเก่า (ค่าเริ่มต้นคือ `localhost:8787` ซึ่งจะทำให้ห้องไม่เชื่อมต่อ)

## 4. ล็อก relay ให้รับเฉพาะเว็บของคุณ (แนะนำ)

ถ้าไม่ล็อก ใครรู้ URL ของ relay ก็เอาไปใช้กับเว็บของตัวเองได้ และกินโควตาฟรีของคุณ

แก้ `apps/relay/wrangler.toml`:

```toml
[vars]
ALLOWED_ORIGINS = "https://er-designer.vercel.app"
```

- ใส่หลาย origin ได้ คั่นด้วย comma เช่น `"https://er-designer.vercel.app,https://er.mycompany.com"`
- หน้าเว็บที่เปิดจาก `localhost` / `127.0.0.1` ผ่านเสมอ (ไว้พัฒนาในเครื่อง) ส่วนสคริปต์ที่ไม่ส่งหัว Origin เช่น `scripts/peer-smoke.mjs` จะถูกปฏิเสธ (403) เมื่อตั้งค่านี้ ให้ทดสอบผ่านหน้าเว็บแทน หรือเว้นค่าไว้ว่างชั่วคราว
- URL ตัวอย่างของ deployment แต่ละครั้งบน Vercel (ที่มีรหัสต่อท้าย) ไม่อยู่ในรายการ ใช้ได้เฉพาะ URL หลักที่ตั้งไว้ ถ้าต้องการให้ Preview ใช้ได้ ให้เพิ่ม URL นั้นเข้าไปในรายการ
- เว้นว่าง `""` = รับทุก origin (ค่าเริ่มต้น เหมาะตอนทดสอบ)
- หลังแก้ รัน `cd apps/relay && npx wrangler deploy` อีกครั้ง
- relay ตรวจรูปแบบ room id ให้เสมอ (4-64 ตัวอักษร a-z 0-9 - _) คำขอที่ไม่ตรงจะได้ HTTP 400

## 5. ทดสอบหลัง deploy (เช็กลิสต์)

- [ ] เปิด URL ของ Vercel เห็น diagram ตัวอย่าง ไม่มี error ใน Console (F12)
- [ ] กด **Share** แถบสถานะ (ชิปด้านบน) ต้องเป็น **Live** สีเขียว
- [ ] เปิดลิงก์ห้องบนมือถือหรืออีกเครื่อง พิมพ์ในเครื่องหนึ่ง อีกเครื่องต้องเห็นทันที และเห็นรูปอวาตาร์ของกันและกัน
- [ ] ลากตาราง อีกเครื่องเห็นตารางขยับ
- [ ] File > Import ลองไฟล์ `.xlsx` / `.csv` / `.sql` / `.sqlite` / `.json`
- [ ] Export > Image (PNG) แล้วเปิดดูรูป
- [ ] File > Save project file แล้ว Open กลับมา ได้ผลเหมือนเดิม
- [ ] (ถ้าตั้ง `ALLOWED_ORIGINS`) ทดสอบจาก URL ที่ไม่อยู่ในรายการ ต้องเชื่อมต่อไม่ได้

## 6. ขีดจำกัดของแผนฟรี และความจุที่คาดว่าจะรองรับได้

ตัวเลขจากเอกสารทางการ (ตรวจเมื่อ ต.ค. 2026 อาจเปลี่ยนได้ ดู https://developers.cloudflare.com/durable-objects/platform/pricing/ และ https://vercel.com/docs/limits):

| บริการ | ขีดจำกัดฟรี | ผลต่อเรา |
|---|---|---|
| Cloudflare Durable Objects (Workers Free) | **100,000 requests/วัน**, **13,000 GB-s duration/วัน**, SQLite storage 5 GB, เขียน **100,000 แถว/วัน**, อ่าน 5 ล้านแถว/วัน | WebSocket ขาเข้านับ **20 ข้อความ = 1 request** ส่วน duration นับตอนมีคนเชื่อมต่ออยู่ |
| Cloudflare | เกินโควตา = คำสั่งนั้น error จนถึง 00:00 UTC (07:00 เวลาไทย) | แอปไม่ล่มถาวร แค่ห้อง real-time ใช้ไม่ได้จนโควตารีเซ็ต |
| Vercel Hobby | deploy ได้ 100 ครั้ง/วัน และเว็บ static ไม่นับเป็น build function | ไม่เป็นปัญหา |

**ประมาณการใช้งานจริง** (คำนวณจากเอกสาร ไม่ได้วัดบน Cloudflare จริง):

- ห้อง 1 ห้องที่มีคนเปิดอยู่ 8 ชั่วโมง ใช้ duration ประมาณ 8 × 3600 × 0.128 GB ≈ **3,700 GB-s** (ราว 28% ของโควตา) ดังนั้นรองรับประมาณ **3 ห้องที่ใช้งานเต็มวัน** ต่อวัน
- คน 6 คนพิมพ์ต่อเนื่อง 3 ครั้ง/วินาที 8 ชั่วโมง ≈ 518,000 ข้อความ ÷ 20 ≈ **26,000 requests** (ราว 26%) ซึ่งเป็นกรณีหนักสุด การใช้งานจริงน้อยกว่านี้มาก
- **การบันทึกห้อง:** บันทึกหลังหยุดพิมพ์ 3 วินาที (อย่างช้า 15 วินาทีระหว่างพิมพ์ต่อเนื่อง) และทันทีเมื่อคนสุดท้ายออก แต่ละครั้งเขียนประมาณ 2 แถว (ห้องใหญ่ราว 370 KB เขียน 7 แถว) กรณีหนักสุดพิมพ์ต่อเนื่อง 8 ชั่วโมง ≈ 9,600 ครั้ง ≈ 19,200 แถว (ราว 19% ของโควตาเขียน) ถ้าโควตาเขียนหมด ห้องยังทำงาน real-time ต่อได้ แต่จะไม่ถูกบันทึกจนโควตารีเซ็ต (ประมาณการจากเอกสาร ไม่ได้วัดบน Cloudflare จริง)
- เพื่อประหยัด duration เว็บจะ **ตัดการเชื่อมต่ออัตโนมัติเมื่อแท็บถูกซ่อนเกิน 10 นาที** และต่อใหม่เองเมื่อกลับมาเปิดแท็บ (งานไม่หาย เพราะ sync กลับจากเครื่องของทุกคน)
- ผลทดสอบกับ relay ในเครื่อง (ไม่ใช่ Cloudflare จริง): 6 คนพร้อมกันหนักสุด latency p95 ≈ 4 ms, 10 คน ≈ 9 ms, 20 คนเริ่มช้า (p95 ≈ 250 ms) ดูรายละเอียดใน [TEST-REPORT.md](TEST-REPORT.md) บนอินเทอร์เน็ตจริงให้บวก RTT ของเครือข่าย (ประมาณ 30-150 ms ต่อทิศ ขึ้นกับที่อยู่ผู้ใช้) ซึ่งเป็นการประมาณ ไม่ใช่ตัวเลขที่วัดได้

## 7. อัปเดตเวอร์ชันภายหลัง

| สิ่งที่แก้ | วิธี |
|---|---|
| โค้ดเว็บ (`apps/web`, `packages/schema`) | `git push` Vercel จะ build และ deploy ใหม่เอง |
| โค้ด relay (`apps/relay`) | `cd apps/relay && npx wrangler deploy` (หรือตั้ง GitHub Actions ด้านล่าง) |
| ค่า `VITE_RELAY_HOST` | แก้ใน Vercel > Settings > Environment Variables แล้ว Redeploy |
| ค่า `ALLOWED_ORIGINS` | แก้ `wrangler.toml` แล้ว `npx wrangler deploy` |
| อายุห้อง `ROOM_TTL_DAYS` (ค่าเริ่มต้น 15) และความถี่ตรวจห้องหมดอายุ `ROOM_SWEEP_HOURS` (ค่าเริ่มต้น 24) | แก้ `wrangler.toml` แล้ว `npx wrangler deploy` |

ตัวอย่าง GitHub Actions สำหรับ deploy relay อัตโนมัติ (ไม่บังคับ) สร้าง `.github/workflows/relay.yml`:

```yaml
name: deploy-relay
on:
  push:
    branches: [main]
    paths: ['apps/relay/**']
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm install
      - run: npx wrangler deploy
        working-directory: apps/relay
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

สร้าง API token ที่ Cloudflare Dashboard > My Profile > API Tokens (template "Edit Cloudflare Workers") แล้วใส่เป็น Secret ชื่อ `CLOUDFLARE_API_TOKEN` ใน GitHub repo

## 8. แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| ชิปค้างที่ "Connecting…" หรือ "Offline" | `VITE_RELAY_HOST` ผิดหรือไม่ได้ตั้ง (ยังเป็น localhost) ตรวจใน Vercel แล้ว **Redeploy** ลองเปิด `https://<relay-host>/` ในเบราว์เซอร์ต้องเห็นข้อความ "ER relay is running" |
| Console ขึ้น `403` / "Origin not allowed" | `ALLOWED_ORIGINS` ไม่มี URL ที่คุณใช้อยู่ (ระวัง `www.`, `http` กับ `https`, ไม่มี `/` ท้าย) |
| Console ขึ้น `400` / "Invalid room id" | ลิงก์ห้องถูกแก้ไข room id ต้องยาว 4-64 ตัวอักษร a-z 0-9 - _ |
| Build ที่ Vercel ล้มด้วย `Cannot find module '@er/schema'` | ตั้ง Root Directory ผิด ต้อง **เว้นว่าง** (root ของ repo) |
| Build ล้มเพราะ Node เก่า | Vercel > Settings > General > Node.js Version เลือก 20.x หรือ 22.x |
| `wrangler deploy` ถามล็อกอินวน / ไม่มี workers.dev subdomain | รัน `npx wrangler login` อีกครั้ง และทำขั้นตอนลงทะเบียน subdomain ให้เสร็จ (หรือไปที่ Dashboard > Workers & Pages) |
| `wrangler deploy` error เรื่อง migrations / Durable Object | อย่าเปลี่ยนชื่อ class `Document` หลัง deploy ครั้งแรก ถ้าต้องเปลี่ยนต้องเพิ่ม migration ใหม่ใน `wrangler.toml` |
| ห้องว่างเปล่าตอนเปิดลิงก์ | ห้องถูกลบเพราะไม่มีใครเปิดเกิน 15 วัน (หรือลิงก์นั้นไม่เคยมีใครเขียนอะไร ห้องว่างไม่ถูกบันทึก) คนที่เคยเปิดห้องนี้ในเบราว์เซอร์เดิมจะได้เนื้อหาคืนจาก autosave (IndexedDB) และเนื้อหานั้นจะถูกส่งกลับขึ้นห้องให้เองเมื่อเปิดลิงก์ ส่วนเครื่องอื่นใช้ **File > Open project file** |
| Export รูปค้าง / ขึ้น "timed out" | ต้องเปิดแท็บค้างไว้ที่หน้านั้นระหว่าง export (เบราว์เซอร์หยุดวาดหน้าที่ถูกซ่อน) |
| ผู้ใช้ที่ปิดเครื่องไปแล้วยังโชว์ในรายชื่อ | หายเองภายใน ~45 วินาที (เว็บตรวจและลบคนที่เงียบไป) |
| โควตา Cloudflare หมดกลางวัน | ดูการใช้งานที่ Dashboard > Workers & Pages > er-relay > Metrics ลดจำนวนห้องที่เปิดค้าง หรืออัปเกรดเป็น Workers Paid ($5/เดือน) |

## 9. ความปลอดภัยและข้อควรระวัง

- **ไม่มีระบบ login:** ใครมีลิงก์ห้องก็แก้ได้ ลิงก์ห้องสุ่ม 12 ตัวอักษร (ประมาณ 62 บิต) เดายาก แต่อย่าโพสต์ลิงก์ในที่สาธารณะ
- **ข้อมูลห้องถูกเก็บไว้ในบัญชี Cloudflare ของคุณ 15 วัน** (ไม่ได้เข้ารหัสฝั่งเรา) ใครมีลิงก์ยังเปิดห้องได้จนกว่าจะหมดอายุ ยังไม่มีปุ่มลบห้องทีละห้อง ถ้าต้องการให้ข้อมูลหายเร็วขึ้นให้ลด `ROOM_TTL_DAYS` แล้ว deploy ใหม่ (มีผลกับทุกห้อง) การหมดอายุลบเฉพาะสำเนาบนเซิร์ฟเวอร์ ส่วนสำเนาใน autosave ของเบราว์เซอร์แต่ละคนยังอยู่ และจะถูกส่งกลับขึ้นห้องถ้าเขาเปิดลิงก์เดิม
- ห้ามใส่ข้อมูลลับ (รหัสผ่านจริง, ข้อมูลลูกค้า) ลงใน diagram/note ที่แชร์ผ่านลิงก์ เพราะข้อความผ่านเซิร์ฟเวอร์ของ Cloudflare
- การ Import ไฟล์ `.sql` / `.sqlite` / `.xlsx` ทำในเบราว์เซอร์ของคุณ ไฟล์ไม่ถูกอัปโหลดไปไหน (มีเพียงผลลัพธ์ที่เป็นข้อความ DSL เท่านั้นที่ถูกซิงก์เมื่ออยู่ในห้อง)

## 10. ถ้าโควตาฟรีไม่พอหรืออยากย้าย

- **เว็บ:** ใช้ Cloudflare Pages, Netlify หรือ GitHub Pages แทน Vercel ได้ (เป็นไฟล์ static: build ด้วย `npm run build` แล้วเสิร์ฟโฟลเดอร์ `apps/web/dist` อย่าลืมตั้ง `VITE_RELAY_HOST` ตอน build)
- **relay:** รัน Node.js ธรรมดาบน VPS/Render/Fly.io ด้วย `y-websocket` server ก็ได้ (โปรโตคอลฝั่ง client เป็น Yjs WebSocket ที่เข้ากันได้) แต่ต้องปรับ `collab.js` ให้ชี้ provider ไปที่ URL ใหม่
- **Workers Paid ($5/เดือน):** โควตาสูงขึ้นมากและเหมาะถ้ามีหลายทีมใช้พร้อมกัน
