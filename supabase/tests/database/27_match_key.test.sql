-- T005 / milestone 1: app.match_key, app.website_host, app.is_shared_host (ADR 0010).
--
-- app.match_key(text) = NFKC normalise -> lower() -> drop ZWNJ / ZWJ (matching only; stored text keeps them)
--                       -> collapse [ \t\r\n\f\v] runs to one blank -> trim. Python (app.leads.keys) runs the SAME steps with
-- unicodedata.normalize('NFKC') and str.lower() (NOT casefold). The golden vectors below were produced by the Python side;
-- an exhaustive comparison of both implementations over every Unicode code point (docs/adr/0010) found them identical for
-- every code point this PostgreSQL's Unicode tables know; the 63 that differ were assigned after PostgreSQL 17 / its ICU.
--
-- IMMUTABLE is safe for the expression index because: normalize() is IMMUTABLE; lower() here uses the DATABASE default
-- collation (ICU, en_US.UTF-8), which is fixed for the life of the database; no session setting changes the result.
-- Caveat (docs/pre-pilot-checklist.md): a PostgreSQL / ICU upgrade that changes Unicode tables, or a restore into a database
-- with another collation, needs REINDEX of the two expression indexes on companies.
begin;
select no_plan();

-- ------------------------------------------------------------------ properties
select has_function('app', 'match_key', array['text']);
select is((select provolatile::text from pg_proc where oid = 'app.match_key(text)'::regprocedure), 'i', 'match_key is IMMUTABLE');
select is((select proparallel::text from pg_proc where oid = 'app.match_key(text)'::regprocedure), 's', 'match_key is PARALLEL SAFE');
select ok((select 'search_path=""' = any (proconfig) from pg_proc where oid = 'app.match_key(text)'::regprocedure), 'match_key pins search_path');
select ok(not (select prosecdef from pg_proc where oid = 'app.match_key(text)'::regprocedure), 'match_key is SECURITY INVOKER');
select ok(has_function_privilege('authenticated', 'app.match_key(text)', 'execute'), 'authenticated may execute it (an index expression is evaluated as the inserting role)');
select ok(not has_function_privilege('anon', 'app.match_key(text)', 'execute'), 'anon may not');
select is((select provolatile::text from pg_proc where oid = 'app.website_host(text)'::regprocedure), 'i', 'website_host is IMMUTABLE');
select ok((select 'search_path=""' = any (proconfig) from pg_proc where oid = 'app.website_host(text)'::regprocedure), 'website_host pins search_path');
select ok(has_function_privilege('authenticated', 'app.website_host(text)', 'execute'), 'authenticated may execute website_host (index expression)');
select ok(not has_function_privilege('anon', 'app.website_host(text)', 'execute'), 'anon may not');
select is((select provolatile::text from pg_proc where oid = 'app.is_shared_host(text)'::regprocedure), 'i', 'is_shared_host is IMMUTABLE');
select ok(not has_function_privilege('authenticated', 'app.is_shared_host(text)', 'execute'), 'is_shared_host is internal (only the import function uses it)');
select ok(not has_function_privilege('anon', 'app.is_shared_host(text)', 'execute'), 'anon may not');
select is((select datlocprovider::text from pg_database where datname = current_database()), 'i', 'sanity: this database uses the ICU provider (the parity result was measured here)');
select is(app.match_key(null), null, 'NULL in, NULL out');

