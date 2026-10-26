import { publicSourceWhereSql } from "./source-availability.js";

function alias(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error("Invalid source snapshot SQL alias");
  return value;
}

const value = entry => String(entry ?? "");
const integer = entry => Math.trunc(Number(entry) || 0);
const sqlText = expression => `COALESCE(CAST(${expression} AS TEXT),'')`;
const sqlInteger = expression => `CAST(COALESCE(${expression},0) AS INTEGER)`;

export function sourceSnapshotParent(row) {
  return [value(row.id), integer(row.version), value(row.updated_at), value(row.status)];
}

export function sourceSnapshotSource(row) {
  return [value(row.id), value(row.source), value(row.source_listing_id), integer(row.active), integer(row.missing_count),
    value(row.snapshot_hash), value(row.updated_at), value(row.last_collected_at),
    value(row.availability_kind), value(row.availability_updated_at)];
}

export function sourceSnapshotParentSql(parent = "listings") {
  const name = alias(parent);
  return `json_array(${sqlText(name + ".id")},${sqlInteger(name + ".version")},${sqlText(name + ".updated_at")},${sqlText(name + ".status")})`;
}

export function sourceSnapshotSourceSql(source = "proof_source") {
  const name = alias(source);
  return `json_array(${sqlText(name + ".id")},${sqlText(name + ".source")},${sqlText(name + ".source_listing_id")},
    ${sqlInteger(name + ".active")},${sqlInteger(name + ".missing_count")},${sqlText(name + ".snapshot_hash")},
    ${sqlText(name + ".updated_at")},${sqlText(name + ".last_collected_at")},
    COALESCE((SELECT proof_availability.kind FROM listing_source_availability proof_availability WHERE proof_availability.source_id=${name}.id),''),
    COALESCE((SELECT proof_availability.updated_at FROM listing_source_availability proof_availability WHERE proof_availability.source_id=${name}.id),'')
  )`;
}

export function sourceSnapshotProofSql(parent = "listings") {
  const name = alias(parent);
  return `json_array(json(${sourceSnapshotParentSql(name)}),json(COALESCE((
    SELECT '[' || group_concat(source_proof,',') || ']' FROM (
      SELECT ${sourceSnapshotSourceSql()} AS source_proof FROM listing_sources proof_source
      WHERE proof_source.listing_id=${name}.id AND ${publicSourceWhereSql("proof_source")}
      ORDER BY proof_source.rowid
    )
  ),'[]')))`;
}

export function canonicalSourceSnapshotProof(proof) {
  const parsed = typeof proof === "string" ? JSON.parse(proof) : proof;
  if (!Array.isArray(parsed) || parsed.length !== 2 || !Array.isArray(parsed[0]) || parsed[0].length !== 4 || !Array.isArray(parsed[1])) {
    throw new Error("Invalid source snapshot proof");
  }
  return JSON.stringify(parsed);
}

export async function hashSourceSnapshotProof(proof) {
  const bytes = new TextEncoder().encode(canonicalSourceSnapshotProof(proof));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return "sha256-v1:" + Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

// Avoid allocating 24,000 TextEncoders/promises/digests at once. Raw SQL proof
// strings are internal only and are removed as each bounded batch is hashed.
export async function hashSourceSnapshotRows(rows) {
  for (let offset = 0; offset < rows.length; offset += 24) {
    await Promise.all(rows.slice(offset, offset + 24).map(async row => {
      try {
        row.source_snapshot_key = row.source_snapshot_proof == null ? "" : await hashSourceSnapshotProof(row.source_snapshot_proof);
      } catch {
        // Missing/invalid proof is unknown, never a fabricated verified empty.
        row.source_snapshot_key = "";
      }
      delete row.source_snapshot_proof;
    }));
  }
  return rows;
}

// Only the exact source rows used to build the response may establish its key.
// A later query of the current source fingerprint cannot certify earlier rows.
export async function sourceSnapshotKeysFromReadRows(rows, parents) {
  const accumulator = createSourceSnapshotReadAccumulator();
  accumulator.add(rows);
  return accumulator.finish(parents);
}

// Retain only the small identity proof while a caller consumes raw snapshot
// pages. Full descriptions/photos must not survive until the final parent read.
export function createSourceSnapshotReadAccumulator() {
  const observed = new Map();
  return {
    add(rows) {
      for (const row of rows) {
        const id = value(row.listing_id);
        let group = observed.get(id);
        if (!group) {
          group = { parent: row.source_snapshot_parent_json, rows: [], conflict: false };
          observed.set(id, group);
        }
        if (!group.parent || group.parent !== row.source_snapshot_parent_json) group.conflict = true;
        group.rows.push(sourceSnapshotSource(row));
      }
    },
    async finish(parents) {
      const keys = {}, propertyIds = {};
      // Drain proofs as they are hashed. Holding every source fingerprint until
      // the final digest retains tens of MB beside the complete display groups.
      // Neither concurrent parent/source edits nor missing-source guards change.
      for (let offset = 0; offset < parents.length; offset += 24) {
        const proofs = [];
        for (const parent of parents.slice(offset, offset + 24)) {
          const id = value(parent.id), group = observed.get(id);
          observed.delete(id);
          if (!id) continue;
          const parentProof = JSON.stringify(sourceSnapshotParent(parent));
          const expectedCount = integer(parent.source_snapshot_source_count);
          // A missing source group is verified empty only when the final,
          // publication-guarded parent explicitly counted zero public sources.
          if (group ? group.conflict || group.parent !== parentProof || group.rows.length !== expectedCount : expectedCount !== 0) continue;
          proofs.push({ id, source_snapshot_proof: [sourceSnapshotParent(parent), group ? group.rows : []] });
          propertyIds[id] = value(parent.property_id) || id;
        }
        await hashSourceSnapshotRows(proofs);
        for (const row of proofs) keys[row.id] = row.source_snapshot_key;
      }
      observed.clear();
      return { keys, propertyIds };
    }
  };
}
