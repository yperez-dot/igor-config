import assert from "node:assert/strict";
import test from "node:test";
import { writeStoredZip } from "../src/zip.js";
import { previewSpreadsheet, verifyUploadAgainstPreview } from "../src/spreadsheet-preview.js";

function commissionXlsx({ headers, rows }) {
  const shared = [...headers, ...rows.flat()];
  const sharedXml = `<?xml version="1.0"?><sst count="${shared.length}">${shared.map((text) => `<si><t>${text}</t></si>`).join("")}</sst>`;
  const cells = [];
  headers.forEach((_, index) => {
    cells.push(`<c r="${String.fromCharCode(65 + index)}1" t="s"><v>${index}</v></c>`);
  });
  rows.forEach((row, rowIndex) => {
    row.forEach((value, colIndex) => {
      const sharedIndex = headers.length + rows.slice(0, rowIndex).reduce((sum, r) => sum + r.length, 0) + colIndex;
      cells.push(`<c r="${String.fromCharCode(65 + colIndex)}${rowIndex + 2}" t="s"><v>${sharedIndex}</v></c>`);
    });
  });
  return writeStoredZip([
    { name: "xl/sharedStrings.xml", data: sharedXml },
    { name: "xl/worksheets/sheet1.xml", data: `<?xml version="1.0"?><worksheet>${cells.join("")}</worksheet>` }
  ]);
}

test("previewSpreadsheet counts rows and sums commission from xlsx", () => {
  const buffer = commissionXlsx({
    headers: ["Client", "Policy", "Commission"],
    rows: [
      ["Maria G", "P1", "$100.00"],
      ["Alan E", "P2", "$50.25"]
    ]
  });
  const preview = previewSpreadsheet({
    fileName: "Commission-Statement-2026-08-28.xlsx",
    buffer
  });
  assert.equal(preview.dataRowCount, 2);
  assert.equal(preview.commissionTotal, 150.25);
  assert.equal(preview.confidence, "high");
});

test("verifyUploadAgainstPreview flags row and commission mismatches", () => {
  const preview = { dataRowCount: 10, commissionTotal: 500 };
  const verification = verifyUploadAgainstPreview(
    preview,
    { rowCount: 8, commissionSum: 480 },
    []
  );
  assert.equal(verification.status, "mismatch");
  assert.equal(verification.issues.length, 2);
});

test("verifyUploadAgainstPreview passes when counts and totals align", () => {
  const preview = { dataRowCount: 4, commissionTotal: 120.5 };
  const verification = verifyUploadAgainstPreview(
    preview,
    { rowCount: 4, commissionSum: 120.5 },
    []
  );
  assert.equal(verification.status, "match");
  assert.equal(verification.verified, undefined);
});
