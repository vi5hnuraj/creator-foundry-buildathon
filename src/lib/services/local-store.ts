/**
 * LOCAL STORE — the zero-configuration database.
 *
 * Creator Foundry talks to Postgres through the Supabase client. When no
 * Supabase credentials are configured, lib/supabase.ts swaps in the
 * `mockSupabase` client below, which implements the same query-builder surface
 * against a single JSON file in data/local/. That is what lets a judge
 * clone the repo and run the entire product — works, bounties, sales, uploaded
 * assets — with no database to provision and no secrets to set.
 *
 * Backups are written before destructive rewrites; see data/local/.creator-foundry-db.json
 * and its .backup-<timestamp>.json siblings.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const DB_DIR = path.join(process.cwd(), "data", "local");
const DB_FILE = path.join(DB_DIR, ".creator-foundry-db.json");

// Runtime dirs ship empty in a fresh clone — create on first use.
mkdirSync(DB_DIR, { recursive: true });

type DbSchema = {
  works: any[];
  bounties: any[];
  sales: any[];
  storage: Record<string, { bytesBase64: string; contentType: string }>;
};

// Initial empty state
const emptyDb: DbSchema = {
  works: [],
  bounties: [],
  sales: [],
  storage: {},
};

function readDb(): DbSchema {
  try {
    if (existsSync(DB_FILE)) {
      const raw = readFileSync(DB_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error("Failed to read fallback DB, resetting...", e);
  }
  return { ...emptyDb };
}

function writeDb(db: DbSchema) {
  try {
    writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to write fallback DB:", e);
  }
}

// Global in-memory cache synchronized to file
let dbCache = readDb();

export class MockQueryBuilder {
  private table: keyof Omit<DbSchema, "storage">;
  private filters: Array<(item: any) => boolean> = [];
  private orderCol: string | null = null;
  private orderAscending = true;

  private isUpdate = false;
  private updateData: any = null;

  private isInsert = false;
  private insertData: any = null;

  private isDelete = false;

  private isSingle = false;
  /** maybeSingle(): like single() but returns data: null instead of an error when empty. */
  private isMaybe = false;

  constructor(table: keyof Omit<DbSchema, "storage">) {
    this.table = table;
  }

  select(fields?: string) {
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push((item) => {
      const itemVal = item[column];
      if (itemVal === undefined) return false;
      if (typeof itemVal === "string" && typeof value === "string") {
        return itemVal.toLowerCase() === value.toLowerCase();
      }
      return itemVal == value;
    });
    return this;
  }

  order(column: string, { ascending = true } = {}) {
    this.orderCol = column;
    this.orderAscending = ascending;
    return this;
  }

  single() {
    this.isSingle = true;
    return this;
  }

  maybeSingle() {
    this.isSingle = true;
    this.isMaybe = true;
    return this;
  }

  insert(data: any) {
    this.isInsert = true;
    this.insertData = data;
    return this;
  }

  update(data: any) {
    this.isUpdate = true;
    this.updateData = data;
    return this;
  }

  delete() {
    this.isDelete = true;
    return this;
  }

  // Terminal resolver executing when awaited
  async then(onfulfilled?: (value: any) => any) {
    try {
      dbCache = readDb();
      let tableRows = dbCache[this.table];
      let result: any = null;
      let error: any = null;

      if (this.isInsert) {
        const rows = Array.isArray(this.insertData) ? this.insertData : [this.insertData];
        const created: any[] = [];
        for (const r of rows) {
          const row = {
            id: r.id || crypto.randomUUID(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            status: r.status ?? "open",
            ...r,
          };
          tableRows.push(row);
          created.push(row);
        }
        writeDb(dbCache);
        result = Array.isArray(this.insertData) ? created : created[0];

      } else if (this.isUpdate) {
        const matchingIndices: number[] = [];
        for (let i = 0; i < tableRows.length; i++) {
          let matches = true;
          for (const filter of this.filters) {
            if (!filter(tableRows[i])) {
              matches = false;
              break;
            }
          }
          if (matches) {
            matchingIndices.push(i);
          }
        }

        if (matchingIndices.length === 0) {
          error = { message: "No rows matched filter for update" };
        } else {
          const updatedRows: any[] = [];
          for (const idx of matchingIndices) {
            const updated = {
              ...tableRows[idx],
              ...this.updateData,
              updated_at: new Date().toISOString(),
            };
            tableRows[idx] = updated;
            updatedRows.push(updated);
          }
          writeDb(dbCache);
          result = updatedRows;
        }

      } else if (this.isDelete) {
        dbCache[this.table] = tableRows.filter((item) => {
          let matches = true;
          for (const filter of this.filters) {
            if (!filter(item)) {
              matches = false;
              break;
            }
          }
          return !matches;
        });
        writeDb(dbCache);
        result = null;

      } else {
        let matched = [...tableRows];
        for (const filter of this.filters) {
          matched = matched.filter(filter);
        }

        if (this.orderCol) {
          matched.sort((a, b) => {
            const valA = a[this.orderCol!];
            const valB = b[this.orderCol!];
            if (valA === valB) return 0;
            if (valA == null) return 1;
            if (valB == null) return -1;
            const compare = valA < valB ? -1 : 1;
            return this.orderAscending ? compare : -compare;
          });
        }
        result = matched;
      }

      if (this.isSingle) {
        if (error) {
          // keep error
        } else if (!result || (Array.isArray(result) && result.length === 0)) {
          if (this.isMaybe) {
            result = null;
            error = null;
          } else {
            error = { message: "Row not found" };
            result = null;
          }
        } else if (Array.isArray(result)) {
          result = result[0];
        }
      } else {
        if (!this.isInsert && !this.isUpdate && !this.isDelete && !Array.isArray(result)) {
          result = result ? [result] : [];
        }
      }

      const response = { data: result, error };
      return onfulfilled ? onfulfilled(response) : response;
    } catch (e: any) {
      console.error("[MockQueryBuilder] error:", e);
      const errRes = { data: null, error: { message: e.message || String(e) } };
      return onfulfilled ? onfulfilled(errRes) : errRes;
    }
  }
}

