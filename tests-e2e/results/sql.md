# SQL side QA report - ER Designer (packages/schema)

Tester: automated Node scripts in `D:\collaborative_tool\tests-e2e\sql\` (own package.json: @electric-sql/pglite, sql.js, node-sql-parser). Nothing under apps/, packages/, scripts/ was modified; no servers touched. Raw per-check results: `a.json b.json b2.json c.json c_clean.json d.json e.json f.json`; generated DDL / imported DSL in `out/`; fixtures in `fixtures/`. Run any script with `node <file>` from that folder (`CLEAN=1 node c_ddl.js` for the data-lines-removed variant).

## Verdict

The DSL parser, CSV parser and exporters are in decent shape for the happy path, and Postgres output for ordinary schemas executes cleanly in real Postgres (PGlite). But the SQL side is **not production-safe**: several real-world inputs silently produce wrong or broken results.

- **SQL import breaks on realistic dumps.** The comment stripper is not string-aware, so one `--` or `/*` inside an INSERT string (or `'...\'...'` in a mysqldump) corrupts every following statement. Named `CONSTRAINT x CHECK (...)` becomes a phantom column named `CONSTRAINT`. Tables with a space in the name (`"Order Details"`) are dropped with no error.
- **SQLite output is weak.** FKs are emitted only as comments, so relations are lost. The editor's own `SAMPLE_SQL` (`default now()`) fails to execute in SQLite.
- **MySQL junction tables lose their FKs** (MySQL ignores inline `REFERENCES`).
- **`serialize` -> `parse` is lossy for apostrophes** (`\'` is emitted but never understood) and for odd names in `Ref:`/index lines.
- **`bigserial` imports as `bigbigint`.**
- **CSV import** throws `RangeError` at about 125k text rows, mixed int/float columns become `varchar`, and Thai headers or file names collapse to `column`.

I ran 1,000+ individual checks (table below). Many "FAIL" rows in area B are deliberately invalid-input probes (duplicate tables, FK to a non-unique column), listed separately from real bugs.

## Results

| Area | Test | Result | Notes |
|---|---|---|---|
| A | DSL parser (README syntax, quoting, comments, CRLF, tabs, Thai, long lines, errors, garbage, empty, roundtrip) `a_parser.js` | PARTIAL | 64/88. Never throws; errors carry lines. No ReDoS (200k-char lines and pathological `[[[`, 2000 tables all <1s). Failures: apostrophe escaping (Bug 4), Thai/Unicode unquoted identifiers (Bug 11), unquoted `Ref:` endpoints in serializer (Bug 5), swallowed errors (Bug 13). Several checks probe DBML features outside the README (one-line tables, `/* */`, `Table public.x`). |
| B | SQLite output executed in sql.js, `b_gen.js` | PARTIAL | 48/63. FK comments only (Bug 2), `now()` default fails (Bug 3), empty table fails. Remaining fails are invalid inputs (duplicate tables/fields/indexes, m2m collisions). Tables, PK/autoincrement, unique, indexes, composite PK, junction FKs, reserved names, Thai names, 150 tables all PASS. |
| B | PostgreSQL output executed in PGlite | PARTIAL | 44/78. Real failures: `blob` (an editor SQL_TYPES entry) is invalid in PG (Bug 6); non-literal defaults are quoted into strings (Bug 3); empty table. Other fails are invalid inputs (FK to non-unique, duplicates, m2m self/duplicate, unknown types). PASS: serial/bigserial, composite PK, m2m junction (2 FK + PK), one-to-one unique, self-ref, arrays, jsonb, reserved words (user/order/group/select/table), 150-table FK chain, Thai names. |
| B | MySQL output: node-sql-parser syntax + manual rules (no server), `b_gen.js` | PARTIAL | 59/69 syntax/rule checks. Real MySQL would reject or mis-handle: TEXT UNIQUE/PK, literal DEFAULT on TEXT/BLOB/JSON, `varchar` without length, `auto_increment` on varchar/uuid or without a key, empty table, `serial`/`money`/`timestamptz` leaking; and inline `REFERENCES` in junction tables is silently ignored (Bug 7). |
| B | Editor type list matrix (22 SQL_TYPES x 3 dialects) `b2_matrix.js` | PARTIAL | 65/66. Only `blob` on postgres fails. Extra Mongo-ish/other types: 82/99 (fails: `tinyint`, `mediumtext`, `longtext`, `year`, `datetime2`, `nvarchar`, `varbinary`, `enum` on PG; `serial`, `bigserial`, `money`, `timestamptz`, `nvarchar`, `datetime2`, `enum` on MySQL; `real`/`double precision`/`year` were flagged only by node-sql-parser's grammar and are valid MySQL, so not counted as bugs). `string`, `objectid`, `object`, `bool`, `number`, `mixed`, `buffer`, `binary`, `string[]`, `objectid[]` map fine. |
| B | Default values matrix and fidelity | PARTIAL | 84/90 execute, 6/16 fidelity. See Bug 3 (expressions quoted as strings, `now()` in SQLite) and Bug 8 (string defaults `'007'`, `'null'`, `'NULL'`, `'1.50'` become numbers/NULL). |
| C | pg_dump import (`fixtures/pg_dump.sql`) | PARTIAL | Raw dump: 21/35. With COPY/INSERT lines removed: 28/35. See Bugs 1, 9, 10, 12, 14. |
| C | mysqldump import (`fixtures/mysqldump.sql`) | PARTIAL | Raw dump: 19/35 (only `customers` survives, 0 refs). With data lines removed: 30/35. COMMENT dropped, `sku`(10) prefix index garbage, cross-dialect types not mapped. |
| C | SQLite hand-written schema + real binary .sqlite (sql.js, same logic as `files.js`) | PARTIAL | 22/33. `"book tags"` table (space in name) lost with its FK; typeless column dropped; `COLLATE NOCASE` in index becomes part of column name. Inline/table-level FKs with ON DELETE/UPDATE, AUTOINCREMENT, composite PK, WITHOUT ROWID, views/triggers ignored, `;` in strings and triggers all PASS. |
| C | Edge-case statements (39 probes) | PARTIAL | 26/39. See Bugs 1, 9, 10, 12, 14. |
| D | CSV parse and import (delimiters, BOM, quotes, CRLF, ragged, duplicate/empty headers, empty cols, header-only) | PARTIAL | 25/28. Fails: case-only duplicate headers, Thai headers and file names (Bug 11). |
| D | Type inference (59 cases) | PARTIAL | 52/59. Leading zeros (zip/phone), thousands separators, `+66` phones, NaN, `$`/`%`, hex, long text, Thai text, bigint boundaries all correct. Fails: int+float mix (Bug 10), yes/no/Y/N/t/f booleans, invalid ISO dates accepted, `-2147483648` -> bigint, 23-digit int -> bigint. Non-ISO dates (`31/01/2020`) are `varchar`, as designed. |
| D | `id` PK heuristic | PARTIAL | 14/19. Works for unique int `id` (any case). Fails: blank/whitespace ids still PK, text ids not PK, `float` for money. |
| D | 100k-row CSV performance | PARTIAL | 100k rows x 9 cols (8.4MB): parse+infer fast (see json for ms), heap OK. But `inferType` throws RangeError at >=125k text rows (Bug 9). 500x2000 wide file OK. |
| E | schemaToCsv / tablesToCsvFiles / toCsv | PARTIAL | 27/33. Escaping of commas, quotes, newlines, Thai round-trips through `parseCsv`. Fails: unsafe or colliding file names, formula injection, `parseCsv` drops a legitimate empty single-column row (Bug 15). |
| F | DSL -> PG -> ddlToSchema -> serialize compare (4 schemas) | PARTIAL | 70/77. Differences by category: type (`bigbigint`), one-to-one UNIQUE lost, m2m becomes junction table (expected), second-generation DDL not stable, SQLite output loses all refs. All 4 PG DDLs execute with 0 errors. |

## Bugs found

### 1. Comment stripper and statement splitter are not string-aware (blocker for real dumps)
- Files: `packages/schema/src/importers/ddl.js` - `stripComments`, `splitStatements`, `splitTopLevel`.
- Repro (`tests-e2e/sql/c_ddl.js`, fixtures `pg_dump.sql`, `mysqldump.sql`):
  ```sql
  CREATE TABLE a (id int, u varchar(100) DEFAULT 'http://x.com/a--b');
  INSERT INTO products VALUES ('A-2', 'Gadget -- not a comment', 1.00);
  INSERT INTO t VALUES ('O\'Brien'); CREATE TABLE after_bs (id int);
  INSERT INTO t VALUES (E'it\'s; here'); CREATE TABLE after_e (id int);
  ```
- Observed: `--` and `/* */` inside literals are stripped to end of line, unbalancing quotes. All later statements merge into one, so in the mysqldump fixture only `customers` was imported (1 of 5 tables, 0 of 5 FKs), and in the pg_dump fixture all PKs, FKs and indexes were lost (0 refs). `\'` (mysqldump default escaping) and `E'..\'..'` flip quote parity the same way. `$$ ... ; ... $$` function bodies are not handled.
- Expected: statements after data lines still parse; a mysqldump with `O\'Brien` in an INSERT imports all tables.
- Fix: replace the regex `stripComments` and the two splitters with one tokenizer that walks the text once, tracking `'...'` (with `''` and, for MySQL, `\'`), `E'...'`, `"..."`, `` `...` ``, `$tag$...$tag$`, `-- ...`, `/* */`, `#` (MySQL, only at statement start), and splits on top-level `;`. Skip `INSERT`/`COPY ... FROM stdin` (consume until `\.` line) before anything else.

