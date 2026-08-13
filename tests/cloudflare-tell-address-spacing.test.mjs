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

  let sql = "";
  let bindings = [];
  const env = {
    DB: {
      prepare(statement) {
        sql = statement;
        return {
          bind(...values) {
            bindings = values;
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

  assert.match(sql, /l\.address LIKE \?1/);
  assert.match(sql, /REPLACE\(l\.address, ' ', ''\) LIKE \?2/);
  assert.deepEqual(bindings, ["%탄방동793%", "%탄방동793%"]);
  assert.equal(result.query, "탄방동793");
});
