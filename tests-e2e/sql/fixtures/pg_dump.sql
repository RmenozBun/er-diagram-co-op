--
-- PostgreSQL database dump
--

-- Dumped from database version 15.4
SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET default_tablespace = '';
SET default_table_access_method = heap;

CREATE SCHEMA IF NOT EXISTS app;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    full_name character varying(100),
    balance numeric(10,2) DEFAULT 0.00 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    is_active boolean DEFAULT true,
    bio text DEFAULT 'it''s; a "bio"'::text,
    tags text[],
    meta jsonb DEFAULT '{}'::jsonb,
    status character varying(20) DEFAULT 'new'::character varying,
    CONSTRAINT users_balance_check CHECK ((balance >= (0)::numeric))
);

ALTER TABLE public.users OWNER TO postgres;

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;

CREATE TABLE public.orders (
    id bigint NOT NULL,
    user_id integer NOT NULL,
    total double precision,
    placed_at date,
    note character(10),
    CONSTRAINT orders_total_check CHECK (total > 0 AND total < 1000000)
);

CREATE TABLE public.order_items (
    order_id bigint NOT NULL,
    line_no smallint NOT NULL,
    sku character varying(32) NOT NULL,
    qty integer DEFAULT 1 NOT NULL
);

CREATE TABLE public.products (
    sku character varying(32) NOT NULL,
    "Name" text NOT NULL,
    price numeric(12,4)
);

CREATE TABLE public."group" (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "order" integer
);

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);

COPY public.users (id, email, full_name, balance, created_at, updated_at, is_active, bio, tags, meta, status) FROM stdin;
1	a@example.com	Alice; Smith	10.00	2020-01-01 00:00:00	\N	t	hello	{a,b}	{}	new
2	b@example.com	Bob (the) builder	0.00	2020-01-01 00:00:00	\N	t	CREATE TABLE evil (x int);	{}	{}	new
\.

INSERT INTO public.products VALUES ('A-1', 'Widget; "big"', 9.99);
INSERT INTO public.products VALUES ('A-2', 'Gadget -- not a comment', 1.00);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (order_id, line_no);

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (sku);

ALTER TABLE ONLY public."group"
    ADD CONSTRAINT group_pkey PRIMARY KEY (id);

CREATE INDEX idx_orders_user ON public.orders USING btree (user_id);
CREATE UNIQUE INDEX idx_users_lower_email ON public.users USING btree (lower((email)::text));
CREATE INDEX idx_orders_placed ON public.orders USING btree (placed_at DESC, user_id);

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_sku_fkey FOREIGN KEY (sku) REFERENCES public.products(sku);

--
-- PostgreSQL database dump complete
--