### 2. SQLite generator drops all foreign keys (major)
- File: `generators/sql.js` `toSQL`, `dialect === 'sqlite'` branch (the `-- sqlite: add manually inside create table: alter table ...` comment).
- Repro: `Table users{id int [pk]} Table posts{id int [pk] user_id int} Ref: posts.user_id > users.id` -> `toSQL(s,'sqlite')`. `pragma foreign_key_list(posts)` returns 0 rows (executed in sql.js; script `b_gen.js`). One-to-one (`-`) also gets no UNIQUE.
- Judgement: not acceptable. SQLite cannot `ALTER TABLE ADD CONSTRAINT`, so the relations (the entire point of an ER tool) are lost, and the output cannot round-trip: `ddlToSchema(toSQL(x,'sqlite'))` gives 0 refs (F, 4 refs -> 0).
- Fix: for SQLite, build FKs while emitting each CREATE TABLE: append `, foreign key ("col") references "parent" ("id")` as table constraints (first compute `refs` grouped by child table), add `unique ("col")` for one-to-one, and optionally prepend `pragma foreign_keys = on;`. Order tables so parents come first, or rely on SQLite's deferred FK parsing (it allows forward references).

### 3. Default-value rendering is a regex guess; expressions are quoted, `now()` is invalid in SQLite (major)
- File: `generators/sql.js` `defaultValue`; also `parser.js` `unquoteValue` (the backtick marker for expressions is discarded at parse time).
- Repros (`b2_matrix.js`):
  - `created_at timestamp [default: \`now()\`]` (this is **`SAMPLE_SQL`**, the app's default example) -> SQLite `default now()` -> `near "(": syntax error`.
  - `` [default: `gen_random_uuid()`] ``, `` `uuid_generate_v4()` ``, `` `current_date` ``, `` `1+2` `` -> emitted as `default 'gen_random_uuid()'` -> PG: `invalid input syntax for type uuid`. Also MySQL needs `(expr)` for non-datetime expressions.
  - Importing `DEFAULT gen_random_uuid()` and regenerating fails the same way (F/C).
- Fix: keep the info that a default is an expression (e.g. `f.defaultExpr = true` when the DSL value was backticked, or when `ddlToSchema` saw a function call) and emit it raw; for SQLite map `now()` -> `current_timestamp` and wrap other expressions in `(...)`; for MySQL wrap non-timestamp expressions in `(...)`.

### 4. serialize() emits `\'` but parse() cannot read it (major; hits every SQL import with an apostrophe)
- Files: `serializer.js` (`str`), `parser.js` (`SETTINGS_RE`, `splitTop`, `findComment`, `unquoteValue`).
- Repro (`a_parser.js`, `c_ddl.js`): table note `it's`, or `bio text DEFAULT 'it''s; a "bio"'` in a dump. The serializer writes `[default: 'it\'s; a "bio"']`. Re-parsing treats the `'` after `\` as the end of the string: the whole `[...]` is absorbed into the field TYPE (`text [default: 'it\'s; a "bio"']`) and the regenerated SQL becomes `"bio" text [default: 'it\'s; ...']` (invalid SQL). Notes containing `"quote"` are also re-escaped on each pass (`\'` -> `\\'`), so parse/serialize is not idempotent.
- Fix: choose one escape convention and apply it in all four parser spots: either teach the parser that `\\` escapes the next character (in `splitTop`, `findComment`, `SETTINGS_RE`, `unquoteValue`) and unescape in `unquoteValue`, or have the serializer pick the quote char that does not occur in the value (`"..."` when it contains `'`), falling back to `\'` plus parser support.

### 5. Serializer does not quote identifiers in `Ref:` lines and index field lists (major for SQLite/Northwind-style names)
- File: `serializer.js` (`Ref: ${r.from.table}.${r.from.field} ...`, `(${ix.fields.join(', ')})`), plus `parser.js` `parseRef` which splits on `\S+` and cannot parse quoted names containing spaces anyway.
- Repro: schema with table `my-table` / column `col 1` -> `Ref: my-table.col 1 > my-table.col 1` -> parse error "Invalid Ref", ref lost. Index on `"my col"` emits `(my col)`-style garbage -> "Invalid index" (seen in sqlite_hand import: error line 20).
- Fix: wrap with the existing `q()` in the Ref and index emitters; in `parseRef` replace `\S+` with a tokenizer that accepts `IDENT.IDENT` (quoted allowed) separated by the operator, with or without spaces (`a.id>b.id` currently fails).

### 6. `blob` (in the editor's own SQL_TYPES) is not mapped for PostgreSQL; other MySQL/PG type names pass through unmapped (major)
- File: `generators/sql.js` `TYPE_MAP.postgres` (and `.sqlite` is fine).
- Repro: `c blob` -> PG `type "blob" does not exist`, so the whole CREATE TABLE fails. Same for `tinyint`, `mediumtext`, `longtext`, `year`, `datetime2`, `enum(...)`, `unsigned` suffix (all appear in imported MySQL dumps) when regenerating for PG, and `timestamp without time zone`/`timestamptz`/`money`/`serial` for MySQL. MySQL-dump -> DSL -> PG DDL fails: `syntax error at or near "unsigned"`; -> SQLite fails on `enum('active',...)` (C, 2 checks).
- Fix: add `blob: 'bytea'`, `tinyint: 'smallint'`, `mediumtext/longtext/tinytext: 'text'`, `mediumint: 'integer'`, `year: 'smallint'`, strip `unsigned/zerofill`, map `enum(...)` to `text` (or `varchar`) for PG/SQLite; for MySQL map `timestamp without time zone` -> `datetime`, `timestamptz` -> `datetime`, `bytea` is already mapped, `money` -> `decimal(19,4)`, `serial` -> `int` + auto_increment, `uuid` ok.

### 7. MySQL: junction tables use inline `REFERENCES`, which MySQL parses but ignores (major, could not execute: no MySQL server; based on MySQL documented behaviour)
- File: `generators/sql.js` (`extraTables`, `<>` branch).
- Repro: `Ref: a.id <> b.id` with mysql -> `` `a_id` int not null references `a` (`id`) `` -> InnoDB creates NO foreign key. Postgres/SQLite are fine (verified: 2 FKs + composite PK).
- Fix: for the junction table emit table-level `foreign key (...) references ...` (valid in all three dialects) instead of column-level `references`. Also guard self-referencing m2m (`a.id <> a.id` generates `a_id` twice -> PG: `column "a_id" appears twice in primary key constraint`), duplicate junction names, and name collisions with existing tables (`a_b`).

### 8. String defaults that look like numbers/keywords are emitted unquoted (major, silent data corruption)
- File: `generators/sql.js` `defaultValue` regex `^(-?\d+(\.\d+)?|true|false|null|now\(\)|current_timestamp(\(\))?)$`.
- Repro (`b2_matrix.js`, verified by inserting a row in PGlite/sql.js): `zip varchar(10) [default: '007']` stores `7` (PG and SQLite); `'1.50'` -> `1.5` (SQLite); `[default: 'null']`/`'NULL'` stores real NULL; `'true'` in a SQLite text column stores `1`. `serialize` also writes `default: 007` for the string `'007'`.
- Fix: decide literal vs. expression from the column type (quote when the target column is a text type and the DSL value was quoted), or keep `f.defaultQuoted` from the parser, and have the serializer emit numbers unquoted only when the original was numeric.

### 9. Importer: CHECK/EXCLUDE with `CONSTRAINT name` prefix becomes a phantom column; many constructs silently dropped (major)
- File: `importers/ddl.js` item loop (`/^(check|exclude|fulltext|spatial)\b/` does not allow the `constraint <name>` prefix).
- Repro: `CREATE TABLE a (id int, b int, CONSTRAINT a_chk CHECK (b>0))` -> extra field `CONSTRAINT` with type `a_chk` (pg_dump always names CHECKs this way). Regenerated PG: `type "orders_total_check" does not exist`.
- Other silently dropped or garbled, same file (all in `c_ddl.js`):
  - `ALTER TABLE .. ADD CONSTRAINT .. UNIQUE (..)` / `ADD UNIQUE` and `ALTER TABLE .. ADD COLUMN` ignored -> pg_dump unique constraints lost, one-to-one `-` unique lost on round trip.
  - `ALTER TABLE ... ALTER COLUMN id SET DEFAULT nextval(...)` / `GENERATED .. AS IDENTITY` via ALTER / inline `DEFAULT nextval('..')`: `increment` not detected (serial-ness lost on every pg_dump column).
  - Quoted table names containing a space (`CREATE TABLE "book tags"`, `"Order Details"`) are dropped entirely, together with their FKs (regex `([^\s(]+)`).
  - Column with no type (legal in SQLite: `CREATE TABLE no_pk (a, b, c INT)`) is dropped.
  - `CREATE UNLOGGED TABLE` ignored.
  - Inline `REFERENCES p` without a column list (implicit PK) ignored; composite FK `(x,y) -> (a,b)` keeps only the first pair.
  - Quoted identifiers containing `,`/`(`/`)`.
  - `DEFAULT (concat('a','b'))` truncated at the first `)`.
- Fix: allow `(constraint\s+\S+\s+)?` before check/exclude; handle `alter table .. add [constraint n] unique (..)` and `add column`; improve the table-name regex to accept `"..."`/`` `...` ``/`[...]` containing spaces; parse default with a balanced-paren scanner; map `nextval(` default or an owned sequence to `increment`.

### 10. Index columns keep modifiers (`DESC`, `COLLATE`, prefix length, expressions) -> broken regenerated DDL (major)
- File: `importers/ddl.js` `cols`.
- Repro: `USING btree (placed_at DESC, user_id)` -> field `placed_at DESC`; `(title COLLATE NOCASE)`; mysql ``KEY `idx_sku` (`sku`(10))`` -> field ``sku`(10``; `(lower((email)::text))` -> `lower((email`. Regenerating gives `create index ... ("lower((email")` (PG: error; C pg_dump check).
- Fix: in `cols`, split on top-level commas only, strip trailing `ASC|DESC|NULLS ..|COLLATE ..|(n)`, skip (or ignore the whole index) for expression indexes.

### 11. Thai/Unicode identifiers: DSL IDENT and CSV `clean()` are ASCII-only (major for a Thai-language user base)
- Files: `parser.js` `IDENT = [A-Za-z_][\w$]*` ; `importers/csv.js` `clean()` `/[^\w$]+/g`.
- Repro: `Table ผู้ใช้ { รหัส int [pk] }` -> "Unexpected ..." errors (needs quotes; note the `serialize` output does quote them, so only hand-typed DSL fails). CSV header `ชื่อ-สกุล`, `ราคา` -> column names `column`, `column_2`; file name `ผู้ใช้.csv` -> table named `column` (the `|| 'table'` fallback is unreachable because `clean` always returns a non-empty string).
- Fix: use `\p{L}\p{N}` with the `u` flag in both places (`IDENT = [\p{L}_][\p{L}\p{N}_$]*`; `clean`: `/[^\p{L}\p{N}_$]+/gu`). Case-only duplicate headers (`name`/`Name`) should also be de-duplicated case-insensitively.

### 12. Mixed int/float CSV columns become varchar; boolean variants and invalid dates (minor-major)
- File: `importers/csv.js` `inferType`.
- Repro: `['1','2.5','3']` -> `varchar(255)` (the float regex requires every value to contain a dot), so any price/score column that has some whole numbers is text; the 100k-row test shows `score` as varchar. `yes/no`, `Y/N`, `t/f` are not booleans. `2020-13-45` is accepted as `date`. `-2147483648` -> bigint, 23-digit integers -> `bigint` (overflow). `float` is single-precision in MySQL (monetary precision loss).
- Fix: test numeric = `^-?\d*\.?\d+$` with int/float split by "any value has a dot"; return `double`/`decimal(p,s)` instead of `float`; validate dates with `Date.UTC` round trip; accept yes/no/y/n/t/f (not 0/1); use `BigInt` for range checks.

### 13. Parser silently ignores several mistakes (minor)
- File: `parser.js`.
  - Unknown setting (`[bogus]`), unterminated quote in a note, index on a non-existent field: no error.
  - `int[pk]` (no space) -> type `int[pk]`; `varchar(10)[unique]` likewise.
  - Ref errors for unknown table/field report `line: 1` (`err(0, ...)`) instead of the Ref's line.
  - `Table a { ... }` on one line, `/* */` comments, `Table public.users`, quoted names with spaces in `Ref` are not supported (not in README, but common DBML).
- Fix: remember each ref's source line (`ref.line`) and use it in the post-pass; push an error for unrecognized settings; allow `[` directly after the type.

### 14. Importer type text is not normalised (minor)
- `character varying(255)`, `timestamp without time zone`, `double precision`, `character(10)` are kept verbatim; fine for PG, not for MySQL (`timestamp without time zone`), and noisy in the diagram. `DEFAULT NULL` becomes the string `'NULL'` (appears on nearly every column of a mysqldump, then written `default: 'NULL'` in the DSL). MySQL column `COMMENT` is dropped (could map to `note`). `bigserial` -> **`bigbigint`** (typo-level bug in `ddl.js`: `f.type.replace(/serial/i, ...)` returns `'bigint'` into `bigserial`; verified in `c_ddl.js` and F). Fix the last with `f.type = /^big/i.test(f.type) ? 'bigint' : /^small/i.test(f.type) ? 'smallint' : 'int'`. Severity of `bigbigint`: major (invalid type in all three DBs); the rest minor.

### 15. CSV: stack overflow on large inputs, parseCsv drops empty rows, exports (major for performance; minor for the rest)
- `importers/csv.js` `inferType`: `Math.max(...vals.map(v => v.length))` spreads the whole column onto the call stack. Verified in Node 24: 120k values OK, 125k+ throws `RangeError: Maximum call stack size exceeded` (`d_csv.js`, `dbg` run). Importing any CSV with >~125k rows of text kills the import (and 200k/1M-row tests failed). Fix: `vals.reduce((m, v) => Math.max(m, v.length), 0)`.
- `parseCsv` filters rows `[""]`, so a single-column CSV with an empty cell loses that row, and an empty quoted last cell `a\n""` is dropped. Fix: only drop the final blank line, not blank-valued single-column rows.
- `tablesToCsvFiles` uses the table name verbatim as file name: `weird/name:*?.csv`, duplicate names (`t.csv` x2) and case collisions (`t.csv`/`T.csv`) are not de-duplicated or sanitised (zip/download breakage). `schemaToCsv` exports note/default values starting with `=`, `+`, `-`, `@` unescaped (spreadsheet formula injection). Fix: sanitise to `[^\w.-]` and de-duplicate case-insensitively; prefix such cells with `'`.

## Things that worked well
- Parser: never throws on any garbage/empty/null input, errors have line numbers (apart from Ref post-checks), CRLF/tabs/Thai notes OK, 2000-table input in <1s, no regex backtracking issues up to 200k-character lines.
- PG generator: real PGlite executes the output for ordinary schemas including serial/bigserial, composite PKs, junction tables, one-to-one unique, self-references, arrays, jsonb, reserved-word identifiers, Thai identifiers, 150-table FK chain, identifiers needing quotes.
- SQLite generator for tables/PK/AUTOINCREMENT/unique/indexes (everything except FKs and non-literal defaults).
- DDL importer happy paths: inline and table-level FKs with ON DELETE/UPDATE, backtick/bracket/quote identifiers, AUTO_INCREMENT, KEY/UNIQUE KEY, composite PKs, CRLF, real binary SQLite via sql.js, views/triggers ignored, `;` inside strings and trigger bodies when no `--`/escape quirks are involved.
- CSV: BOM, delimiter detection, quoted fields with embedded newlines, leading zeros stay text, 100k rows x 9 columns parse+infer quickly.

## Not verified / caveats
- No MySQL server: MySQL conclusions come from node-sql-parser plus rules (backtick quoting, auto_increment key requirement, TEXT keys/defaults, varchar length, FK type match, inline-REFERENCES behaviour). Bug 7 and the TEXT/DEFAULT findings follow documented MySQL behaviour, not an executed run.
- `apps/web/src/lib/files.js` was not run (needs browser APIs); only its sqlite logic (`select sql from sqlite_master` -> `ddlToSchema`) was replicated in Node, and spec/xlsx/Mongo-JSON importers were not tested.
- Some area B "FAIL" rows are intentionally invalid inputs (duplicate table/field names, FK to a non-unique column, a composite-PK column referenced individually) where the generator passes the problem through; a warning would be nicer but these are not counted as bugs above.
