
const fs = require("fs");
const path = require("path");
const { makeCertificatePdf } = require("./certpdf");
const { sha256Hex, canonicalHashHex } = require("./canonicalize");

const N = Number(process.argv[2] || 1000);

const FIRST = ["Hasan", "Elina", "Janis", "Sofia", "Marko", "Liga", "Andris", "Yuki", "Omar", "Anna", "Pavel", "Nadia", "Tomas", "Ines", "Karl", "Rita"];
const LAST = ["Turan", "Berzina", "Ozols", "Kalnina", "Petrov", "Liepa", "Vitols", "Tanaka", "Haddad", "Novak", "Kowalski", "Saar", "Lapsa", "Costa", "Meyer", "Zarina"];
const PROGRAMS = ["Computer Systems", "Information Technology", "Applied Computer Science", "Electronics", "Telecommunications"];
const DEGREES = ["Bachelor", "Bachelor (Hons)"];
const GRADES = ["A (excellent, 10)", "A (excellent, 9)", "B (very good, 8)", "B (good, 7)", "C (satisfactory, 6)"];
const EXPORTERS = [
  { producer: "LibreOffice 7.6", creator: "Writer" },
  { producer: "Microsoft® Word 2021", creator: "Microsoft® Word 2021" },
  { producer: "Skia/PDF m120", creator: "Chromium" },
  { producer: "certificate-prototype", creator: "certificate-prototype" },
];

function pick(arr, i) {
  return arr[i % arr.length];
}

function certificateForIndex(i) {
  const first = pick(FIRST, i);
  const last = pick(LAST, Math.floor(i / FIRST.length) + i);
  const day = (i % 28) + 1;
  const month = (i % 12) + 1;
  return {
    certificateId: `RTU-2026-CS-${String(i).padStart(6, "0")}`,
    studentName: `${first} ${last}`,
    studentId: `2${String(11000 + i).padStart(5, "0")}ADB`,
    program: pick(PROGRAMS, i),
    degreeLevel: pick(DEGREES, i),
    institution: "Riga Technical University",
    issueDate: `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    grade: pick(GRADES, i),
  };
}

async function main() {
  const dataDir = path.join(__dirname, "..", "dataset");
  const outDir = path.join(__dirname, "..", "results");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  const rows = [];
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) {
    const fields = certificateForIndex(i);
    const exporter = EXPORTERS[i % EXPORTERS.length];
    const creationDate = new Date(Date.UTC(2026, (i % 12), (i % 28) + 1, i % 24, i % 60));
    const bytes = await makeCertificatePdf(fields, { ...exporter, creationDate });

    const fileName = `cert_${fields.certificateId}.pdf`;
    fs.writeFileSync(path.join(dataDir, fileName), bytes);

    rows.push({
      index: i,
      certificateId: fields.certificateId,
      studentName: fields.studentName,
      program: fields.program,
      issueDate: fields.issueDate,
      file: fileName,
      pdfBytes: bytes.length,
      rawSha256: sha256Hex(bytes), 
      canonicalSha256: canonicalHashHex(fields), 
    });

    if ((i + 1) % 200 === 0) console.log(`  generated ${i + 1}/${N}`);
  }
  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;

  const distinctRaw = new Set(rows.map((r) => r.rawSha256)).size;
  const distinctCanonical = new Set(rows.map((r) => r.canonicalSha256)).size;

  const header = ["index", "certificateId", "studentName", "program", "issueDate", "file", "pdfBytes", "rawSha256", "canonicalSha256"];
  const csv = [header.join(",")];
  for (const r of rows) {
    csv.push(header.map((h) => `${r[h]}`.includes(",") ? `"${r[h]}"` : r[h]).join(","));
  }
  fs.writeFileSync(path.join(outDir, "realistic_dataset_manifest.csv"), csv.join("\n"));
  fs.writeFileSync(
    path.join(outDir, "realistic_dataset_manifest.json"),
    JSON.stringify({ count: N, distinctRaw, distinctCanonical, elapsedMs, rows }, null, 2)
  );

  console.log(`\nGenerated ${N} real certificate PDFs in dataset/ (${elapsedMs.toFixed(0)} ms)`);
  console.log(`  distinct raw-file hashes:  ${distinctRaw}/${N}`);
  console.log(`  distinct canonical hashes: ${distinctCanonical}/${N}`);
  console.log("Wrote results/realistic_dataset_manifest.csv");
  console.log("Wrote results/realistic_dataset_manifest.json");
  console.log("\nNext: npm run benchmark:realistic  (registers these real hashes on Arch A and B)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
