# รายงานผลการทดสอบ ER Designer

วันที่ทดสอบ: 8 ต.ค. 2026 · แบ่งการทดสอบเป็น 4 ทางที่รันพร้อมกัน แล้วแก้บั๊กและรันซ้ำ

| ทางทดสอบ | ทำอะไร | รายงานฉบับเต็ม |
|---|---|---|
| **Real-time / โหลด** | บอต Node จำลองผู้ใช้ 2-40 คนต่อ relay (Cloudflare workerd ในเครื่อง) วัด latency, ความสอดคล้อง, reconnect, restart, soak | [realtime.md](tests-e2e/results/realtime.md) |
| **SQL** | import (CSV, dump ของ PostgreSQL/MySQL/SQLite, ไฟล์ SQLite) และ export ที่ **รันโค้ดจริง** ใน PostgreSQL (PGlite) และ SQLite (sql.js) ส่วน MySQL ตรวจด้วย parser + กฎ (ไม่มี server จริง) | [sql.md](tests-e2e/results/sql.md) |
| **MongoDB** | import (`mongoexport`, ไฟล์ xlsx จริงของคุณ) และ export โดย `require()` Mongoose จริง และรัน validator บน **MongoDB 8.2.6 จริง** | [mongo.md](tests-e2e/results/mongo.md) |
| **UI ในเบราว์เซอร์** | autocomplete, import/export ทุกแบบ, แชร์ห้อง, project file, dark mode, ขนาดจอ 375-1280 px | [ui.md](tests-e2e/results/ui.md) |

## สรุปผลหลัก

**เหมาะกับ 5-6 คนอย่างสบาย** ทุกการรันที่ ≤ 20 คน ข้อมูลของทุกเครื่องตรงกันทุกไบต์ ไม่มีข้อความหาย ไม่มีข้อความซ้ำ แม้หลังแก้ไขตอนออฟไลน์หรือหลังรีสตาร์ต relay (วัดบน relay ในเครื่อง ไม่ใช่ Cloudflare จริง)

| ผู้ใช้พร้อมกัน (ทุกคนพิมพ์ 3 ครั้ง/วินาที + ลากตาราง 10 ครั้ง/วินาที) | latency p50 / p95 / p99 / max (ms) | ผล |
|---|---|---|
| 2 | 1 / 2 / 3 / 3 | ผ่าน |
| **6** | **1-2 / 4 / 6 / 11** | **ผ่าน (กรณีหนักสุดของเป้าหมาย 5-6 คน)** |
| 10 | 2 / 9 / 21 / 30 | ผ่าน |
| 20 | 57 / 229 / 276 / 421 | ข้อมูลตรงกัน แต่เริ่มช้า |
| 40 | ช้าหลายวินาทีถึงหลายสิบวินาที | relay อิ่มตัว ไม่แนะนำ |

- ผู้ใช้เข้าห้องใหม่ที่มี 200 ตาราง (4,800 บรรทัด) ได้ข้อมูลครบใน 14-17 ms (คนเดียว) / 58 ms (6 คนพร้อมกัน)
- รีสตาร์ต relay ตอนมี 5 คนเชื่อมต่อ: ทุกคนกลับมาซิงก์ภายใน 3.7 วินาที ข้อมูลคืนครบจากเครื่องผู้ใช้ ไม่มีข้อความซ้ำ
- 2 ห้องพร้อมกันไม่ปนกัน, อวาตาร์ของ 6 คนเห็นครบภายใน 27 ms, soak 3 นาที 0 error 0 การเชื่อมต่อหลุด
- **ตัวเลขทั้งหมดวัดบน relay ในเครื่อง ไม่มีค่าหน่วงของเครือข่าย** บนอินเทอร์เน็ตจริงต้องบวก RTT (ประมาณการ 30-150 ms ต่อทิศ ขึ้นกับที่ตั้ง) นี่คือการประมาณ ไม่ได้วัด

## ผลก่อน → หลังแก้ (รันสคริปต์ชุดเดิมของ agent ซ้ำกับโค้ดที่แก้แล้ว)

