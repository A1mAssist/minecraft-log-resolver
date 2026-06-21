import { readFile } from "node:fs/promises";

export async function readLabelRows(filePath) {
  const text = await readFile(filePath, "utf8");
  if (filePath.toLowerCase().endsWith(".jsonl")) {
    return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  }
  if (filePath.toLowerCase().endsWith(".csv")) {
    return parseCsv(text);
  }
  const value = JSON.parse(text);
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.rows)) return value.rows;
  if (Array.isArray(value.labels)) return value.labels;
  throw new Error("Label file must be CSV, JSONL, an array, or an object with rows/labels.");
}

function parseCsv(text) {
  const rows = parseCsvRows(text);
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1)
    .filter((row) => row.some((value) => value.trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === "\"" && text[index + 1] === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
