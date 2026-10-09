# ER Designer - MongoDB side QA report

Tester: QA agent. Scope: importers (mongoexport JSON, spec sheets xlsx/csv), Mongoose and mongosh generators, DSL autocomplete, round trips. No source under `apps/`, `packages/`, `scripts/` was modified. All test code, fixtures and raw outputs are in `D:\collaborative_tool\tests-e2e\mongo\` (own `package.json`; libs installed there only: mongoose 9.11.1, mongodb driver 7.7, mongodb-memory-server 11, jsdom, jszip, exceljs, ajv (installed, not needed)).

## Verdict

The happy path works: the real `schoole_er_diagram_na.xlsx` imports cleanly (5 spec sheets detected, 10 refs, every `id obj` converted to `_id objectid pk`, notes kept, DSL re-parses with 0 errors, generated Mongoose compiles and enforces required/ref/embedded/default/unique rules). The DSL, embedded documents and ObjectId refs behave correctly in ordinary use. However the layer around it is **not production safe**: (1) the `toMongoShell` `$jsonSchema` validators reject data that the app's own importer / generated Mongoose models produce (integer-valued `double`s, `long`, `decimal`, every `null`, ISO-date strings, hex strings) when tested on a real mongod; (2) `toMongoose` emits a file that throws SyntaxError/TDZ for many realistic table names (`user`+`User`, `a-b`+`a b`, digit-leading, `schema`, `number`); (3) `serialize()` and `parse()` are not inverses for apostrophes, newlines, `]`, `"` and for any non-ASCII/spaced name used in `Ref:` lines, so the importer can silently lose relations or produce unparsable DSL (multi-line Excel cell in a Note row breaks the whole schema); (4) the spec importer ignores Thai sheet names (all become `table`), duplicate sheet names, `Required/Description/Default` columns, and mangles `array(string) (ref: X)`.

Validation engines used: **real MongoDB 8.2.6 (mongodb-memory-server; download worked)** driven through the official Node driver, and **real Mongoose 9.11.1** (`require()` of the generated file, `validateSync`, and live `Model.create` against the same mongod). The mongosh script was executed through a `vm` shim that maps `db.createCollection / db.<coll>.createIndex / db.getCollection(..)` to the driver - real `mongosh` itself was not used. ajv fallback was not needed.

Raw check counts (528 automated checks; a few are informational and counted as "FAIL" when they document a limitation): A import 99/125, B spec 73/105, C mongoose 104/127, C shell (real mongod) 42/56, D autocomplete 39/49, E round trip 45/61.

## Results

