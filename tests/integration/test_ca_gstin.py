"""Job CA (ADR 0081) on the real stack: GSTIN through OUR API. The rule in the database equals the rule in Python (a thousand and more numbers), a customer's GSTIN is set, normalised, refused when wrong and
cleared through the CRM API, the shop's own GSTIN through the business profile (second factor, roles), and both show on an order, a quote and in the accounting files (CSV, XLSX, Vyapar; not in the Tally files).
All data is synthetic."""

# ruff: noqa: E501, S608, S311

from __future__ import annotations

import io
import random
import uuid
import zipfile
from typing import Any

import operator_sql
from conftest import aal1_token
from crm_support import World
from fastapi.testclient import TestClient
from order_support import OrderWorld
from test_bi_integrations_api import (  # noqa: F401 - `ow` is a fixture
    export,
    hdr,
    ow,
    run_order,
    url,
)

from app import gstin as g
from app.integrations.xlsx import read_xlsx

ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def _candidates() -> list[str]:
    rng = random.Random(20261121)
    out: list[str] = ["27AAPFU0939F1ZV", "29AAGCB7383J1Z4", "24AAACC1206D1ZM", "", " 27AAPFU0939F1ZV", "27aapfu0939f1zv"]
    for _ in range(700):
        state = rng.choice([*sorted(g.STATE_NAMES), "00", "39", "40", "98"])
        pan = "".join(rng.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ") for _ in range(5)) + "".join(rng.choice("0123456789") for _ in range(4)) + rng.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
        body = state + pan + rng.choice("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ") + rng.choice("ZZZZY")
        right = g.check_character(body) if all(c in ALPHABET for c in body) else "0"
        out += [body + right, body + rng.choice(ALPHABET), body[:-1], body + right + "0"]
    for _ in range(300):
        out.append("".join(rng.choice(ALPHABET) for _ in range(15)))
    return out


def test_the_rule_in_the_database_equals_the_rule_in_python() -> None:
    numbers = _candidates()
    assert len(numbers) > 1500
    expected = [g.is_valid(n) for n in numbers]
    assert sum(expected) > 300 and not all(expected)
    values = ",".join("'" + n.replace("'", "''") + "'" for n in numbers)
    rows = operator_sql.sql(f"select string_agg(case when app.gstin_is_valid(v) then 't' else 'f' end, '' order by o) from unnest(array[{values}]) with ordinality as x(v, o)")
    assert rows == "".join("t" if e else "f" for e in expected)


def test_a_customers_gstin_through_the_crm_api(eval_world: World) -> None:
    w, a, b = eval_world, eval_world.a, eval_world.b
    cid = str(uuid.uuid4())
    made = w.call(a.users["owner"], "POST", a, "companies", json={"id": cid, "name": "GSTIN Silks", "gstin": " 27aapfu0939f1zv "})
    assert made.status_code == 201, made.text
    assert made.json()["gstin"] == "27AAPFU0939F1ZV"
    assert operator_sql.sql(f"select gstin from public.companies where id = '{cid}'") == "27AAPFU0939F1ZV"
    bad = w.call(a.users["sales"], "POST", a, "companies", json={"id": str(uuid.uuid4()), "name": "Bad GSTIN Silks", "gstin": "27AAPFU0939F1ZW"})
    assert bad.status_code == 422
    changed = w.call(a.users["sales"], "PATCH", a, "companies", f"/{cid}", json={"gstin": "29AAGCB7383J1Z4"})
    assert changed.status_code == 200 and changed.json()["gstin"] == "29AAGCB7383J1Z4"
    assert w.call(a.users["viewer"], "PATCH", a, "companies", f"/{cid}", json={"gstin": "24AAACC1206D1ZM"}).status_code == 403
    assert w.call(b.users["owner"], "PATCH", b, "companies", f"/{cid}", json={"gstin": "24AAACC1206D1ZM"}).status_code == 404
    got = w.call(a.users["viewer"], "GET", a, "companies", f"/{cid}")
    assert got.status_code == 200 and got.json()["gstin"] == "29AAGCB7383J1Z4"
    cleared = w.call(a.users["owner"], "PATCH", a, "companies", f"/{cid}", json={"gstin": None})
    assert cleared.status_code == 200 and cleared.json()["gstin"] is None


def test_the_shops_gstin_through_the_business_profile(client: TestClient, eval_world: World) -> None:
    a, b = eval_world.a, eval_world.b
    path = f"/v1/tenants/{a.id}/business-profile"

    def call(method: str, user: str, tenant: Any = a, body: Any = None, weak: bool = False) -> Any:
        person = tenant.users[user]
        token = aal1_token(eval_world.stack, person) if weak else person.token
        return client.request(method, f"/v1/tenants/{tenant.id}/business-profile", json=body, headers={"Authorization": f"Bearer {token}"})

    assert call("GET", "viewer").json() == {"gstin": None, "state": None}
    put = call("PUT", "owner", body={"gstin": "24 aaacc1206d1zm"})
    assert put.status_code == 200 and put.json() == {"gstin": "24AAACC1206D1ZM", "state": "Gujarat"}
    assert call("GET", "sales").json() == {"gstin": "24AAACC1206D1ZM", "state": "Gujarat"}
    assert call("PUT", "admin", body={"gstin": "29AAGCB7383J1Z4"}).json()["state"] == "Karnataka"
    assert call("PUT", "sales", body={"gstin": "24AAACC1206D1ZM"}).status_code == 403
    assert call("PUT", "viewer", body={"gstin": "24AAACC1206D1ZM"}).status_code == 403
    weak = call("PUT", "owner", body={"gstin": "24AAACC1206D1ZM"}, weak=True)
    assert weak.status_code == 403 and weak.json()["error"]["code"] == "mfa_required"
    assert call("PUT", "owner", body={"gstin": "24AAACC1206D1ZX"}).status_code == 422
    assert call("PUT", "owner", body={}).status_code == 422
    assert call("GET", "owner", tenant=b).json() == {"gstin": None, "state": None}, "another business has its own"
    assert client.get(path, headers={"Authorization": f"Bearer {b.users['owner'].token}"}).status_code == 404, "and cannot read this one's"
    assert operator_sql.sql(f"select gstin from public.business_profile where tenant_id = '{a.id}'") == "29AAGCB7383J1Z4"
    assert call("PUT", "owner", body={"gstin": "24AAACC1206D1ZM"}).status_code == 200


def test_both_gstins_show_on_the_order_the_quote_and_in_the_files(client: TestClient, ow: OrderWorld) -> None:  # noqa: F811
    order, order_no, total, advance = run_order(client, ow, [("sales", "send_quote", None), ("sales", "customer_accept", None)])
    company = operator_sql.sql(f"select l.company_id from public.orders o join public.leads l on l.id = o.lead_id where o.id = '{order}'")
    if not company:  # the fixture's lead has no company: give it one (synthetic)
        company = str(uuid.uuid4())
        operator_sql.sql(f"insert into public.companies (id, tenant_id, name) select '{company}', tenant_id, 'Ravi Export Silks' from public.orders where id = '{order}' on conflict do nothing")
        operator_sql.sql(f"update public.leads set company_id = '{company}' where id = (select lead_id from public.orders where id = '{order}')")
    assert client.patch(url(ow.t, f"/companies/{company}"), json={"gstin": "36AAACR5055K1Z8"}, headers=hdr(ow, "owner")).status_code == 200
    assert client.put(url(ow.t, "/business-profile"), json={"gstin": "36AABCU9603R1ZO"}, headers=hdr(ow, "owner")).status_code == 200

    got = client.get(url(ow.t, f"/orders/{order}"), headers=hdr(ow, "sales")).json()
    assert (got["customer_gstin"], got["shop_gstin"]) == ("36AAACR5055K1Z8", "36AABCU9603R1ZO")
    quote = operator_sql.sql(f"select quote_id from public.orders where id = '{order}'")
    q = client.get(url(ow.t, f"/quotes/{quote}"), headers=hdr(ow, "sales")).json()
    assert (q["customer_gstin"], q["shop_gstin"]) == ("36AAACR5055K1Z8", "36AABCU9603R1ZO")
    listed = client.get(url(ow.t, "/quotes"), headers=hdr(ow, "sales")).json()
    mine = [x for x in listed if x["id"] == quote]
    assert mine and mine[0]["customer_gstin"] == "36AAACR5055K1Z8"
    assert "shop_gstin" not in mine[0]
    text = client.get(url(ow.t, f"/quotes/{quote}/text"), headers=hdr(ow, "sales"))
    assert "36AAACR5055K1Z8" not in text.text, "the quote's text is fixed by the pinned engine and is not changed"

    csv_text = export(client, ow).content.decode("utf-8-sig")
    sale = [line.split(",") for line in csv_text.strip().split("\r\n") if line.startswith("Sale") and f",{order_no}," in line]
    assert sale and sale[0][5] == "36AAACR5055K1Z8" and sale[0][-1] == "36AABCU9603R1ZO"
    parties = read_xlsx(export(client, ow, fmt="vyapar_xlsx").content, 0)
    assert parties.name == "Parties" and any("36AAACR5055K1Z8" in row for row in parties.rows[1:])
    zipped = zipfile.ZipFile(io.BytesIO(export(client, ow, fmt="tally_zip").content))
    assert all(b"36AAACR5055K1Z8" not in zipped.read(n) and b"36AABCU9603R1ZO" not in zipped.read(n) for n in zipped.namelist())


def test_the_other_business_sees_none_of_it(client: TestClient, eval_world: World) -> None:
    b = eval_world.b
    assert operator_sql.sql(f"select count(*) from public.companies where tenant_id = '{b.id}' and gstin is not null") == "0"
    assert operator_sql.sql(f"select coalesce(gstin, 'none') from public.business_profile where tenant_id = '{b.id}'") in ("", "none")
