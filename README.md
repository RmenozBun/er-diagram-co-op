# ER Designer

เว็บออกแบบฐานข้อมูล / ER diagram แบบ real-time (แนว dbdiagram.io) รองรับ SQL และ MongoDB
แก้พร้อมกันได้หลายคน (ทดสอบแล้วสำหรับ 5-6 คน) ไม่มีฐานข้อมูล ไม่มีระบบ login

- **ซ้าย** เขียนโครงสร้าง → **ขวา** เห็น diagram ทันที ลากย้ายตารางได้ โหมด **SQL** เขียนด้วย DSL (แนว dbdiagram.io) โหมด **MongoDB** เขียนเป็น `Model User { ... }` เนื้อในแบบ Mongoose (`mongoose.Schema`) มี **autocomplete** ตามโหมด (Ctrl+Space, Tab/Enter เพื่อยอมรับ)
- **Data flow (PK → FK):** ลูกศรที่เส้นชี้ไปที่ฝั่งที่ "ใช้" key (FK หรือ sub-document) ฟิลด์ FK มีป้าย `FK` และมีจุดเคลื่อนที่จาก key ไปยังตารางที่ใช้ (เปิด/ปิดได้ที่สวิตช์ **Data flow**) คลิกตารางเพื่อไฮไลต์ว่า key ของมัน **ไหลไปที่ตาราง/model ไหนบ้าง** (ต่อเป็นทอดๆ เช่น users → orders → order_items) และมันใช้ key ของตารางไหน พร้อมรายการในแผงซ้ายบน (คลิกชื่อเพื่อกระโดดไปตารางนั้น) ใช้ได้ทั้ง SQL และ MongoDB (`ref` กับ sub-document) รูป PNG/SVG ที่ export จะไม่มีไฮไลต์หรือจุดเคลื่อนที่ แต่มีลูกศรและป้าย FK
- **Share** → ได้ลิงก์ห้อง ใครมีลิงก์เข้ามาแก้ด้วยกันได้ เห็น cursor/ชื่อของแต่ละคน
- **Save project file** (`.dbd.json`) / **Open project file** เพื่อทำงานต่อภายหลัง
- **Import** แยกเมนูชัดเจน: **SQL** (dump `.sql`, SQLite `.sqlite/.db`) · **MongoDB** (ไฟล์ model Mongoose `.js`, validator `$jsonSchema` `.json`, ข้อมูล `mongoexport` `.json/.jsonl`) · **CSV / Excel** (เลือกได้ว่าจะนำเข้าเป็นตาราง SQL หรือ collection MongoDB; ถ้าเนื้อหาดูเป็นสไตล์ Mongo จะแนะนำให้อัตโนมัติ)
- **Export** แยกเมนูชัดเจน: **SQL** (PostgreSQL / MySQL / SQLite) · **MongoDB** (Mongoose models, Validator JSON, สคริปต์ mongosh) · ใช้ได้ทั้งสองโหมด (DSL, **DBML สำหรับ dbdiagram.io**, CSV, ZIP ต่อตาราง, รูป PNG / SVG) ในโหมด MongoDB, DSL / DBML / SQL จะแปลงเป็นชนิดของ SQL ให้ (ObjectId → `varchar(24)`, sub-document → คอลัมน์ `jsonb`, default ที่เป็นฟังก์ชัน JS ไปอยู่ใน note) หัวข้อ SQL เป็นสีน้ำเงิน MongoDB เป็นสีเขียวทั้งในเมนูและหน้าต่าง
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
npm test            # 108 unit tests (parser/generator/importer, Mongoose + รูปแบบย่อ Model { })
npm test -w apps/relay   # 11 tests การบันทึก/หมดอายุของห้อง และการล็อก Origin
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

**โหมด MongoDB เขียนเป็นรูปแบบย่อ `Model Name { ... }`** เนื้อในเขียนเหมือน `mongoose.Schema` แต่ไม่ต้องมี `import`, `mongoose.model(...)`, `export` (เว็บใส่ให้ตอน export):

