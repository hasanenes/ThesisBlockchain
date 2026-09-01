

  const crypto = require("crypto");

  const FIELD_ORDER = [
    "certificateId",
    "studentName",
    "studentId",
    "program",
    "degreeLevel",
    "institution",
    "issueDate",
    "grade",
  ];

  function sha256Hex(input) {
    return crypto.createHash("sha256").update(input).digest("hex");
  }

  function sha256Buffer(input) {
    return crypto.createHash("sha256").update(input).digest();
  }

  function normalizeValue(value) {
    return String(value).normalize("NFC").replace(/\s+/g, " ").trim();
  }

  function canonicalCertificate(fields) {
    const ordered = {};
    for (const key of FIELD_ORDER) {
      if (fields[key] === undefined || fields[key] === null) continue;
      ordered[key] = normalizeValue(fields[key]);
    }
  
    return JSON.stringify(ordered);
  }


  function canonicalHashHex(fields, salt) {
    const canonical = canonicalCertificate(fields);
    const payload = salt === undefined || salt === null ? canonical : `${canonical}|salt:${salt}`;
    return sha256Hex(payload);
  }

  module.exports = {
    FIELD_ORDER,
    sha256Hex,
    sha256Buffer,
    normalizeValue,
    canonicalCertificate,
    canonicalHashHex,
  };