| Area | Test | Result | Notes |
|---|---|---|---|
| School file | readXlsx (inline strings) + isSpecRows + specToSchema + serialize/parse | PASS (13/15) | 6 sheets, 5 spec, 10 refs all to `_id`, notes kept, reparse 0 errors. Misses: ref fields stay typed `string` (target is objectid); "STATUS (reference)" lookup sheet becomes a table with SQL types (`int`, `varchar(255)`) and its 8 rows are dropped; `role num (3 ...)` hint only kept as a note |
| A | mongoexport import: ext JSON, JSONL, object-of-collections, nulls, nesting 8 levels, arrays (primitive/object/mixed/nested/empty) | PARTIAL (99/125) | types inferred well except `$numberLong`->int, `$numberDecimal`->double, `$binary`/`$timestamp`->string, ints > int32 -> int (BUG-4) |
| A | weird keys (dot, space, `$`, Thai, digit-leading, `'`, backtick, `}`, `[pk]`, `//`) | PARTIAL | all survive serialize->parse except a key containing `"` (BUG-5) and empty key `""` |
| A | collection/embedded naming and collisions | PARTIAL | embedded names unique incl. case-insensitive; Thai-only collection name becomes `_` (BUG-13), `""` unparsable |
| A | 50k docs (11.6 MB array): parse 133 ms, infer 270 ms, +33 MB heap; JSONL 50k 171 ms; 20k-key doc 30 ms; 200k-element array 122 ms; 3000-level nesting OK (63 ms, 3005-char table name) | PASS | |
| A | empty file / whitespace / `[]` / `{}` / `[{}]` / scalars / single doc / BOM | PASS | `{"tags":["a"]}` single doc is mis-read as a collection named `tags` (BUG-13) |
| A | invalid JSON | PARTIAL | throws raw `JSON.parse` message, JSONL error has no line number; pretty-printed concatenated docs (`mongoexport --pretty`) rejected |
| B | school xlsx | PASS | see above |
| B | type vocabulary (50 variants) | PARTIAL (34/50) | `string[]`->`string`, `int[]`->`int`, `array<string>`/`array[string]`/`array of string`->`json[]`, `array(string) (ref: X)`->`string_ref_School[]`, `array (ref: X)`->`ref_School[]` (BUG-7); `map/dict/list/any/mixed/decimal/bigint/uuid` pass through or lose precision |
| B | header variants | PARTIAL | `FIELD/TYPE`, `Column/Data type`, `Name/Type` ok; `Fields/Types`, `Field name`, `Attribute`, `Key`, Thai headers -> treated as a data table |
| B | extra columns Required/Description/Default | FAIL (0/3) | silently ignored (BUG-8) |
| B | refs: case-insensitive, self-ref, unknown table, `ref:  SCHOOL ` | PASS (mostly) | unknown table silently becomes a note; `ref: school.id` unsupported; plain hint equal to a sheet name becomes a ref even for `date`/`num` types |
| B | sheet names: duplicates, Thai, spaces, `__proto__`, case twins | FAIL | Thai names -> `table` (duplicates), duplicate sheet names -> duplicate tables (parse error), `Sheet1`/`sheet1` coexist (BUG-6) |
| B | exceljs workbook with shared strings, numbers, booleans, formulas (cached value), dates (serial), merged cells, empty sheet | PASS | booleans come back `1/0`, dates as serial numbers (informational) |
| B | hidden / veryHidden sheets | FAIL | imported (BUG-9). Header not on row 1 (title row, or table starting at C3) -> not recognised |
| B | raw xlsx variants (ns prefix, absolute rel target, cells without `r=`, garbage file, zip without workbook) | PASS (6/6) | |
| B | `_id` conversion | PASS (8/10) | `id obj`+`_id objectid` in one sheet -> duplicate `_id` field (parse error, BUG-10); non-objectid `id` correctly left alone |
| B | csv spec (comma/semicolon/tab/BOM/spaces) | PASS | multi-line cell, apostrophe, duplicate rows corrupt DSL (BUG-5) |
| C mongoose | big realistic schema (embedded x6 deep, refs, N:M, self-ref, defaults, unique, compound index) compiled with real Mongoose and 27 doc validations | PASS (35/37) | required, ObjectId ref garbage rejected, nested required, defaults (`now()`->Date.now), `unique`, compound unique index all correct. Fails: `decimal` -> Number not Decimal128; compound index name ignored |
| C mongoose | 84 hazard schemas (names, reserved words, defaults, refs, recursion) | PARTIAL (68/84 compile) | see BUG-1; plus `__proto__` field silently lost, field `schema` crashes (`discriminatorKey` of undefined) |
| C shell | all createCollection/createIndex of a 17-field schema run on real mongod | PARTIAL | script aborts in mongosh at first failing call: field `[unique]` + `indexes { email }` -> IndexOptionsConflict (BUG-11) |
| C shell | valid typed doc accepted; 8 invalid docs (missing required, wrong types, bad ObjectId, nested, array items) rejected by server | PASS (9/9) | |
| C shell | tolerance of real-world values | FAIL | int-valued value in `double`, int in `long`, any `null`, unique on optional field (BUG-2/3) |
| C shell | edge: zero tables, empty table, embedded only, `_id` string/int pk, `id` objectid->`_id`, `id` int pk, Thai/space/dot names, ref to embedded-only, N:M, recursion, unknown types, 500 fields | PASS (20/23) | fails: collection name with `$`, `system.x` (server rejects), >64 indexes (MongoDB limit, informational) |
| E | model->validator agreement: generated Mongoose model writing to generated validator on real mongod | FAIL (4/11) | `price: 100` on `double`, `big` on `long`, `amount` on `decimal`, explicit `null`, 2nd doc without unique optional field |
| E | DSL -> Mongoose schema paths vs DSL fields (sample, hand-written, school) | PASS (74/75 fields) | only `decimal` differs |
| E | DSL -> serialize -> parse equality (3 inputs) + idempotence | PASS (6/6) | |
| E | random serialize/parse fuzz on 300 schemas | FAIL (50/300 identical) | caused by BUG-5 triggers (apostrophe, newline, `]`, `"`, empty note) |
| E | mongoToSchema(docs) -> Mongoose validate originals (13 datasets) | PARTIAL | all accepted except dataset with fields named `schema`/`collection`/`errors` (Mongoose throws) |
| E | mongoToSchema(docs) -> mongod `$jsonSchema` validate originals (relaxed EJSON) | FAIL | rejected: users 0/3 (int-valued double, nulls), big 0/1, mixed 3/7, dates 0/2, arrays 0/1 (BUG-2/4) |
| D | Mongo-mode type suggestions: primitives, tables as embedded types, `Name[]` variants, SQL types hidden, Thai/spaced table names listed, partial words, settings, Ref targets, snippets, comments | PASS (39/49) | failures listed in BUG-14 |