| ด้าน | ก่อนแก้ | หลังแก้ |
|---|---|---|
| SQL: parser/DSL | 64/88 | 75/88 |
| SQL: generator (SQLite + PostgreSQL จริง + MySQL ตามกฎ) | 151/210 | 189/219 |
| SQL: ชนิดข้อมูล + ค่า default (22 ชนิด × 3 dialect และอื่นๆ) | ส่วนใหญ่ผ่าน, `blob`/default แบบ expression พัง | 261/271 |
| SQL: import dump / edge cases | pg_dump ดิบ 21/35, mysqldump ดิบ 19/35 (เหลือ 1 จาก 5 ตาราง) | 133/142 |
| SQL: round trip DSL→PG→DSL | 70/77 | 73/77 |
| SQL: CSV | 25/28, 52/59, 14/19 และล้มที่ ≥125,000 แถว | 108/116 และไม่ล้ม (ทดสอบ 300,000 แถว) |
| Mongo: import | 99/125 | 120/125 |
| Mongo: spec sheet / xlsx | 73/105 | 101/105 |
| Mongo: Mongoose (compile + validate จริง) | 104/127 | 123/127 |
| Mongo: validator บน mongod จริง | 42/56 | 49/56 |
| Mongo: autocomplete | 39/49 | 47/49 |
| Mongo: round trip | 45/61 | 59/61 |
| Unit test ของโปรเจกต์ | 17 | **62 ผ่านทั้งหมด** (รวม fuzz round-trip 300 schema สุ่ม และ FK หลายคอลัมน์) + 8 ข้อของการบันทึกห้องใน relay |

ตัวเลขที่ยัง "ไม่ผ่าน" ส่วนใหญ่เป็นของที่ตั้งใจ (เช่น สคริปต์เดิมคาดว่า `timestamp without time zone` ต้องคงเดิม แต่เราจัดรูปให้เป็น `timestamp` โดยเจตนา), เป็นการทดสอบใส่ข้อมูลผิด (ตารางชื่อซ้ำ, FK ไปคอลัมน์ที่ไม่ unique) หรือเป็นข้อจำกัดของ MongoDB เอง (ชื่อ collection มี `$`, เกิน 64 index)

## บั๊กที่พบและแก้แล้ว

