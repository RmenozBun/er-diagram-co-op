# ER Designer

เว็บออกแบบฐานข้อมูล / ER diagram แบบ real-time (แนว dbdiagram.io) รองรับ SQL และ MongoDB
แก้พร้อมกันได้หลายคน (ทดสอบแล้วสำหรับ 5-6 คน) ไม่มีฐานข้อมูล ไม่มีระบบ login

- **ซ้าย** เขียนโครงสร้างด้วย DSL → **ขวา** เห็น diagram ทันที ลากย้ายตารางได้ มี **autocomplete** ชนิดข้อมูลตามโหมด SQL/MongoDB (Ctrl+Space, Tab/Enter เพื่อยอมรับ)
- **Share** → ได้ลิงก์ห้อง ใครมีลิงก์เข้ามาแก้ด้วยกันได้ เห็น cursor/ชื่อของแต่ละคน
- **Save project file** (`.dbd.json`) / **Open project file** เพื่อทำงานต่อภายหลัง
- **Import** แยกเมนูชัดเจน: **SQL** (dump `.sql`, SQLite `.sqlite/.db`) · **MongoDB** (`mongoexport` `.json/.jsonl`) · **CSV / Excel** (เลือกได้ว่าจะนำเข้าเป็นตาราง SQL หรือ collection MongoDB; ถ้าเนื้อหาดูเป็นสไตล์ Mongo จะแนะนำให้อัตโนมัติ)
- **Export** แยกเมนูชัดเจน: **SQL** (PostgreSQL / MySQL / SQLite) · **MongoDB** (Mongoose models, mongosh validators) · ใช้ได้ทั้งสองโหมด (DSL, CSV, ZIP ต่อตาราง, รูป PNG / SVG) หัวข้อ SQL เป็นสีน้ำเงิน MongoDB เป็นสีเขียวทั้งในเมนูและหน้าต่าง
- สลับโหมด **SQL ↔ MongoDB** ตอนที่ในช่องแก้ไขยังเป็นตัวอย่างสำเร็จรูป ตัวอย่างจะเปลี่ยนตามโหมดให้เอง (ถ้าแก้อะไรไปแล้ว ระบบไม่แทนที่งานของคุณ)
- รองรับชื่อภาษาไทย/Unicode ทั้งใน DSL, CSV และชื่อ sheet
- งานถูก autosave ในเบราว์เซอร์ (IndexedDB) กันปิดแท็บพลาด

เอกสารอื่น: **[DEPLOY.md](DEPLOY.md)** คู่มือ deploy ฟรีแบบละเอียด · **[TEST-REPORT.md](TEST-REPORT.md)** ผลการทดสอบและข้อจำกัด

> sheet/CSV ที่หัวคอลัมน์เป็น `Field, Type` (อาจมี `Required`, `Description`, `Default` เพิ่ม และอยู่ใต้แถวหัวเรื่องได้) จะถูกอ่านเป็น "คำอธิบาย schema" ไม่ใช่ข้อมูล:
> `obj`→object, `array(obj)`→object[], `string (ref: X)` / `string (user)`→ความสัมพันธ์ไปตาราง X/USER, `id obj`→`_id objectid`, แถว `Note`→โน้ตของตาราง

## โครงสร้าง

```
apps/web      Vue 3 + Vite + Vuetify 3 (JavaScript)  -> deploy บน Vercel
apps/relay    Cloudflare Worker + Durable Object (Yjs relay, บันทึกห้องใน Durable Object 15 วัน)
packages/schema  parser DSL, generators (SQL/Mongo), importers  (+ unit test ด้วย Vitest)
scripts/      peer-smoke.mjs (เข้าห้องเป็นอีกคน), check-completions.mjs, smoke-ddl.mjs
tests-e2e/    สคริปต์และรายงานการทดสอบเชิงลึก (real-time, SQL, MongoDB, UI)
```

## รันในเครื่อง

```bash
npm install
npm run relay:dev   # relay ที่ http://localhost:8787
npm run dev         # เว็บที่ http://localhost:5173
npm test            # 62 unit tests (parser/generator/importer)
npm test -w apps/relay   # 8 tests การบันทึก/หมดอายุของห้อง
```

เปิดเว็บ → กด **Share** → เปิดลิงก์เดียวกันในอีกแท็บ/เครื่องเพื่อลองแก้พร้อมกัน

## Deploy (ฟรี)

ดูขั้นตอนละเอียดทีละขั้น (บัญชี, คำสั่ง, ตั้งค่า Vercel, ล็อก Origin, ขีดจำกัดฟรี, แก้ปัญหา) ที่ **[DEPLOY.md](DEPLOY.md)**
สรุปสั้น: `cd apps/relay && npx wrangler deploy` → ได้โฮสต์ `er-relay.<sub>.workers.dev` →
import repo เข้า Vercel (Root Directory เว้นว่าง) + ตั้ง env `VITE_RELAY_HOST=er-relay.<sub>.workers.dev`

> ห้องถูกบันทึกใน Durable Object ของ Cloudflare และลบเองเมื่อไม่มีใครเปิดเกิน 15 วัน (ตั้งค่าที่ `ROOM_TTL_DAYS`)
> นอกจากนี้แต่ละเบราว์เซอร์มีสำเนาใน IndexedDB และกด **Save project file** เก็บเป็นไฟล์ได้เสมอ

## ไวยากรณ์ DSL

```
Table users {
  id int [pk, increment]
  email varchar(255) [unique, not null]
  created_at timestamp [default: `now()`]   // `...` = expression, '...' = ข้อความ, 5 = ตัวเลข
  note text [note: 'free text']

  indexes {
    (email, created_at) [unique]
  }
}

Table posts {
  id int [pk]
  user_id int [ref: > users.id]      // inline relation
}

Ref: posts.user_id > users.id        // > many-to-one   < one-to-many   - one-to-one   <> many-to-many
Ref: lines.(o_region, o_number) > orders.(region, number)   // composite (multi-column) key: list the columns in ( )
```

ชื่อที่มีช่องว่างหรืออักขระพิเศษใส่เครื่องหมายคำพูดได้ (`"my table"`) ชื่อไทยพิมพ์ได้ตรงๆ รองรับคอมเมนต์ `// ...` และ `/* ... */`

**MongoDB**: ฟิลด์ที่มีชนิดเป็น "ชื่อตารางอื่น" = sub-document ฝังใน document (ใช้ `Name[]` สำหรับ array)
ตารางที่ใส่ `[embedded]` จะไม่ถูกสร้างเป็น collection แยก
pk ObjectId ที่ชื่อ `id` จะถูก export เป็น `_id` ให้อัตโนมัติ

```
Table orders {
  _id objectid [pk]
  user_id objectid                    // reference (ObjectId) ใช้ Ref: orders.user_id > users._id
  items OrderItem[]                   // embedded array
}
Table OrderItem [embedded] {
  sku string
  qty int
}
```

ชนิดข้อมูลที่รู้จักใน MongoDB: `string, int, long, double, decimal, bool, date, objectid, json/object, buffer` และ array ด้วย `[]`
