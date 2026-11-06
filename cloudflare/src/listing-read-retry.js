const wrappers = new WeakMap();
export function transientListingReadError(error) {
  return /(?:D1_ERROR:.*(?:Network connection lost|internal error|temporarily unavailable|DB is overloaded|Requests queued for too long)|D1 DB is overloaded|Too many resources consumed within a 10 second window)/i.test(String(error?.message || error));
}

// Retry SELECT results only. A write, RETURNING statement, batch or transaction
// is never replayed here. In particular this does not change collector receipts.
export function listingReadEnv(env, pause = ms => new Promise(resolve => setTimeout(resolve,ms))) {
  if (!env.DB?.prepare) return env;
  if (wrappers.has(env)) return wrappers.get(env);
  const originals=new WeakMap();
  function statement(sql, target) {
    const wrapped=new Proxy(target,{get(object,name) {
      if (name === "bind") return (...values) => statement(sql,object.bind(...values));
      if ((name === "all" || name === "first") && /^\s*SELECT\b/i.test(sql)) return async (...args) => {
        for (let attempt=0;;attempt++) {
          try {return await object[name](...args);}
          catch (error) {
            if (attempt>=2 || !transientListingReadError(error)) throw error;
            await pause(attempt ? 3000 : 1000);
          }
        }
      };
      const value=Reflect.get(object,name);
      return typeof value === "function" ? value.bind(object) : value;
    }});
    originals.set(wrapped,target);return wrapped;
  }
  const DB=new Proxy(env.DB,{get(object,name) {
    if (name === "prepare") return sql=>statement(sql,object.prepare(sql));
    if (name === "batch") return values=>object.batch(values.map(value=>originals.get(value)||value));
    const value=Reflect.get(object,name);
    return typeof value === "function" ? value.bind(object) : value;
  }});
  const wrapped={...env,DB};wrappers.set(env,wrapped);wrappers.set(wrapped,wrapped);return wrapped;
}