| # | บั๊ก | ระดับ | แก้อย่างไร |
|---|---|---|---|
| 1 | import SQL dump พังเมื่อมี `--`, `/* */`, `\'` ในค่า string (mysqldump จริงเหลือ 1 จาก 5 ตาราง) | blocker | เขียนตัวแยกคำสั่งใหม่ที่เข้าใจ string/`E'..'`/`$$..$$`/คอมเมนต์ และข้าม `COPY ... FROM stdin` |
| 2 | export SQLite ทิ้ง foreign key ทั้งหมด และ `default now()` ใช้ไม่ได้ | major | ใส่ FK เป็น constraint ใน `create table`, 1:1 ได้ UNIQUE, `now()`→`current_timestamp` (ทดสอบรันใน SQLite จริงว่า FK บังคับใช้) |
| 3 | ค่า default แบบ expression ถูกใส่เป็น string (`'gen_random_uuid()'`) และ string `'007'`/`'null'` เพี้ยน | major | เก็บชนิดของ default (expression / string / literal) ตลอดทาง parse→serialize→SQL→Mongoose |
| 4 | `serialize`↔`parse` ไม่ย้อนกลับกัน (เครื่องหมาย `'`, ขึ้นบรรทัดใหม่, `]`, `"`, ชื่อแปลกใน `Ref:`/index) | major | รองรับ escape ครบ, quote ชื่อในทุกบรรทัด, ทดสอบด้วย fuzz 300 schema สุ่ม ผ่านทั้งหมด |
| 5 | **ภาษาไทย/Unicode:** DSL ปฏิเสธชื่อไทย, CSV/ชื่อ sheet ภาษาไทยกลายเป็น `column`/`table` | major | ใช้ regex Unicode (`\p{L}\p{M}\p{N}`) สระและวรรณยุกต์ไทยเป็นกลุ่ม Mark จึงต้องรวมด้วย (พบตอนทดสอบซ้ำ: "ชื่อ" ยังไม่ผ่านจนเพิ่ม `\p{M}`) |
| 6 | import: `bigserial`→`bigbigint`, `CONSTRAINT x CHECK` กลายเป็นคอลัมน์ปลอม, ตารางชื่อมีช่องว่างหาย, `ALTER ... ADD UNIQUE`/`nextval`/`COMMENT` ถูกเมิน, index มี `DESC`/`COLLATE`, FK ซ้ำ | major | เขียน `ddl.js` ใหม่ทั้งไฟล์ |
| 7 | CSV: ล้มที่ ≥125,000 แถว, int ปน ทศนิยม→varchar, ปี/เดือน/วันที่ไม่ถูกต้องผ่านเป็น date, `float` ความแม่นยำต่ำ | major | อ่านรอบเดียว (ไม่ spread), ตรวจวันที่จริง, int+ทศนิยม→`double`, boolean yes/no |
| 8 | Mongo validator (mongosh) ปฏิเสธข้อมูลปกติบน MongoDB จริง (ค่าเต็มใน double, `null`, unique บนฟิลด์ไม่บังคับชนกัน) | major | ชนิดตัวเลขใช้ `number`, ฟิลด์ไม่บังคับรับ `null`, unique บนฟิลด์ไม่บังคับเป็น sparse, ไม่สร้าง index ซ้ำ |
| 9 | Mongoose ที่ export โหลดไม่ได้เมื่อชื่อตารางพิเศษ (`user`+`User`, `a-b`, ขึ้นต้นตัวเลข, `schema`, `number`) | major | ตั้งชื่อ identifier ใหม่ให้ไม่ซ้ำ/ไม่ชนคำสงวน และ quote ทุก string |
| 10 | ตัวอ่าน spec sheet: ชื่อ sheet ไทยกลายเป็น `table`, ชื่อซ้ำ, `array(string) (ref: X)` ผิด, คอลัมน์ Required/Description/Default ถูกทิ้ง, header ที่ไม่อยู่แถวแรก, sheet ที่ซ่อนอยู่ | major | เขียน `spec.js` ใหม่ |
| 11 | อนุมานชนิดจาก `mongoexport` เพี้ยน (`$numberLong`→int, string ที่หน้าตาเหมือนวันที่ถูกตีเป็น date, ฟิลด์ที่เป็น array บางเอกสารถูกตีเป็น array ทั้งหมด) | major | แมป Extended JSON ถูกต้อง, string ยังเป็น string |
| 12 | PNG/SVG export เพี้ยน/ว่างเปล่าตามตำแหน่ง pan/zoom | major | ยกเลิก transform ของ pane ชั่วคราวตอน capture (ทดสอบ: ภาพเหมือนกันเป๊ะก่อน/หลังซูม) และมี timeout + ข้อความ |
| 13 | "Leave room (keep a local copy)" ไม่คัดลอกเนื้อหาห้อง | major | คัดลอกเนื้อหาห้องเป็น diagram ในเครื่อง (ทดสอบแล้ว) |
| 14 | หน้าเว็บยืดสูงเมื่อโค้ดยาว ทำให้ diagram หลุดจอ (พบจากไฟล์โรงเรียนของคุณ) | major | จำกัดพื้นที่ทำงานเท่าความสูงจอ |
| 15 | real-time: ข้อความ cursor ทำให้ relay หนักที่ผู้ใช้ 20+ คน | major (ไม่กระทบ 5-6 คน) | จำกัดการส่งตำแหน่ง cursor ≤ 10 ครั้ง/วินาที (ทดสอบ: 50 การขยับ → 6 ข้อความ) |
| 16 | real-time: ผู้ใช้ที่สัญญาณหายเงียบๆ ค้างเป็น "ผี" เกิน 150 วินาที | major | heartbeat ทุก 15 วินาที + ลบคนที่เงียบเกิน 45 วินาที (ทดสอบในหน้าเว็บ ลบใน ~5 วินาทีหลังหมดเวลา) |
| 17 | `bigint`/`CONSTRAINT`/`id` pk เดาผิด, ชื่อไฟล์ CSV ซ้ำ/มีอักขระต้องห้าม, สูตร `=...` ใน CSV | minor | แก้ครบ |
| 18 | UX เล็กๆ: Ref ที่ผิดรายงานบรรทัด 1 เสมอ, app bar ทับกันที่ 375 px, ปุ่มไอคอนไม่มีป้ายกำกับ, Tab ไม่ยอมรับคำแนะนำ, room id ผิดรูปแบบเงียบ, สีโค้ดใน dark mode ตัดกันน้อย, `useVueFlow` เตือนซ้ำ | minor | แก้ทั้งหมด (รายงานบรรทัดถูกต้อง, ปุ่มมี aria-label, Tab รับคำแนะนำ, แจ้งเตือน room id, สีโค้ดปรับตามธีม) |
| 19 | autocomplete: `string[` เสนอ settings แทนชนิด, ชื่อไทยไม่มีคำแนะนำ, `//` ใน string ถูกตีเป็นคอมเมนต์ | minor | แก้แล้ว (ทดสอบ 44/44 ในชุด autocomplete) |