## Bugs found

Severity: blocker = data loss / crash in the main flow; major = wrong output in realistic use; minor = edge case. No blocker. Script paths are in `D:\collaborative_tool\tests-e2e\mongo\`.

### BUG-1 [major] `toMongoose` output is not valid JS for many table names
File/func: `packages/schema/src/generators/mongo.js` `toMongoose`, `pascal`.
Repro (`tC1.mjs`, `tC1b.mjs`, hazard table in `res_C1_hazards.json`):
```
Table user { a int }   Table User { a int }      -> SyntaxError: Identifier 'UserSchema' has already been declared
Table "a-b" { a int }  Table "a b" { a int }     -> same (also order_item / orderItem, order / Order / ORDER)
Table "2024data" { a int }   Table "123"   Table "📦box"   Table "it's"   Table `a"b`   -> Invalid or unexpected token / Missing initializer
Table schema { a int }  (or Schema)              -> Identifier 'Schema' has already been declared
Table number { a int }  (or boolean)             -> ReferenceError: Cannot access 'Number' before initialization
```
Expected: a valid, loadable file. `pascal()` is only `[\w]`-aware so it neither sanitises nor de-duplicates, and `const ${name}` shadows `Schema/Number/Boolean/...` globals used earlier in the same scope. Thai names (`ผู้ใช้`) do work.
Fix: in `toMongoose` compute an `id` per table = sanitise to `[A-Za-z0-9_$]`, prefix `_` if it starts with a digit or is empty, append a counter when already used (case-sensitive set) or when it is in a reserved set (`Schema, mongoose, Number, String, Boolean, Date, Buffer, Object, Array, Map, Symbol, module, exports, require`), and emit `JSON.stringify(...)` for the model name, collection name and `ref:` strings (currently `'${...}'` raw). Use the same id for `ref:`. Alternatively export `models['Name']` instead of top-level consts.

### BUG-2 [major] `toMongoShell` validators reject normal values (type strictness + null)
File/func: `generators/mongo.js` `bsonOf`, `propSchema`, `objectSchema`. Verified on real mongod 8.2.6 (`tC2.mjs`, `tE.mjs`).
- `price double` + value `100` (what Mongoose/driver store as Int32) -> `Document failed validation`. Generated Mongoose model with `Prod.create({price: 100})` fails against the validator generated from the same DSL.
- `long` rejects Int32 values and every JS Number > 2^31 (driver stores doubles); `decimal` rejects Mongoose `Number` (generated model uses `Number`, validator demands `decimal`).
- Any optional field set to `null` (`age: null`, `address: null`, `tags: null`) is rejected - mongoexport data contains these routinely; Mongoose accepts them.
Expected: validator accepts what the generated model and the source data produce.
Fix: `bsonOf`: `double` -> `["double","int","long","decimal"]` (or `"number"`), `int` -> `["int","long"]` (or number), `long` -> `["long","int"]`, `decimal` -> `["decimal","double","int","long"]`; in `propSchema`/`objectSchema` for fields that are not `notNull/pk` use `bsonType: [<type...>, "null"]` (and `items` likewise). In `mongooseType` map `decimal` -> `Schema.Types.Decimal128` (and consider `Long`).

### BUG-3 [major] unique on an optional field is not sparse
File: `generators/mongo.js` `toMongoShell` (createIndex) and `mongooseType` (`unique: true`). Repro (`tC2.mjs`): `nick string [unique]`; insert two docs without `nick` -> second gets `E11000 duplicate key { nick: null }` (both via shell index and via Mongoose-created index).
Fix: when `!f.notNull && !f.pk` emit `{ unique: true, sparse: true }` (or `partialFilterExpression: { f: { $type: ... } }`); same for single-field `indexes {}` entries and for the Mongoose `unique:true, sparse:true` options.

### BUG-4 [major] `mongoToSchema` infers types that its own validator/model reject
File: `importers/mongoJson.js` `scalarType`. Repro (`tE.mjs` datasets `big`, `dates`, `users`):
- `{"$numberLong":"9007199254740993"}` -> `int`; `{"$numberDecimal":"12.50"}` -> `double`; `{"$binary":..}` -> `string`; `{"$timestamp":..}` -> `string`; JS integers > 2147483647 -> `int`. Real typed BSON doc then fails the generated validator (`n, d, big, bin: type did not match`).
- Plain strings that look like an ISO date (`"2020-01-02"`) or 24-hex (`"507f1f77..."`) are typed `date` / `objectid`, but they are strings in the data: validator rejects the original docs (dates 0/2). Same-field mixture of hex + normal string degrades to `json` instead of `string`.
- int + double in a field -> `double`, but integer-valued members fail BUG-2.
- `required`/`notNull` is never inferred (only `_id`).
Fix: `$numberLong` -> `long`, `$numberDecimal` -> `decimal`, `$binary` -> `buffer`, `$timestamp` -> `date`/`timestamp`, `Math.abs(n) > 2147483647` -> `long`; infer `date`/`objectid` from strings only when the export used Extended JSON for that field (or treat as `string`), and in `build()` treat `{date|objectid-looking string} + string` as `string`. Optionally mark a field `not null` when present and non-null in 100% of documents.

### BUG-5 [major] `serialize()` and `parse()` are not inverse (data corruption on import)
Files: `serializer.js` (`str`, `q`, Ref and index emission), `parser.js` (`SETTINGS_RE`, `splitTop`, `findComment`, `unquoteValue`, `Table` regex, `IDENT`). Repro `tC1b.mjs`, fuzz in `tE.mjs` (only 50/300 random schemas survive):
1. Apostrophe in a note/default (`user's id`): serializer writes `\'`, parser has no escape support, the whole `[note: ...]` is swallowed into the field TYPE (`type: "string [note: 'user\\'s id']"`), losing `not null/unique/pk` on that field.
2. Newline in a note/default (multi-line Excel cell in a `Note` row or type hint): DSL breaks across lines, the table and everything after produce `Unexpected ...` errors (`tF.mjs`).
3. `]` or `[` in a table note (`[note: 'a]b']`) -> table not recognised (regex `\[([^\]]*)\]`).
4. Field/table name containing `"` -> serializer wraps in `"..."`, parser `"[^"]+"` fails.
5. `Ref:` lines and index field lists are not quoted: `Ref: DOC.ผู้สร้าง > USER._id`, `DOC.created by > ...`, `(ชื่อ, a b)` -> `Invalid Ref` and the relation is dropped (spec sheet with 3 refs on Thai/spaced field names keeps 1/3, `tF.mjs`, `tC1b.mjs`).
6. Empty-string note is dropped (benign).
Fix: serializer: `q()` for every identifier in Ref/index output, use backtick quoting when the name contains `"`, escape `\\`, `'` and newline (`\n`) in `str()`; parser: make `findComment`, `splitTop`, `SETTINGS_RE` and `unquoteValue` honour backslash escapes and unescape; allow `]`/`[` inside quoted table notes; importers should also collapse newlines in notes.

