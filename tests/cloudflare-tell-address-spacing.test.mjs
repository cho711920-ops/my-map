import assert from "node:assert/strict";
import test from "node:test";

import {
  handleD1GetAction,
  tellContactSearchPatterns
} from "../cloudflare/src/d1-api.js";

test("Tell address search treats attached and spaced lot numbers equally", async () => {
  assert.deepEqual(tellContactSearchPatterns("탄방동793"), {
    query: "탄방동793",
    pattern: "%탄방동793%",
    compactPattern: "%탄방동793%"
  });
  assert.deepEqual(tellContactSearchPatterns("  탄방동   793  "), {
    query: "탄방동 793",
    pattern: "%탄방동 793%",
    compactPattern: "%탄방동793%"
  });

  const sql = [];
  const bindings = [];
  const env = {
    DB: {
      prepare(statement) {
        sql.push(statement);
        return {
          bind(...values) {
            bindings.push(values);
            return { async all() { return { results: [] }; } };
          }
        };
      }
    }
  };

  const result = await handleD1GetAction(env, { email: "owner@example.com" }, {
    action: "tellContacts",
    query: "탄방동793"
  });

  assert.equal(sql.length, 2);
  assert.ok(sql.every((statement) => /l\.address LIKE \?1/.test(statement)));
  assert.ok(sql.every((statement) => /REPLACE\(l\.address, ' ', ''\) LIKE \?2/.test(statement)));
  assert.deepEqual(bindings, [
    ["%탄방동793%", "%탄방동793%"],
    ["%탄방동793%", "%탄방동793%"]
  ]);
  assert.equal(result.query, "탄방동793");
});

test("Tell results include role-labelled numbers typed directly in the memo", async () => {
  const env = {
    DB: {
      prepare(statement) {
        const rows = statement.includes("FROM listing_contacts") ? [{
          id: "provider-1", listing_id: "M-1", role: "임", name: "",
          phone: "010-1111-2222", title: "진양빌딩", address: "서구 탄방동 793", room: "2층"
        }] : [{
          listing_id: "M-1", title: "진양빌딩", address: "서구 탄방동 793", room: "2층",
          operating_memo: "임) 010-1111-2222 / 주인 010-3333-4444 / 광고 010-9999-8888"
        }];
        return {
          bind() { return { async all() { return { results: rows }; } }; }
        };
      }
    }
  };

  const result = await handleD1GetAction(env, { email: "owner@example.com" }, {
    action: "tellContacts",
    query: "탄방동793"
  });

  assert.deepEqual(result.contacts.map((contact) => [contact.phone, contact.contactSource]), [
    ["010-1111-2222", "공실박스"],
    ["010-3333-4444", "직접 메모"]
  ]);
  assert.equal(result.contacts.some((contact) => contact.phone === "010-9999-8888"), false);
});