```js
Model User {
  login: { type: String, required: true, unique: true }
  role: { type: String, enum: ["member", "admin"], default: "member" }
  partnerId: { type: mongoose.Schema.Types.ObjectId, ref: "PartnerModel", default: null }
  address: { street: String, city: String }          // sub-document
  certificates: { type: [{ kind: { type: String, required: true } }], default: [] }
}

Model People [collection: "people"] {                 // ชื่อ collection ปกติ = ชื่อ model เป็นพหูพจน์ (User -> users)
  name: String
}

Schema addressSchema {                                // sub-schema ที่ field อื่นใช้เป็นชนิดได้: home: addressSchema
  street: String
}
```

- ใส่ `,` ท้ายบรรทัดหรือไม่ใส่ก็ได้ (หนึ่ง field ต่อบรรทัด) ภายในเขียนได้ทุกอย่างที่ Mongoose รองรับ
- **Export > Mongoose models** → ได้ไฟล์เต็ม: `import mongoose`, `new mongoose.Schema(...)`, `mongoose.model("UserModel", usersSchema, "users")`, `export` (เลือก ES modules / CommonJS ได้)
- **Import ไฟล์ model (.js)** → ช่องแก้ไขแสดงเฉพาะ field ส่วนที่เหลือ (import อื่น, options ของ schema เช่น `timestamps`, hooks `schema.pre(...)`, methods, helper) เว็บเก็บไว้เบื้องหลัง (ในห้อง/ไฟล์โปรเจกต์ด้วย) แล้วใส่กลับตอน export diagram สร้างจากโค้ดด้วยตัวอ่าน JavaScript จริง (acorn) รองรับ ESM/CommonJS, `new Schema` / `mongoose.Schema`, sub-schema, object ซ้อน, array ของ sub-document, `ref`, `enum`, `index`, `timestamps`, `_id: false`
- **Import validator JSON (`$jsonSchema`)** เช่น `users_collection_validator.json` และ **ข้อมูล mongoexport** → แปลงเป็น `Model ...`
- **Export** อื่นๆ: Validator JSON (`users_collection_validator.json`), สคริปต์ mongosh
- สลับ SQL ↔ MongoDB ตอนที่มีงานของคุณ: ข้อความจะถูกแปลง (มีหน้าต่างยืนยัน) ตาราง/ฟิลด์/คีย์/ความสัมพันธ์คงอยู่ แต่คอมเมนต์ hooks และ methods ไม่ถูกส่งต่อ
- **Autocomplete:** `Model` / `Schema` (Ctrl+Space), template ของ field บรรทัดใหม่ (email, password, enum, reference, tags, sub-document, createdAt ...), ชนิดแบบสั้นหลัง `name:` และหลัง `type:`, ตัวเลือก (`required`, `unique`, `match`, `validate`, ... ไม่เสนอซ้ำตัวที่ใส่แล้ว), ค่าของ option (`true/false`, `default`, `enum`), ชื่อ model ใน `ref: ""`
- ชื่อที่เว็บตั้งให้ตอน export: `Model User` → collection `users`, `usersSchema`, `"UserModel"` (ถ้า import มาจากไฟล์ที่ตั้งชื่ออื่น จะใช้ชื่อเดิมของไฟล์); pk ObjectId ที่ชื่อ `id` จะเป็น `_id` อัตโนมัติ
- ข้อจำกัด: options ของ schema (เช่น `timestamps`, `toJSON`) แก้ในหน้าเว็บไม่ได้ ใช้ค่าจากไฟล์ที่ import หรือค่าเริ่มต้น `{ timestamps: false, versionKey: false }`; ห้อง/ไฟล์โปรเจกต์ที่บันทึกไว้เป็นไฟล์ Mongoose เต็ม (เวอร์ชันก่อน) จะแปลงเป็นรูปแบบย่อให้เองเมื่อเปิดในเบราว์เซอร์ (ห้องที่แชร์ไว้ยังอ่านได้ แต่ยังแสดงเป็นโค้ดเต็มจนกว่าจะ import ใหม่)

ใน SQL mode ยังใช้ DSL ตามเดิม (ด้านบน) และฟิลด์รองรับ `enum: ['a', 'b']` (export เป็น `check` constraint)
