import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyUploadFilename,
  classifyUploadContent,
  olicommUpload,
  olicommUploadWithVerification,
  resolveUploadBucket,
  uploadPathForType
} from "../src/olicomm.js";

test("classifies Commission-Statement filenames as commission statements", () => {
  const result = classifyUploadFilename("Commission-Statement-2026-08-28.xlsx");
  assert.equal(result.id, "commission_statement");
  assert.match(result.reason, /commission|statement/i);
});

test("maps upload types to OliComm API paths", () => {
  assert.equal(uploadPathForType("commission_statement"), "/api/files/upload");
  assert.equal(uploadPathForType("bsi_statement"), "/api/files/upload-bsi-statement");
  assert.equal(uploadPathForType("medicarepro"), "/api/medicarepro/upload");
});

test("olicomm_upload posts multipart with bearer and agency headers", async () => {
  const calls = [];
  const buffer = Buffer.from("fake-xlsx");
  const result = await olicommUpload({
    environment: {
      OLICOMM_BASE_URL: "https://example.test",
      OLICOMM_JWT: "jwt-token",
      OLICOMM_AGENCY_OVERRIDE: "THEI"
    },
    fileName: "Commission-Statement-2026-08-28.xlsx",
    buffer,
    uploadType: "commission_statement",
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), headers: options.headers, body: options.body });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ uploadId: 42, recordCount: 17 })
      };
    }
  });

  assert.equal(result.uploaded, true);
  assert.equal(result.recordCount, 17);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/files\/upload$/);
  assert.equal(calls[0].headers.Authorization, "Bearer jwt-token");
  assert.equal(calls[0].headers["X-Agency-Override"], "THEI");
  assert.ok(calls[0].body instanceof FormData);
});

test("olicomm_upload_with_verification compares source and imported totals", async () => {
  const buffer = Buffer.from("fake");
  const result = await olicommUploadWithVerification({
    environment: { OLICOMM_JWT: "jwt-token" },
    fileName: "Commission-Statement-2026-08-28.csv",
    buffer: Buffer.from("Client,Commission\nMaria,$10.00\nAlan,$5.00\n"),
    uploadType: "commission_statement",
    fetchImpl: async (url) => {
      if (String(url).includes("/api/files/upload")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ uploadId: 42, rowCount: 2, commissionSum: 15 })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          records: [
            { commission_amount: 10 },
            { commission_amount: 5 }
          ]
        })
      };
    }
  });
  assert.equal(result.uploaded, true);
  assert.equal(result.verification.status, "match");
  assert.equal(result.verified, true);
});

test("resolveUploadBucket prefers headers for generic commission filenames", () => {
  const bucket = resolveUploadBucket({
    fileName: "Commission-Statement-2026-08-28.csv",
    buffer: Buffer.from("Agent First,Agent Last,Enrollment Date,Carrier\nMaria,Gonzalez,2026-01-01,Humana\n")
  });
  assert.equal(bucket.id, "medicarepro");
  assert.equal(bucket.method, "content");
});

test("resolveUploadBucket agrees when filename and headers match", () => {
  const bucket = resolveUploadBucket({
    fileName: "humana_bsi_statement.csv",
    buffer: Buffer.from("Policy,Client,Commission,BSI Override\nP1,Maria,$10.00,$5.00\n")
  });
  assert.equal(bucket.id, "bsi_statement");
  assert.equal(bucket.method, "filename+content");
});

test("classifyUploadContent detects MedicarePro headers", () => {
  const result = classifyUploadContent({
    readable: true,
    headers: ["Agent First", "Agent Last", "Enrollment Date", "Carrier"],
    sampleRows: [["Maria", "Gonzalez", "2026-01-01", "Humana"]],
    commissionColumn: null
  });
  assert.equal(result.id, "medicarepro");
});

test("olicomm_upload surfaces duplicate warnings", async () => {
  const result = await olicommUpload({
    environment: { OLICOMM_JWT: "jwt-token" },
    fileName: "uhc_statement.xlsx",
    buffer: Buffer.from("x"),
    uploadType: "commission_statement",
    fetchImpl: async () => ({
      ok: false,
      status: 409,
      text: async () => JSON.stringify({ duplicateWarning: true, totalCount: 3 })
    })
  });
  assert.equal(result.duplicateWarning, true);
  assert.equal(result.status, 409);
});