### BUG-6 [major] spec importer table naming: Thai names, duplicates, collisions
File: `importers/spec.js` `clean()` / `specToSchema`. Repro `tB.mjs`, `tF.mjs`:
- `clean()` uses `[^\w$]` so Thai sheet names (`ผู้ใช้งาน`, `ลูกค้า`) -> `table`; with 2+ Thai sheets: `Duplicate table "table"` parse errors; refs `(ref: ผู้ใช้)` then all resolve to the first `table`.
- Two sheets named `Dup` -> two tables `Dup` (no dedupe, unlike `rowsToSchema`); same when a spec sheet name equals a collection imported from a `.json` earlier in the same `importFiles` run (`USER`,`USER`). `Sheet1`/`sheet1` coexist (relations are matched case-insensitively -> ambiguous). `__proto__` -> `proto`.
Fix: use a Unicode-aware clean (`/[^\p{L}\p{N}_$]+/gu`; the serializer already quotes such names), then dedupe against `schema.tables` (case-insensitive) with the `_2` suffix loop used in `rowsToSchema`.

### BUG-7 [major] spec importer type parsing mangles arrays and ref clauses
File: `importers/spec.js` `parseTypeText`, branch `base === 'array'`. Repro `tB.mjs` (`typemap.json` has the full map):
- `array(string) (ref: School)` -> type `string_ref_School[]` (greedy `\(([\s\S]*)\)`), no ref, garbage type name.
- `array (ref: School)` -> type `ref_School[]` (the ref clause is used as element type; a Ref is created but the field type is garbage).
- `string[]`, `int[]` lose the array (`string`, `int`); `array<string>`, `array[string]`, `array of string`, `array<obj>` -> `json[]`; `map/dict/list/any/mixed/bigint/uuid` pass through as raw type words; `decimal` -> `double`; `long text` -> `long`.
Fix: parse trailing `[]`, `<...>` and `[...]`; use a balanced-paren parser and split a `ref:` clause out first (element type = `objectid` when ref present); extend `PRIMITIVES` (`map/dict -> object`, `any/mixed -> json`, `list/array -> json[]`, `bigint -> long`, `decimal -> decimal`, `uuid -> string`).