เพิ่มจากที่ผู้ใช้ขอ: `id`→`_id` ตอน import และ export, autocomplete ชนิดข้อมูลตามโหมด SQL/Mongo, relay ตรวจรูปแบบ room id และจำกัด Origin ได้ (`ALLOWED_ORIGINS`) ทดสอบแล้วว่า origin ที่ไม่อยู่ในรายการถูกปฏิเสธ

## ข้อจำกัดที่ยังเหลือ (ไม่ได้แก้ หรือแก้ไม่ได้)

- **ความจุ:** relay หนักเมื่อมีผู้ใช้ ≥ 20 คนในห้องเดียว (cursor ยังเป็นภาระ แม้จำกัดฝั่ง client แล้ว) ถ้าต้องรองรับมากกว่านี้ต้องแก้ที่ `y-partyserver` ฝั่ง server (ไม่ส่ง awareness กลับหาผู้ส่ง, รวบ awareness เป็นชุด)
- **ไม่ได้ทดสอบบน Cloudflare จริง** (ต้องล็อกอินบัญชีของคุณ): ทดสอบบน workerd ในเครื่อง ผล `wrangler deploy --dry-run` ผ่าน (bundle ~66 KiB gzip) ผู้ใช้ผีผ่านการจำลองในหน้าเว็บ ไม่ใช่การตัดสาย TCP จริง
- **การเก็บห้องถาวร (เพิ่มภายหลัง):** ห้องถูกบันทึกใน Durable Object 15 วัน แต่ยังไม่มีปุ่มลบห้องทีละห้อง และยังไม่ได้ทดสอบโควตาเขียน 100,000 แถว/วันบน Cloudflare จริง (ประมาณการไว้ ~19%) ดูหัวข้อ "การบันทึกห้อง" ด้านล่าง
- **MySQL** ตรวจด้วย parser และกฎเท่านั้น ไม่ได้รันบน MySQL จริง
- FK หลายคอลัมน์ (composite): import, export SQL ทุก dialect และ round trip ใช้ได้ครบแล้ว (เขียนใน DSL เป็น `Ref: a.(x, y) > b.(p, q)`) ยกเว้นความสัมพันธ์ many-to-many แบบหลายคอลัมน์ และ Mongo ที่ใช้เฉพาะคอลัมน์แรกเป็น ObjectId ref
- DSL ยังไม่รองรับ `Table schema.name {` และ `int[pk]` (ไม่มีช่องว่างก่อน `[`) การปิดเครื่องหมายคำพูดไม่ครบยังไม่แจ้ง error
- Mongoose: ฟิลด์ชื่อ `schema` ทำให้ model พัง (ข้อจำกัดของ Mongoose, generator ใส่ WARNING ให้), ฟิลด์ `__proto__` หาย, ชื่อ collection มี `$`/ขึ้นต้น `system.` MongoDB ปฏิเสธ (ใส่ WARNING ให้)
- spec sheet ที่มีแต่ชนิดพื้นฐาน (string/int/date) จะไม่สลับโหมดเป็น MongoDB ให้เอง
- diagram ที่เป็นโซ่ยาว 150 ตารางจัดวางเป็นแถบยาว และ PNG ถูกลดความละเอียดตามขีดจำกัด canvas 16,384 px ของเบราว์เซอร์
- export รูปจากแท็บที่ถูกซ่อนจะหมดเวลา (เบราว์เซอร์หยุดวาด) ขึ้นข้อความให้เปิดแท็บแล้วลองใหม่
- `y-partyserver`: `provider.disconnect()` แล้ว `connect()` ไม่ซิงก์ (relay ไม่ตอบ close ที่ไม่มีรหัส) เว็บไม่ได้ใช้เส้นทางนี้ (ใช้ `close(1000)` แทนในโหมดพักการเชื่อมต่อ)
- ยังไม่ได้ทดสอบ: การคัดลอกลิงก์ลง clipboard (เบราว์เซอร์ทดสอบไม่ให้สิทธิ์), ชิป "Offline" เมื่อสาย relay ขาดกระทันหัน

