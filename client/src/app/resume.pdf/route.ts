import {
  PDFDocument,
  PageSizes,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { resume } from "@/data/resume";
import { normalizeResumePdfText } from "@/lib/resumePdfText";

export const dynamic = "force-static";
export const runtime = "nodejs";

const PAGE_MARGIN = 43;
const BOTTOM_LIMIT = 48;
const BODY_SIZE = 8.6;
const BODY_LEADING = 11.4;
const SECTION_SIZE = 10.2;
const SECTION_LEADING = 21;

const palette = {
  ink: rgb(0.09, 0.125, 0.10),
  forest: rgb(0.192, 0.361, 0.271),
  forestDeep: rgb(0.145, 0.247, 0.176),
  muted: rgb(0.275, 0.325, 0.29),
  softMuted: rgb(0.39, 0.45, 0.40),
  rule: rgb(0.79, 0.84, 0.80),
  pale: rgb(0.93, 0.96, 0.93),
  paleGreen: rgb(0.88, 0.92, 0.88),
  link: rgb(0.08, 0.30, 0.47),
  white: rgb(1, 1, 1),
};

function splitLongWord(word: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const chunks: string[] = [];
  let chunk = "";
  for (const character of word) {
    const candidate = chunk + character;
    if (chunk && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      chunks.push(chunk);
      chunk = character;
    } else {
      chunk = candidate;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = normalizeResumePdfText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const chunks = font.widthOfTextAtSize(word, size) > maxWidth
      ? splitLongWord(word, font, size, maxWidth)
      : [word];

    for (const chunk of chunks) {
      const candidate = line ? line + " " + chunk : chunk;
      if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(line);
        line = chunk;
      } else {
        line = candidate;
      }
    }
  }

  if (line) lines.push(line);
  return lines;
}

export async function GET(): Promise<Response> {
  const document = await PDFDocument.create();
  document.setTitle("Morgan-West-Oketch-Resume");
  document.setAuthor(resume.name);
  document.setSubject("Résumé");
  document.setLanguage("en");
  document.setCreator("Morgan West Oketch Portfolio");
  document.setProducer("pdf-lib");

  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const oblique = await document.embedFont(StandardFonts.HelveticaOblique);
  const [width, height] = PageSizes.A4;
  const contentWidth = width - PAGE_MARGIN * 2;
  const right = width - PAGE_MARGIN;
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  function addPage(firstPage = false) {
    page = document.addPage(PageSizes.A4);
    pages.push(page);
    page.drawRectangle({
      x: 0,
      y: height - 5,
      width,
      height: 5,
      color: palette.forest,
    });

    if (firstPage) {
      y = height - 45;
      return;
    }

    page.drawText("MORGAN WEST OKETCH", {
      x: PAGE_MARGIN,
      y: height - 29,
      size: 7.1,
      font: bold,
      color: palette.forest,
    });
    const runningLabel = "PROFESSIONAL RÉSUMÉ";
    page.drawText(runningLabel, {
      x: right - regular.widthOfTextAtSize(runningLabel, 7.1),
      y: height - 29,
      size: 7.1,
      font: regular,
      color: palette.softMuted,
    });
    page.drawLine({
      start: { x: PAGE_MARGIN, y: height - 38 },
      end: { x: right, y: height - 38 },
      thickness: 0.7,
      color: palette.rule,
    });
    y = height - 54;
  }

  function ensureSpace(required: number) {
    if (y - required >= BOTTOM_LIMIT) return;
    if (pages.length >= 2) {
      throw new Error("The résumé content exceeds the two-page PDF limit.");
    }
    addPage(false);
  }

  function drawParagraph(
    text: string,
    font: PDFFont = regular,
    size = BODY_SIZE,
    leading = BODY_LEADING,
    color = palette.ink,
    indent = 0,
    after = 0,
  ) {
    const lines = wrapText(text, font, size, contentWidth - indent);
    for (const line of lines) {
      ensureSpace(leading);
      page.drawText(line, {
        x: PAGE_MARGIN + indent,
        y: y - size,
        size,
        font,
        color,
      });
      y -= leading;
    }
    y -= after;
  }

  function drawSectionHeading(title: string, firstLine: string) {
    const firstLineCount = wrapText(firstLine, regular, BODY_SIZE, contentWidth).length;
    ensureSpace(SECTION_LEADING + Math.max(1, firstLineCount) * BODY_LEADING);

    page.drawRectangle({
      x: PAGE_MARGIN,
      y: y - 12,
      width: 3,
      height: 11,
      color: palette.forest,
    });
    page.drawText(normalizeResumePdfText(title), {
      x: PAGE_MARGIN + 10,
      y: y - SECTION_SIZE,
      size: SECTION_SIZE,
      font: bold,
      color: palette.forestDeep,
    });
    page.drawLine({
      start: { x: PAGE_MARGIN + 10, y: y - 16 },
      end: { x: right, y: y - 16 },
      thickness: 0.65,
      color: palette.rule,
    });
    page.drawLine({
      start: { x: PAGE_MARGIN + 10, y: y - 16 },
      end: { x: PAGE_MARGIN + 49, y: y - 16 },
      thickness: 1.7,
      color: palette.forest,
    });
    y -= SECTION_LEADING;
  }

  function drawSubheading(title: string) {
    ensureSpace(BODY_LEADING);
    page.drawText(normalizeResumePdfText(title), {
      x: PAGE_MARGIN,
      y: y - 8.7,
      size: 8.7,
      font: bold,
      color: palette.forest,
    });
    y -= BODY_LEADING;
  }

  function drawSkill(label: string, items: string) {
    const prefix = normalizeResumePdfText(label + ": ");
    const prefixWidth = bold.widthOfTextAtSize(prefix, BODY_SIZE);
    const firstLineWidth = Math.max(80, contentWidth - prefixWidth - 2);
    const itemLines = wrapText(items, regular, BODY_SIZE, firstLineWidth);
    ensureSpace(BODY_LEADING);

    page.drawText(prefix, {
      x: PAGE_MARGIN,
      y: y - BODY_SIZE,
      size: BODY_SIZE,
      font: bold,
      color: palette.ink,
    });
    if (itemLines[0]) {
      page.drawText(itemLines[0], {
        x: PAGE_MARGIN + prefixWidth,
        y: y - BODY_SIZE,
        size: BODY_SIZE,
        font: regular,
        color: palette.ink,
      });
    }
    y -= BODY_LEADING;

    for (const line of itemLines.slice(1)) {
      ensureSpace(BODY_LEADING);
      page.drawText(line, {
        x: PAGE_MARGIN + 12,
        y: y - BODY_SIZE,
        size: BODY_SIZE,
        font: regular,
        color: palette.ink,
      });
      y -= BODY_LEADING;
    }
  }

  function drawBullet(text: string) {
    const indent = 12;
    const lines = wrapText(text, regular, BODY_SIZE, contentWidth - indent);
    for (let index = 0; index < lines.length; index += 1) {
      ensureSpace(BODY_LEADING);
      if (index === 0) {
        page.drawCircle({
          x: PAGE_MARGIN + 3,
          y: y - BODY_SIZE / 2 + 1,
          size: 2,
          color: palette.forest,
        });
      }
      page.drawText(lines[index], {
        x: PAGE_MARGIN + (index === 0 ? indent : indent + 1),
        y: y - BODY_SIZE,
        size: BODY_SIZE,
        font: regular,
        color: palette.ink,
      });
      y -= BODY_LEADING;
    }
  }

  addPage(true);

  // Match the web résumé's editorial header, forest-green accent, and MW monogram.
  page.drawRectangle({
    x: PAGE_MARGIN,
    y: y - 2,
    width: 25,
    height: 2,
    color: palette.forest,
  });
  page.drawText("PROFESSIONAL RÉSUMÉ", {
    x: PAGE_MARGIN + 33,
    y: y - 6.5,
    size: 7.4,
    font: bold,
    color: palette.forest,
  });
  y -= 27;

  page.drawText(normalizeResumePdfText(resume.name), {
    x: PAGE_MARGIN,
    y: y - 27,
    size: 27,
    font: bold,
    color: palette.ink,
  });
  y -= 32;
  drawParagraph(resume.headline.toUpperCase(), bold, 8.1, 10.5, palette.forestDeep, 0, 1);
  drawParagraph(resume.location + "  •  " + resume.email, regular, 8.2, 11, palette.muted);
  drawParagraph(
    resume.links.map((link) => link.label + ": " + link.href.replace("https://", "")).join("   •   "),
    regular,
    7.4,
    10,
    palette.link,
  );

  page.drawRectangle({
    x: right - 58,
    y: height - 110,
    width: 58,
    height: 58,
    color: palette.pale,
    borderColor: palette.paleGreen,
    borderWidth: 1,
  });
  page.drawRectangle({
    x: right - 53,
    y: height - 105,
    width: 48,
    height: 48,
    borderColor: palette.white,
    borderWidth: 1,
  });
  page.drawText("MW", {
    x: right - 45.5,
    y: height - 86,
    size: 18,
    font: bold,
    color: palette.forest,
  });

  y -= 5;
  page.drawLine({
    start: { x: PAGE_MARGIN, y },
    end: { x: right, y },
    thickness: 0.8,
    color: palette.rule,
  });
  page.drawLine({
    start: { x: right - 92, y },
    end: { x: right, y },
    thickness: 2.4,
    color: palette.forest,
  });
  y -= 23;

  drawSectionHeading("Professional Summary", resume.summary);
  drawParagraph(resume.summary, regular, BODY_SIZE, BODY_LEADING, palette.ink, 0, 1);

  drawSectionHeading("Skills", resume.skills[0].label);
  let previousHeading = "";
  for (const skill of resume.skills) {
    if (skill.heading !== previousHeading) {
      if (previousHeading) y -= 3;
      drawSubheading(skill.heading);
      previousHeading = skill.heading;
    }
    drawSkill(skill.label, skill.items);
  }

  drawSectionHeading(
    "Experience",
    resume.experience[0].role + ", " + resume.experience[0].organisation,
  );
  for (const entry of resume.experience) {
    ensureSpace(BODY_LEADING * 2);
    drawParagraph(entry.role + ", " + entry.organisation, bold, 9.1, 11.8, palette.forestDeep);
    drawParagraph(entry.period + ", " + entry.location, oblique, 8.2, 10.5, palette.softMuted, 0, 1);
    for (const item of entry.bullets) drawBullet(item);
    y -= 4;
  }

  drawSectionHeading(
    "Projects",
    resume.projects[0].title + " — " + resume.projects[0].subtitle,
  );
  for (const project of resume.projects) {
    ensureSpace(BODY_LEADING * 2);
    drawParagraph(project.title + " — " + project.subtitle, bold, 8.9, 11.5, palette.forestDeep);
    if (project.href) {
      drawParagraph(project.href.replace("https://", ""), regular, 7.8, 9.8, palette.link);
    }
    drawParagraph(project.body, regular, BODY_SIZE, BODY_LEADING, palette.ink, 0, 4);
  }

  drawSectionHeading("Education", resume.education.qualification);
  drawParagraph(resume.education.qualification, bold, 8.9, 11.5, palette.forestDeep);
  drawParagraph(
    resume.education.institution + ", " + resume.education.location + " — " + resume.education.period,
    regular,
    BODY_SIZE,
    BODY_LEADING,
  );
  drawParagraph("Relevant Coursework: " + resume.education.coursework, regular, BODY_SIZE, BODY_LEADING, palette.ink, 0, 2);

  drawSectionHeading(
    "Certifications",
    resume.certifications[0].name + " — " + resume.certifications[0].issuer,
  );
  for (const certification of resume.certifications) {
    drawBullet(certification.name + " — " + certification.issuer + " (" + certification.date + ")");
  }

  drawSectionHeading("References", resume.references);
  drawParagraph(resume.references);

  // Every page receives a restrained footer and page number, without crowding the content.
  pages.forEach((pdfPage, index) => {
    pdfPage.drawLine({
      start: { x: PAGE_MARGIN, y: 35 },
      end: { x: right, y: 35 },
      thickness: 0.65,
      color: palette.rule,
    });
    pdfPage.drawText("MORGAN WEST OKETCH  •  PROFESSIONAL RÉSUMÉ", {
      x: PAGE_MARGIN,
      y: 22,
      size: 6.8,
      font: bold,
      color: palette.softMuted,
    });
    const pageLabel = String(index + 1).padStart(2, "0") + " / " + String(pages.length).padStart(2, "0");
    pdfPage.drawText(pageLabel, {
      x: right - regular.widthOfTextAtSize(pageLabel, 6.8),
      y: 22,
      size: 6.8,
      font: regular,
      color: palette.forest,
    });
  });

  if (pages.length > 2) throw new Error("The résumé PDF must remain at two pages or fewer.");

  const pdfBytes = await document.save();
  const body = new Uint8Array(pdfBytes.byteLength);
  body.set(pdfBytes);
  return new Response(body.buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="Morgan-West-Oketch-Resume.pdf"',
      "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