-- ------------------------------------------------------------------ golden vectors (produced by the Python side)
create temp table vectors (label text, input text, expected text);
insert into vectors values
  ('ascii: lower-cases', 'Sri Lakshmi Silks', 'sri lakshmi silks'),
  ('ascii: collapses blanks, tabs and newlines', U&'  Sri   Lakshmi\+000009Silks\+00000A', 'sri lakshmi silks'),
  ('ascii: vertical tab and form feed are blanks', U&'a\+00000Bb\+00000Cc', 'a b c'),
  ('ascii: already clean', 'sri lakshmi silks', 'sri lakshmi silks'),
  ('ascii: only blanks', U&'   \+000009 \+00000A', ''),
  ('empty', '', ''),
  ('NFKC: full-width Latin', U&'\+00FF21\+00FF22\+00FF23\+003000\+00FF33\+00FF49\+00FF4C\+00FF4B\+00FF53', 'abc silks'),
  ('NFKC: ligatures', 'ﬁne ﬂax', 'fine flax'),
  ('NFKC: circled digits', '①②③', '123'),
  ('NFKC: superscript', 'x² m³', 'x2 m3'),
  ('NFKC: no-break space', U&'a\+0000A0b', 'a b'),
  ('NFKC: em space', U&'a\+002003b', 'a b'),
  ('NFKC: ideographic space', U&'a\+003000b', 'a b'),
  ('NFKC: narrow no-break space', U&'a\+00202Fb', 'a b'),
  ('NFKC: long compatibility expansion', 'ﷺ', 'صلى الله عليه وسلم'),
  ('Latin: accented capitals', 'ÉCOLE ÑANDÚ', 'école ñandú'),
  ('Latin: composed form', 'école', 'école'),
  ('Latin: decomposed form (e + acute) equals the composed key', U&'e\+000301cole', 'école'),
  ('Latin: sharp s stays', 'Straße', 'straße'),
  ('Latin: capital I with dot above (full mapping, two code points)', 'İstanbul', U&'i\+000307stanbul'),
  ('Latin: titlecase digraph', 'ǅemal', 'džemal'),
  ('Latin: Polish / Czech letters', 'ŁÓDŹ ŘEKA', 'łódź řeka'),
  ('Latin: Vietnamese stacked marks', 'Ế Ệ', 'ế ệ'),
  ('Greek: final sigma', 'ΟΔΟΣ', 'οδος'),
  ('Greek: word with an inner sigma', 'Σίσυφος', 'σίσυφος'),
  ('Cyrillic', 'МОСКВА', 'москва'),
  ('Arabic', 'مرحبا بكم', 'مرحبا بكم'),
  ('Hebrew', 'שלום עולם', 'שלום עולם'),
  ('CJK', U&'\+0065E5\+00672C\+008A9E\+003000\+0030C6\+0030B9\+0030C8', '日本語 テスト'),
  ('emoji are untouched', 'silk 😀 house', 'silk 😀 house'),
  ('Telugu (no case): kept as is', U&'DEMO \+000C36\+000C4D\+000C30\+000C40 \+000C38\+000C3F\+000C32\+000C4D\+000C15\+000C4D\+000C38\+000C4D (\+000C15\+000C32\+000C4D\+000C2A\+000C3F\+000C24)', U&'demo \+000C36\+000C4D\+000C30\+000C40 \+000C38\+000C3F\+000C32\+000C4D\+000C15\+000C4D\+000C38\+000C4D (\+000C15\+000C32\+000C4D\+000C2A\+000C3F\+000C24)'),
  ('Telugu with a ZWNJ inside a word', U&'DEMO \+000C38\+000C3F\+000C32\+000C4D\+000C15\+000C4D\+00200C\+000C38\+000C4D (\+000C15\+000C32\+000C4D\+000C2A\+000C3F\+000C24)', U&'demo \+000C38\+000C3F\+000C32\+000C4D\+000C15\+000C4D\+000C38\+000C4D (\+000C15\+000C32\+000C4D\+000C2A\+000C3F\+000C24)'),
  ('Kannada (no case): kept as is', U&'DEMO \+000CB8\+000CBF\+000CB2\+000CCD\+000C95\+000CCD \+000CB9\+000CCC\+000CB8\+000CCD (\+000C95\+000CBE\+000CB2\+000CCD\+000CAA\+000CA8\+000CBF\+000C95)', U&'demo \+000CB8\+000CBF\+000CB2\+000CCD\+000C95\+000CCD \+000CB9\+000CCC\+000CB8\+000CCD (\+000C95\+000CBE\+000CB2\+000CCD\+000CAA\+000CA8\+000CBF\+000C95)'),
  ('Kannada with a ZWJ', U&'DEMO \+000CB8\+000CBF\+000CB2\+000CCD\+000C95\+000CCD\+00200D \+000CB9\+000CCC\+000CB8\+000CCD', U&'demo \+000CB8\+000CBF\+000CB2\+000CCD\+000C95\+000CCD \+000CB9\+000CCC\+000CB8\+000CCD'),
  ('Devanagari with a precomposed nukta letter (NFKC decomposes it)', U&'\+000921\+000947\+00092E\+00094B \+000938\+00093E\+000921\+00093C\+000940', U&'\+000921\+000947\+00092E\+00094B \+000938\+00093E\+000921\+00093C\+000940'),
  ('Devanagari conjunct with a ZWJ', U&'\+000915\+00094D\+00200D\+000937', U&'\+000915\+00094D\+000937'),
  ('Persian with a ZWNJ', U&'\+000645\+0006CC\+00200C\+00062E\+000648\+000627\+000647\+000645', 'میخواهم'),
  ('Tamil', U&'DEMO \+000BA4\+000BAE\+000BBF\+000BB4\+000BCD \+000BAA\+000B9F\+000BCD\+000B9F\+000BC1\+000BAA\+000BCD \+000BAA\+000BC1\+000B9F\+000BB5\+000BC8', U&'demo \+000BA4\+000BAE\+000BBF\+000BB4\+000BCD \+000BAA\+000B9F\+000BCD\+000B9F\+000BC1\+000BAA\+000BCD \+000BAA\+000BC1\+000B9F\+000BB5\+000BC8'),
  ('Malayalam', U&'DEMO \+000D2E\+000D32\+000D2F\+000D3E\+000D33\+000D02 \+000D38\+000D3F\+000D7D\+000D15\+000D4D\+000D15\+000D4D', U&'demo \+000D2E\+000D32\+000D2F\+000D3E\+000D33\+000D02 \+000D38\+000D3F\+000D7D\+000D15\+000D4D\+000D15\+000D4D'),
  ('mixed script', U&'DEMO Silks \+000C36\+000C4D\+000C30\+000C40 \+000CB8\+000CBF\+000CB2\+000CCD\+000C95\+000CCD \+000938\+00093E\+000921\+00093C\+000940', U&'demo silks \+000C36\+000C4D\+000C30\+000C40 \+000CB8\+000CBF\+000CB2\+000CCD\+000C95\+000CCD \+000938\+00093E\+000921\+00093C\+000940'),
  ('a ZWJ between Latin letters is dropped', U&'a\+00200Db', 'ab'),
  ('a ZWNJ between Latin letters is dropped', U&'a\+00200Cb', 'ab'),
  ('only joiners', U&'\+00200C\+00200D\+00200C', ''),
  ('joiners around blanks: stripped BEFORE blanks collapse', U&' a \+00200D b ', 'a b'),
  ('LRM and RLM are NOT stripped (only ZWNJ / ZWJ are)', U&'a\+00200Eb\+00200Fc', U&'a\+00200Eb\+00200Fc'),
  ('zero-width space is NOT stripped (hygiene rejects it elsewhere)', U&'a\+00200Bb', U&'a\+00200Bb'),
  ('combining mark alone', U&'\+000301', U&'\+000301'),
  ('digits and punctuation', 'No. 12-B, 3rd Cross (Main) / Road', 'no. 12-b, 3rd cross (main) / road'),
  ('a long value', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
select is(app.match_key(input), expected, 'match_key: ' || label) from vectors order by label;
select cmp_ok((select count(*) from vectors), '>=', 40::bigint, 'the vector table is not vacuous');
select is(
  app.match_key('e' || chr(769) || 'cole'), app.match_key('école'),
  'composed and decomposed spellings of the same word share one key');
select is(app.match_key('క్ష' || chr(8205) || 'త'), app.match_key('క్షత'), 'Telugu: a ZWJ does not change the key');
select isnt(app.match_key('క్ష'), app.match_key('క్షత'), 'Telugu: different words keep different keys');
select isnt(app.match_key('ಸಿಲ್ಕ್'), app.match_key('ಸಿಲ್ಕ'), 'Kannada: different words keep different keys');
select isnt(app.match_key('exаmple'), app.match_key('example'), 'a Cyrillic look-alike letter is NOT merged with Latin (documented)');

-- ------------------------------------------------------------------ properties over EVERY code point
select is((select count(*) from generate_series(1, 1114111) cp
            where cp not between 55296 and 57343
              and app.match_key('a' || chr(cp) || 'b') ~ (chr(8204) || '|' || chr(8205))), 0::bigint,
  'no code point leaves a ZWNJ / ZWJ in a key');
select is((select count(*) from generate_series(1, 1114111) cp
            where cp not between 55296 and 57343
              and app.match_key(chr(cp)) ~ '^[ \t\r\n\f\v]|[ \t\r\n\f\v]$'), 0::bigint, 'a key is never padded');
select is((select count(*) from generate_series(1, 1114111) cp
            where cp not between 55296 and 57343
              and app.match_key('a' || chr(cp) || chr(cp) || 'b') ~ '[ \t\r\n\f\v]{2}'), 0::bigint, 'blanks never double up');
select is((select count(*) from generate_series(1, 1114111) cp
            where cp not between 55296 and 57343
              and app.match_key(chr(cp) || 'A') !~ 'a$'), 0::bigint, 'an ASCII capital always folds (a combining mark can only attach to what comes BEFORE it)');
select is((select count(*) from generate_series(1, 1114111) cp
            where cp not between 55296 and 57343
              and app.match_key('x' || chr(cp) || 'y') is null), 0::bigint, 'a key is never NULL for a non-NULL input');

-- ------------------------------------------------------------------ website_host
create temp table hosts (input text, expected text);
insert into hosts values
  ('https://www.Example-Shop.com/path?q=1', 'example-shop.com'),
  ('HTTP://shop.example.org:8080/x', 'shop.example.org'),
  ('www.shop.example.com', 'shop.example.com'),
  ('shop.example.com/about', 'shop.example.com'),
  ('shop.example.com:8443', 'shop.example.com'),
  ('https://user:pw@shop.example.com/', 'shop.example.com'),
  ('//shop.example.com/x', 'shop.example.com'),
  ('  WWW.Shop.Example.COM  ', 'shop.example.com'),
  ('https://shop.example.com./', 'shop.example.com'),
  ('https://xn--bcher-kva.example/', 'xn--bcher-kva.example'),
  ('https://www.com/', 'www.com'),
  ('localhost', 'localhost'),
  ('https://shop.example.com#frag', 'shop.example.com'),
  ('https://shop.example.com?x=1', 'shop.example.com'),
  ('https://', null),
  ('', null),
  ('   ', null),
  (null, null),
  ('not a url', null),
  ('https://exa mple.com/', null),
  ('https://[::1]/', null),
  ('https://bücher.example/', null),
  ('https://-bad.example/', null),
  ('https://bad-.example/', null),
  ('ftp://shop.example.com/', 'shop.example.com');
select is(app.website_host(input), expected, 'website_host: ' || coalesce(quote_literal(input), 'NULL')) from hosts;
select cmp_ok((select count(*) from hosts), '>=', 20::bigint, 'the host vector table is not vacuous');

-- ------------------------------------------------------------------ is_shared_host (shared / marketplace hosts never identify one business)
create temp table shared (host text, expected boolean);
insert into shared values
  ('facebook.com', true),
  ('m.facebook.com', true),
  ('www.facebook.com', true),
  ('instagram.com', true),
  ('linktr.ee', true),
  ('wa.me', true),
  ('sites.google.com', true),
  ('google.com', true),
  ('youtube.com', true),
  ('linkedin.com', true),
  ('x.com', true),
  ('business.site', true),
  ('shop.business.site', true),
  ('blogspot.com', true),
  ('abc.blogspot.com', true),
  ('wixsite.com', true),
  ('abc.wixsite.com', true),
  ('myshopify.com', true),
  ('abc.myshopify.com', true),
  ('indiamart.com', true),
  ('justdial.com', true),
  ('amazon.in', true),
  ('flipkart.com', true),
  ('github.io', true),
  ('netlify.app', true),
  ('notfacebook.com', false),
  ('facebook.com.evil.example', false),
  ('example.com', false),
  ('shop.example.org', false),
  ('xfb.com', false),
  ('silks.example.test', false),
  ('', false);
select is(app.is_shared_host(host), expected, 'is_shared_host: ' || quote_literal(host)) from shared;
select is(app.is_shared_host(null), false, 'is_shared_host(NULL) is false');

select * from finish();
rollback;
