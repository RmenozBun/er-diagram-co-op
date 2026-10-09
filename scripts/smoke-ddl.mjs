import { ddlToSchema, serialize, parse, toSQL } from '@er/schema'

const dump = String.raw`
CREATE TABLE ${'`'}a b${'`'} (id int unsigned NOT NULL AUTO_INCREMENT, u varchar(100) DEFAULT 'http://x.com/a--b', n text COMMENT 'it''s', PRIMARY KEY (id), CONSTRAINT c CHECK (id>0)) ENGINE=InnoDB;
INSERT INTO t VALUES ('O\'Brien -- x /* y */'); CREATE TABLE after_bs (id bigserial PRIMARY KEY, a_id int REFERENCES "a b"(id), created timestamp without time zone DEFAULT now(), d varchar DEFAULT 'x'::character varying);
ALTER TABLE ONLY after_bs ADD CONSTRAINT u UNIQUE (a_id);
CREATE INDEX i ON after_bs USING btree (created DESC, a_id);
`
const s = ddlToSchema(dump)
const text = serialize(s)
console.log(text)
console.log('re-parse errors:', parse(text).errors)
console.log(toSQL(s, 'sqlite'))