### BUG-8 [minor/major] spec importer ignores extra columns; header detection is narrow
File: `importers/spec.js` `isSpecRows`, `specToSchema`. `Field,Type,Required,Description,Default` -> columns 3+ silently dropped (name stays optional, no note, no default). Headers `Fields/Types`, `Field name`, `Attribute`, `Key`, `ฟิลด์/ชนิด` are not detected and the sheet is imported as a data table. Fix: detect `required|mandatory|not null`, `description|note|comment`, `default` headers case-insensitively and map to `notNull`, `note`, `default`; widen the regexes; report ignored columns in `notes`.

### BUG-9 [minor] xlsx reader / import flow edge cases
`apps/web/src/lib/xlsx.js` imports hidden and veryHidden sheets (honour `state="hidden"`); sheets whose header is not on row 1 (title row above, or table starting at C3) are not recognised as specs (scan the first rows for the header and drop leading empty columns); booleans return `1/0`, date cells return serial numbers. `spec.js`: a hint equal to another sheet name becomes a ref even for `num/date` types; unknown `ref: Ghost` silently becomes the note `ref: Ghost` (report it); ref fields keep type `string` although the target is objectid `_id` (set `objectid` when target pk is objectid); `ref: school.id` form unsupported. `files.js`: a primitive-only spec sheet (e.g. `string/num/datetime/bool`) leaves `mode` unset (types `string/bool` are not SQL either) - treat any spec import as mongodb or ask.

### BUG-10 [minor] duplicate `_id` field from a spec with both `id obj` and `_id objectid`
`spec.js` renames `id` to `_id` without checking an existing `_id` -> DSL has two `_id` fields (`Duplicate field "_id"`). Also duplicate field rows (`a int`, `a string`) are emitted as duplicates. Fix: skip/rename on conflict and dedupe field names.

### BUG-11 [minor] mongosh script conflicts and unsupported names
`generators/mongo.js toMongoShell`: (a) `email string [unique]` plus `indexes { email }` (or the same compound index with and without `unique`) emits two `createIndex` on the same keys -> `IndexOptionsConflict`, which aborts a mongosh script; dedupe by key and keep the unique one. (b) `indexes { (a,b) [name: 'my_idx'] }`: name is ignored in both mongosh and Mongoose output -> pass `{ name: ... }`. (c) collection names containing `$` or starting with `system.` are rejected by the server (and by Mongoose): warn or sanitise. (d) N:M `<table>_ids` arrays added by Mongoose are absent from the `$jsonSchema`; if the from-table already has a field with that name the generator emits a duplicate key.

