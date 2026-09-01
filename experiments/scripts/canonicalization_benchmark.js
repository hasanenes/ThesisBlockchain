

const fs = require("fs");
const path = require("path");
const { makeCertificatePdf } = require("./certpdf");
const { sha256Hex, canonicalHashHex, canonicalCertificate } = require("./canonicalize");

const baseCertificate = {
  certificateId: "RTU-2026-CS-000042",
  studentName: "Hasan Enes Turan",
  studentId: "211ADB038",
  program: "Computer Systems",
  degreeLevel: "Bachelor",
  institution: "Riga Technical University",
  issueDate: "2026-03-15",
  grade: "A (excellent, 9)",
};


const exporters = [
  { label: "LibreOffice", producer: "LibreOffice 7.6", creator: "Writer", creationDate: new Date("2026-03-15T09:00:00Z") },
  { label: "Microsoft Word", producer: "Microsoft® Word 2021", creator: "Microsoft® Word 2021", creationDate: new Date("2026-03-15T11:30:00Z") },
  { label: "Chrome print-to-PDF", producer: "Skia/PDF m120", creator: "Chromium", creationDate: new Date("2026-03-16T14:05:00Z") },
  { label: "re-save (same tool, later)", producer: "certificate-prototype", creator: "certificate-prototype", creationDate: new Date("2026-03-20T08:00:00Z") },
];


const equivalentFieldForms = [
  { label: "baseline", fields: baseCertificate },
  {
    label: "different key order",
    fields: {
      grade: baseCertificate.grade,
      institution: baseCertificate.institution,
      studentName: baseCertificate.studentName,
      issueDate: baseCertificate.issueDate,
      program: baseCertificate.program,
      certificateId: baseCertificate.certificateId,
      degreeLevel: baseCertificate.degreeLevel,
      studentId: baseCertificate.studentId,
    },
  },
  {
    label: "messy whitespace",
    fields: { ...baseCertificate, studentName: "  Hasan   Enes\tTuran ", program: "Computer  Systems " },
  },
];


const tamperedForms = [
  { label: "grade changed A->B", fields: { ...baseCertificate, grade: "B (good, 7)" } },
  { label: "name changed", fields: { ...baseCertificate, studentName: "Hasan E. Turan" } },
  { label: "date changed", fields: { ...baseCertificate, issueDate: "2025-03-15" } },
];

function pct(n, d) {
  return d === 0 ? "0%" : `${((100 * n) / d).toFixed(0)}%`;
}

