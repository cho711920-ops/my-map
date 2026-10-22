export const isTransientCollectorDatabaseError = error => /D1_ERROR:.*(?:Network connection lost|internal error|temporarily unavailable|DB is overloaded|Requests queued for too long)/i.test(String(error?.message || error));

// A receipt inserted FIRST in the same D1 transaction fences the exact SQL
// statements. A lost COMMIT response can be reconciled immediately; retrying
// this identical transaction cannot increment counters/history twice, since
// its unique receipt insert rolls the entire duplicate transaction back.
// This helper does not replay an HTTP batch or release a pending parent claim.
export async function commitCollectorSourceTransaction(env, statements, identity) {
  if (!identity?.requestId) return env.DB.batch(statements);
  const packed = JSON.stringify([identity.requestId, identity.source, identity.sourceId, identity.offset]);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(packed));
  const id = "collector-source-step-" + Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2,"0")).join("");
  const descriptor = JSON.stringify({parentRequestId: identity.requestId, statementCount: statements.length});
  const receipt = env.DB.prepare(`INSERT INTO collector_source_write_receipts
    (id,result_json,created_at,expires_at)
    VALUES (?1,?2,?3,datetime('now','+7 days'))`)
    .bind(id,descriptor,new Date().toISOString());
  const transaction = [receipt,...statements];
  const committed = async () => {
    const saved = await env.DB.prepare(`SELECT result_json FROM collector_source_write_receipts WHERE id=?1`)
      .bind(id).first();
    return saved?.result_json === descriptor;
  };
  let ambiguous = false;
  for (let attempt = 0; ; attempt += 1) {
    try { return await env.DB.batch(transaction); }
    catch (error) {
      // A unique-receipt collision is expected only after an uncertain COMMIT.
      // Unrelated integrity errors must never be treated as successful saves.
      const collision = /UNIQUE constraint failed: collector_source_write_receipts.id/.test(String(error?.message || error));
      if (!isTransientCollectorDatabaseError(error) && !(ambiguous && collision)) throw error;
      ambiguous = true;
      try { if (await committed()) return []; } catch { /* The receipt read can be overloaded too. */ }
      if (attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve,250 * (attempt + 1)));
    }
  }
}