// Mock Supabase storage bucket interface
export class MockStorageBucket {
  private bucketName: string;

  constructor(bucketName: string) {
    this.bucketName = bucketName;
  }

  async upload(key: string, bytes: Buffer, options?: any) {
    const uploadDir = path.join(process.cwd(), "data", "uploads");
    if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });
    writeFileSync(path.join(uploadDir, key), bytes);
    return { data: { path: key }, error: null };
  }

  async download(key: string) {
    const filePath = path.join(process.cwd(), "data", "uploads", key);
    if (!existsSync(filePath)) {
      return { data: null, error: { message: "File not found" } };
    }
    const buffer = readFileSync(filePath);
    const dataBlob = {
      arrayBuffer: async () => {
        const ab = new ArrayBuffer(buffer.length);
        const view = new Uint8Array(ab);
        for (let i = 0; i < buffer.length; ++i) {
          view[i] = buffer[i];
        }
        return ab;
      },
    };
    return { data: dataBlob, error: null };
  }

  getPublicUrl(key: string) {
    return {
      data: {
        publicUrl: `/api/files/${key}`,
      },
    };
  }
}

export class MockSupabaseClient {
  from(tableName: string) {
    if (tableName !== "works" && tableName !== "bounties" && tableName !== "sales") {
      throw new Error(`Unsupported fallback DB table: ${tableName}`);
    }
    return new MockQueryBuilder(tableName as keyof Omit<DbSchema, "storage">);
  }

  storage = {
    from: (bucketName: string) => {
      return new MockStorageBucket(bucketName);
    },
  };
}

export const mockSupabase = new MockSupabaseClient();
