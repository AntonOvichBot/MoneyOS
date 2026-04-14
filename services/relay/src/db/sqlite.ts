import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { PolicyInput } from "../policy/types.js";

export type SubmissionStatus = "pending" | "submitted" | "confirmed" | "failed" | "rejected";

export interface SubmissionRecord {
  id: string;
  status: SubmissionStatus;
  txHash: `0x${string}` | null;
  reason: string | null;
  createdAt: number;
  updatedAt: number;
  confirmedAt: number | null;
  receiptBlockNumber: string | null;
  receiptGasUsed: string | null;
}

export interface UsageSummary {
  txCount: number;
  gasWei: bigint;
}

interface UsageRow {
  tx_count: number;
  gas_wei: string;
}

interface SubmissionRow {
  id: string;
  status: SubmissionStatus;
  tx_hash: `0x${string}` | null;
  reason: string | null;
  created_at: number;
  updated_at: number;
  confirmed_at: number | null;
  receipt_block_number: string | null;
  receipt_gas_used: string | null;
}

export class RelayDatabase {
  private readonly db: Database.Database;

  constructor(filename: string) {
    if (filename !== ":memory:") {
      fs.mkdirSync(path.dirname(filename), { recursive: true });
    }

    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  reserveNonce(intent: PolicyInput["intent"], submissionId: string, nowSeconds: number): boolean {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO nonce_reservations
       (submission_id, account, sponsor, nonce_key, nonce_seq, created_at)
       VALUES (@submissionId, @account, @sponsor, @nonceKey, @nonceSeq, @createdAt)`,
    );

    const result = insert.run({
      submissionId,
      account: intent.account.toLowerCase(),
      sponsor: intent.sponsor.toLowerCase(),
      nonceKey: intent.nonceKey.toString(),
      nonceSeq: intent.nonceSeq.toString(),
      createdAt: nowSeconds,
    });

    if (result.changes > 0) {
      return true;
    }

    const existing = this.db
      .prepare("SELECT submission_id FROM nonce_reservations WHERE submission_id = ?")
      .get(submissionId) as { submission_id: string } | undefined;

    return existing?.submission_id === submissionId;
  }

  upsertSubmission(
    id: string,
    status: SubmissionStatus,
    nowSeconds: number,
    updates: {
      txHash?: `0x${string}` | null;
      reason?: string | null;
      confirmedAt?: number | null;
      receiptBlockNumber?: bigint | null;
      receiptGasUsed?: bigint | null;
    } = {},
  ): void {
    const existing = this.db
      .prepare("SELECT id FROM submissions WHERE id = ?")
      .get(id) as { id: string } | undefined;

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO submissions
           (id, status, tx_hash, reason, created_at, updated_at, confirmed_at, receipt_block_number, receipt_gas_used)
           VALUES (@id, @status, @txHash, @reason, @createdAt, @updatedAt, @confirmedAt, @receiptBlockNumber, @receiptGasUsed)`,
        )
        .run({
          id,
          status,
          txHash: updates.txHash ?? null,
          reason: updates.reason ?? null,
          createdAt: nowSeconds,
          updatedAt: nowSeconds,
          confirmedAt: updates.confirmedAt ?? null,
          receiptBlockNumber: updates.receiptBlockNumber?.toString() ?? null,
          receiptGasUsed: updates.receiptGasUsed?.toString() ?? null,
        });
      return;
    }

    this.db
      .prepare(
        `UPDATE submissions
         SET status = @status,
             tx_hash = COALESCE(@txHash, tx_hash),
             reason = @reason,
             updated_at = @updatedAt,
             confirmed_at = @confirmedAt,
             receipt_block_number = @receiptBlockNumber,
             receipt_gas_used = @receiptGasUsed
         WHERE id = @id`,
      )
      .run({
        id,
        status,
        txHash: updates.txHash ?? null,
        reason: updates.reason ?? null,
        updatedAt: nowSeconds,
        confirmedAt: updates.confirmedAt ?? null,
        receiptBlockNumber: updates.receiptBlockNumber?.toString() ?? null,
        receiptGasUsed: updates.receiptGasUsed?.toString() ?? null,
      });
  }

  getSubmission(id: string): SubmissionRecord | null {
    const row = this.db.prepare("SELECT * FROM submissions WHERE id = ?").get(id) as
      | SubmissionRow
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      status: row.status,
      txHash: row.tx_hash,
      reason: row.reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      confirmedAt: row.confirmed_at,
      receiptBlockNumber: row.receipt_block_number,
      receiptGasUsed: row.receipt_gas_used,
    };
  }

  listSubmitted(): SubmissionRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM submissions WHERE status IN ('pending', 'submitted') AND tx_hash IS NOT NULL")
      .all() as SubmissionRow[];

    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      txHash: row.tx_hash,
      reason: row.reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      confirmedAt: row.confirmed_at,
      receiptBlockNumber: row.receipt_block_number,
      receiptGasUsed: row.receipt_gas_used,
    }));
  }

  getUsage(scope: string, nowSeconds: number, windowSeconds: number): UsageSummary {
    const minWindow = nowSeconds - windowSeconds + 1;
    const rows = this.db
      .prepare(
        `SELECT tx_count, gas_wei
         FROM usage_counters
         WHERE scope = ? AND window_start >= ?`,
      )
      .all(scope, minWindow) as UsageRow[];

    return rows.reduce(
      (acc, row) => {
        acc.txCount += row.tx_count;
        acc.gasWei += BigInt(row.gas_wei);
        return acc;
      },
      { txCount: 0, gasWei: 0n } as UsageSummary,
    );
  }

  recordUsage(scope: string, nowSeconds: number, windowSeconds: number, gasWei: bigint): void {
    const windowStart = nowSeconds - (nowSeconds % windowSeconds);
    const row = this.db
      .prepare("SELECT tx_count, gas_wei FROM usage_counters WHERE scope = ? AND window_start = ?")
      .get(scope, windowStart) as UsageRow | undefined;

    if (!row) {
      this.db
        .prepare(
          `INSERT INTO usage_counters (scope, window_start, tx_count, gas_wei)
           VALUES (?, ?, ?, ?)`,
        )
        .run(scope, windowStart, 1, gasWei.toString());
      return;
    }

    this.db
      .prepare(
        `UPDATE usage_counters
         SET tx_count = ?, gas_wei = ?
         WHERE scope = ? AND window_start = ?`,
      )
      .run(row.tx_count + 1, (BigInt(row.gas_wei) + gasWei).toString(), scope, windowStart);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nonce_reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        submission_id TEXT NOT NULL UNIQUE,
        account TEXT NOT NULL,
        sponsor TEXT NOT NULL,
        nonce_key TEXT NOT NULL,
        nonce_seq TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(account, sponsor, nonce_key, nonce_seq)
      );

      CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        tx_hash TEXT,
        reason TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        confirmed_at INTEGER,
        receipt_block_number TEXT,
        receipt_gas_used TEXT
      );

      CREATE TABLE IF NOT EXISTS usage_counters (
        scope TEXT NOT NULL,
        window_start INTEGER NOT NULL,
        tx_count INTEGER NOT NULL,
        gas_wei TEXT NOT NULL,
        PRIMARY KEY (scope, window_start)
      );
    `);
  }
}