## การบันทึกห้อง (Durable Object) และการหมดอายุ 15 วัน

ทดสอบกับ relay จริง (workerd ในเครื่อง, พอร์ตและที่เก็บข้อมูลแยกต่างหาก) ด้วย `tests-e2e/realtime/t8-persistence.mjs`: **6/6 ผ่าน**

| ทดสอบ | ผล |
|---|---|
| รีสตาร์ต relay ตอนไม่มีใครเชื่อมต่อ แล้วคนใหม่ที่ไม่มีสำเนาเปิดห้อง | ได้เนื้อหาและตำแหน่งตารางครบ (ภาษาไทยด้วย) |
| คนสุดท้ายออกภายใน 0.3 วินาทีหลังพิมพ์ (ก่อนครบ debounce 3 วินาที) | บันทึกแล้ว ไม่หาย |
| เครื่องที่มีสำเนาเดิมกลับมาเชื่อมต่อกับห้องที่โหลดจาก storage | ไม่มีข้อความซ้ำ |
| ห้องที่ไม่เคยมีใครเขียนอะไร | ไม่ถูกบันทึก (ห้องยังว่าง) |
| ห้องที่ไม่มีใครเปิดเกินอายุ (ทดสอบด้วย TTL 4 วินาที) | นาฬิกาปลุกลบห้อง (log: `[er] room … expired and was deleted`) |
| ผลต่อประสิทธิภาพ: 6 คนพร้อมกันหนักสุดซ้ำหลังเพิ่มการบันทึก | ยังเหมือนเดิม p95 4 ms ข้อมูลตรงกัน relay log 0 error |

หน่วย (`npm test -w apps/relay`, 8 ข้อ): แบ่ง chunk 64 KB, ลบ chunk ส่วนเกิน, chunk ที่ขาดหายถือว่าไม่มีข้อมูล, ห้องว่าง, หมดอายุ/ต่ออายุ, ผสานกับสำเนาของ client ไม่ซ้ำ

## ตัวอย่างตามโหมด และการแยก Import/Export (ทดสอบในเบราว์เซอร์)

- สลับ SQL ↔ MongoDB ตอนที่ยังเป็นตัวอย่างสำเร็จรูป: ตัวอย่างเปลี่ยนตามทั้งสองทาง พร้อมจัดวางใหม่ และหลังพิมพ์ตารางของตัวเอง การสลับโหมดไม่แทนที่งาน
- เมนู Import แยกหัวข้อ SQL (น้ำเงิน) / MongoDB (เขียว) / CSV·Excel และแต่ละหัวข้อเปิดหน้าต่างที่รับเฉพาะไฟล์ชนิดนั้น ไฟล์ผิดชนิดถูกปฏิเสธพร้อมข้อความ ทดสอบนำเข้า .sql, .jsonl, .xlsx จริงของโรงเรียน (แนะนำ MongoDB ให้เอง, 6 collection, 10 ความสัมพันธ์) และ CSV แบบ "เป็น MongoDB" (ได้ `_id`, string/int/date/bool)
- เมนู Export แยก SQL / MongoDB / ใช้ได้ทั้งสองโหมด หน้าต่าง Export มีแถว SQL (น้ำเงิน) และ MongoDB (เขียว, ป้าย "current mode") และแจ้งเตือนเมื่อ export ข้ามโหมด

## โหมด MongoDB แบบโค้ด Mongoose

ทดสอบด้วยไฟล์จริงของผู้ใช้ (`users.model.js` และ `users_collection_validator.json` ใน `packages/schema/test/fixtures/`):

