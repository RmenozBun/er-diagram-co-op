-- hand written sqlite
PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;
CREATE TABLE IF NOT EXISTS authors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    born DATE,
    bio TEXT DEFAULT 'N/A; unknown'
);
CREATE TABLE books (
    id INTEGER PRIMARY KEY,
    author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    editor_id INTEGER,
    title VARCHAR(200) NOT NULL,
    isbn CHAR(13) UNIQUE,
    price REAL DEFAULT 9.99,
    in_print BOOLEAN DEFAULT 1,
    added DATETIME DEFAULT CURRENT_TIMESTAMP,
    data BLOB,
    FOREIGN KEY (editor_id) REFERENCES authors (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CHECK (price >= 0)
);
CREATE TABLE "book tags" (
    "book id" INTEGER NOT NULL,
    [tag name] TEXT NOT NULL,
    PRIMARY KEY ("book id", [tag name]),
    FOREIGN KEY ("book id") REFERENCES books(id)
) WITHOUT ROWID;
CREATE TABLE no_pk (a, b, c INT);
CREATE INDEX idx_books_title ON books (title COLLATE NOCASE);
CREATE UNIQUE INDEX idx_books_author_title ON books(author_id, title);
CREATE INDEX IF NOT EXISTS idx_partial ON books(price) WHERE price > 10;
CREATE VIEW v AS SELECT * FROM books;
CREATE TRIGGER trg AFTER INSERT ON books BEGIN
  UPDATE books SET price = 1; -- semi; inside trigger
END;
INSERT INTO authors(name, bio) VALUES ('Semi;colon', 'x -- y');
COMMIT;
