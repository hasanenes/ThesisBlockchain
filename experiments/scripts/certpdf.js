

const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

async function makeCertificatePdf(fields, options = {}) {
  const {
    producer = "certificate-prototype",
    creator = "certificate-prototype",
    creationDate = new Date(0),
    modificationDate = creationDate,
  } = options;

  const doc = await PDFDocument.create();
  doc.setTitle(`Certificate ${fields.certificateId || ""}`.trim());
  doc.setAuthor(fields.institution || "");
  doc.setSubject("Academic certificate");
  doc.setProducer(producer);
  doc.setCreator(creator);
  doc.setCreationDate(creationDate);
  doc.setModificationDate(modificationDate);

  const page = doc.addPage([595, 842]); 
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);

  const left = 70;
  let y = 760;
  const line = (text, { size = 12, useBold = false, gap = 22 } = {}) => {
    page.drawText(String(text), {
      x: left,
      y,
      size,
      font: useBold ? bold : font,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= gap;
  };

  line(fields.institution || "", { size: 18, useBold: true, gap: 40 });
  line("Academic Certificate", { size: 14, useBold: true, gap: 36 });
  line(`This certifies that`, { gap: 26 });
  line(fields.studentName || "", { size: 16, useBold: true, gap: 30 });
  line(`Student ID: ${fields.studentId || ""}`);
  line(`has been awarded the ${fields.degreeLevel || ""} degree in`);
  line(fields.program || "", { size: 14, useBold: true });
  line(`Grade: ${fields.grade || ""}`);
  line(`Date of issue: ${fields.issueDate || ""}`);
  line(`Certificate ID: ${fields.certificateId || ""}`);

  return doc.save(); 
}

module.exports = { makeCertificatePdf };