| ทดสอบ | ผล |
|---|---|
| อ่าน `users.model.js` (ฟิลด์ `required`/`unique`, `enum`, `default` ที่เป็นฟังก์ชัน, `index`, `ref: "MemberModel"`, array ของ sub-document, hooks) | อ่านถูกต้องหมด ไม่มี error |
| generate กลับเป็นโค้ด Mongoose | เหมือนไฟล์เดิมเกือบทุกบรรทัด (ต่างเฉพาะ import ของ helper และ hooks) และอ่านกลับได้โครงเดียวกัน |
| import validator JSON | อ่านเป็น validator (ไม่ใช่ข้อมูลตัวอย่างเหมือนเดิมที่ได้ตารางขยะ 22 ตาราง) ได้ `unique`, `default`, `ref` จากคำอธิบาย |
| validator ที่ export จากโค้ด เทียบกับ validator ที่ผู้ใช้ทำเอง | `required`, ชื่อและชนิดของ property ตรงกัน |
| **Mongoose จริง + MongoDB 8 จริง** (`tests-e2e/mongo/tG_mongoose_mode.mjs`) | **19/19 ผ่าน:** model ที่ generate โหลดใน Mongoose ได้ บังคับ required/enum/sub-document ได้ validator ที่ generate รับ/ปฏิเสธเอกสารเหมือน validator ที่ทำเอง 5 กรณี และเอกสารที่ Mongoose สร้างผ่าน validator |
| เบราว์เซอร์: import ไฟล์ .js / .json, autocomplete (`type:`, ตัวเลือก, `ref: ""`), error ระบุบรรทัด, สลับโหมดพร้อมแปลงข้อความ, export | ผ่าน |

บั๊กที่เจอระหว่างทาง (แก้แล้ว): **ไฟล์ Windows (`\r\n`)** ทำให้ข้อความใน Yjs กับตัวแก้ไขเหลื่อมกัน import ซ้ำแล้วมีท่อนเก่าตกค้างต่อท้าย ตอนนี้ข้อความที่เข้าช่องแก้ไขถูกทำเป็น `\n` เสมอ (ทดสอบ: import ซ้ำหลายรอบ ข้อความตรงกับหลังโหลดหน้าใหม่) และตอนพิมพ์โค้ดค้างกลางคัน (syntax error) diagram เดิมยังอยู่บนจอแทนที่จะหายไป

ข้อจำกัด: สลับ SQL ↔ MongoDB แล้วคอมเมนต์ hooks และ methods ไม่ถูกส่งต่อ (มีหน้าต่างยืนยัน) ห้อง/โปรเจกต์โหมด MongoDB ที่สร้างไว้ก่อนเวอร์ชันนี้ (เป็นข้อความ DSL) จะถูกแปลงเป็นโค้ด Mongoose ให้เองเฉพาะเอกสารส่วนตัวและไฟล์โปรเจกต์ ส่วนห้องที่แชร์ไว้แล้วต้องแปลงเอง (สลับโหมดแล้วสลับกลับ) สคริปต์ `tests-e2e/mongo/t*.mjs` ชุดแรกเขียนสำหรับตัว generate รุ่นก่อน ใช้ผลของ `tG` และ unit test แทน

## รันการทดสอบซ้ำ

```bash
npm test                              # 61 unit tests (parser, generators, importers, fuzz) ~1 วินาที
node scripts/check-completions.mjs    # autocomplete
npm run relay:dev & npm run dev       # แล้วรันชุดทดสอบเชิงลึก (ต้องติดตั้ง dependency ในแต่ละโฟลเดอร์ก่อน: npm install)
cd tests-e2e/realtime && node --no-warnings t1-multi.mjs 6 2 20 3 10 2     # real-time 6 คน
cd tests-e2e/sql      && node a_parser.js && node b_gen.js && node c_ddl.js  # SQL
cd tests-e2e/mongo    && node tA.mjs && node tB.mjs && node tC1.mjs          # MongoDB
```

สคริปต์ใน `tests-e2e/` ถูกเขียนขึ้นขณะที่โค้ดยังมีบั๊กเดิม บางบรรทัดจึงยังคาดผลแบบเก่า (เช่น `float` แทน `double`, ชื่อ string quote แบบ `'`) ดู "ตัวเลขที่ยังไม่ผ่าน" ด้านบนประกอบ