### BUG-12 [minor] Mongoose generator odds and ends
- Field `__proto__` is silently lost (`{ __proto__: {...} }` literal sets the prototype); field `schema` makes `new Model(doc)` throw `Cannot read properties of undefined (reading 'discriminatorKey')`; `errors/collection/save/isNew/get/init/validate` produce Mongoose reserved-key warnings - warn in the generator or add `suppressReservedKeysWarning`.
- A table named like a primitive type (`string`, `date`) hijacks every field of that type into an embedded relation (`relations.js embeddedTarget` matches `baseType` against table names case-insensitively, including primitives).
- `Ref` to an `[embedded]` table yields `ref: 'E'` with no model (populate fails at runtime).
- Escaped defaults: `default: 'it\'s'` ends up as `it\'s` / a field default is dropped (BUG-5 side effect).
- `pk` on a non-`_id` field has no `unique` / required semantics in Mongoose (informational).

### BUG-13 [minor] mongoToSchema / parseMongoExport input handling
- Thai-only collection name (`ผู้ใช้`) -> table `_` (regex `[^\w$]+`); `""` collection or key `""` -> unparsable DSL.
- `{"tags":["a","b"]}` (single doc whose only values are arrays) is read as an object-of-collections, giving a collection `tags` instead of a document with `tags string[]`; mixed arrays vs `[ ]` heuristics should require array elements to be objects.
- Invalid JSON: raw `JSON.parse` message ("Expected property name or '}' in JSON at position 1"), JSONL failures give no line number; `mongoexport --pretty` multi-line concatenated documents are rejected. Fix: wrap with `Line N: ...`, add a streaming/brace-balancing fallback.
- 3000-deep nesting creates 3005-char table names; consider a depth cap or short names. (No crash, 50k docs fine.)
- `{"x":{"$oid":"zzz"}}` is typed `objectid` without checking the hex.

### BUG-14 [minor] Autocomplete (`apps/web/src/lib/completions.js`)
- Typing the `[` of `string[` or `Address[` offers settings (`pk`, `unique`...) instead of `string[]` / `Address[]` (the `[`-inside-settings test only excludes a trailing `[]`). Same in SQL mode (`int[`).
- Quoted strings are not understood: `note: '// x', |` is treated as a comment (no suggestions), a cursor inside `default: 'x, |'` still offers settings.
- Unquoted Thai identifiers: no suggestions at line start, after `Table`, or for a partially typed Thai type (regexes use `\w`/`[\w$]`); also the parser's `IDENT` (`[A-Za-z_][\w$]*`) rejects unquoted Thai field/table names (`Table ผู้ใช้ {` -> `Unexpected`), while the serializer quotes them.
- `fieldTargets()` labels (`ที่อยู่.x`, `my table.y`, `a.first name`) are inserted unquoted and produce `Invalid Ref`; quote when the name is not `[A-Za-z_]\w*`.
- Inside an `indexes { }` block the source returns null; suggesting the table's field names would help.
- Mid-word cursor (`a str|ing`) replaces only the left part (`string` -> `stringing`).
Positive: Mongo mode lists all 16 Mongo types, tables as `Name` (boost 60) and `Name[]` (55), hides SQL-only types, handles partial words, `Ref:` targets/operators, `[ref: > ` and snippets; no crash in any cursor position tried; SQL mode does not show tables as types.

## Not a bug / informational
- 66 unique fields -> MongoDB refuses more than 64 indexes per collection (limit, not a tool bug).
- Importer never marks fields `required` (except `_id`); no enum support (`enum` type maps to String; notes only become `description` in the validator).
- The imported `STATUS (reference)` data sheet loses its rows (by design) and carries SQL types.

## How to re-run
```
cd D:\collaborative_tool\tests-e2e\mongo
node tA.mjs; node tB.mjs; node tC1.mjs; node tC1b.mjs; node tC2.mjs; node tD.mjs; node tE.mjs; node tF.mjs
```
Raw outputs: `out*.txt`, per-check JSON `res_*.json`, generated models `gen/*.cjs`, school DSL `school.dsl`, type map `typemap.json`, test workbook `exceljs_shared.xlsx`. `tC2.mjs`/`tE.mjs` start their own in-process mongod on a random port (no use of 8787/5173).