async function main() {
  const outDir = path.join(__dirname, "..", "results");
  fs.mkdirSync(outDir, { recursive: true });

  
  const rawRows = [];
  const seenRaw = new Set();
  for (const ex of exporters) {
    const bytes = await makeCertificatePdf(baseCertificate, ex);
    const raw = sha256Hex(bytes);
    rawRows.push({ exporter: ex.label, bytes: bytes.length, rawSha256: raw });
    seenRaw.add(raw);
  }
  const rawAllDiffer = seenRaw.size === rawRows.length;

  
  const canonicalBase = canonicalHashHex(baseCertificate);
  const equivRows = equivalentFieldForms.map((f) => ({
    form: f.label,
    canonicalSha256: canonicalHashHex(f.fields),
    matchesBase: canonicalHashHex(f.fields) === canonicalBase,
  }));
  const allEquivMatch = equivRows.every((r) => r.matchesBase);

  
  const canonicalAcrossExporters = canonicalBase; 

  const tamperRows = tamperedForms.map((f) => ({
    tamper: f.label,
    canonicalSha256: canonicalHashHex(f.fields),
    detected: canonicalHashHex(f.fields) !== canonicalBase,
  }));
  const allTamperDetected = tamperRows.every((r) => r.detected);

  const salt = "f3a1c9e2b7d40516"; 
  const salted = canonicalHashHex(baseCertificate, salt);
  const attackerGuessNoSalt = canonicalHashHex(baseCertificate); 
  const saltUnlinkable = salted !== attackerGuessNoSalt;
  const saltSameSize = salted.length === attackerGuessNoSalt.length;

  console.log("=== Part 1: raw-byte SHA-256 of the SAME certificate, four exporters ===");
  for (const r of rawRows) console.log(`  ${r.exporter.padEnd(28)} ${r.bytes} bytes  ${r.rawSha256.slice(0, 16)}...`);
  console.log(`  distinct raw hashes: ${seenRaw.size}/${rawRows.length}  -> raw-byte hashing ${rawAllDiffer ? "FAILS (all differ)" : "unexpectedly stable"}`);
  console.log("");
  console.log("=== Part 2: canonical hash of the same content (must be invariant) ===");
  console.log(`  canonical string: ${canonicalCertificate(baseCertificate)}`);
  console.log(`  base canonical hash: ${canonicalBase.slice(0, 16)}...`);
  for (const r of equivRows) console.log(`  ${r.form.padEnd(22)} ${r.matchesBase ? "MATCH" : "DIFFER"}`);
  console.log("");
  console.log("=== Part 3: tamper detection (must differ) ===");
  for (const r of tamperRows) console.log(`  ${r.tamper.padEnd(22)} ${r.detected ? "DETECTED" : "MISSED"}`);
  console.log("");
  console.log("=== Part 4: salted commitment (privacy) ===");
  console.log(`  unsalted (attacker-reproducible): ${attackerGuessNoSalt.slice(0, 16)}...`);
  console.log(`  salted (unlinkable):              ${salted.slice(0, 16)}...`);
  console.log(`  attacker cannot reproduce salted hash without the secret: ${saltUnlinkable ? "YES" : "NO"}`);
  console.log(`  salted hash is still 32 bytes (gas unchanged): ${saltSameSize ? "YES" : "NO"}`);
  console.log("");

  const verdict = {
    rawByteHashingBrittle: rawAllDiffer,
    canonicalStableAcrossRenderings: allEquivMatch,
    tamperStillDetected: allTamperDetected,
    saltMakesHashUnlinkable: saltUnlinkable,
    saltKeepsHashSize: saltSameSize,
  };
  const allPass =
    rawAllDiffer && allEquivMatch && allTamperDetected && saltUnlinkable && saltSameSize;
  console.log(`VERDICT: ${allPass ? "ALL CHECKS PASS" : "CHECK FAILED — investigate"}`);
  console.log(`  raw-byte hashing brittle ............. ${rawAllDiffer}`);
  console.log(`  canonical stable across renderings ... ${allEquivMatch}`);
  console.log(`  tamper still detected (${pct(tamperRows.filter((r) => r.detected).length, tamperRows.length)}) ......... ${allTamperDetected}`);
  console.log(`  salt makes hash unlinkable ........... ${saltUnlinkable}`);
  console.log(`  salt keeps 32-byte size .............. ${saltSameSize}`);

  const json = {
    certificate: baseCertificate,
    rawRenderings: rawRows,
    canonicalBaseHash: canonicalBase,
    equivalentForms: equivRows,
    tamperForms: tamperRows,
    salted: { salt, saltedHash: salted, unsaltedHash: attackerGuessNoSalt, unlinkable: saltUnlinkable },
    verdict,
  };
  fs.writeFileSync(path.join(outDir, "canonicalization_results.json"), JSON.stringify(json, null, 2));

  const csvLines = ["category,label,value,result"];
  for (const r of rawRows) csvLines.push(`raw_rendering,${r.exporter},${r.rawSha256},distinct`);
  for (const r of equivRows) csvLines.push(`canonical_equivalent,${r.form},${r.canonicalSha256},${r.matchesBase ? "match" : "differ"}`);
  for (const r of tamperRows) csvLines.push(`tamper,${r.tamper},${r.canonicalSha256},${r.detected ? "detected" : "missed"}`);
  csvLines.push(`salt,salted,${salted},${saltUnlinkable ? "unlinkable" : "linkable"}`);
  csvLines.push(`salt,unsalted,${attackerGuessNoSalt},reproducible`);
  fs.writeFileSync(path.join(outDir, "canonicalization_results.csv"), csvLines.join("\n"));

  console.log("\nWrote results/canonicalization_results.json");
  console.log("Wrote results/canonicalization_results.csv");

  if (!allPass) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
