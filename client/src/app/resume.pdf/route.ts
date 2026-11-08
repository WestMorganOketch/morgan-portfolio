import { PDFDocument, PageSizes, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { resume } from "@/data/resume";
import { normalizeResumePdfText } from "@/lib/resumePdfText";

export const dynamic = "force-static";
export const runtime = "nodejs";

const margin = 51;
const bodySize = 10;
const bodyLeading = 13.5;
const sectionSize = 11;
const black = rgb(0, 0, 0);

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = normalizeResumePdfText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
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
  const contentWidth = width - margin * 2;
  let page = document.addPage(PageSizes.A4);
  let y = height - margin;

  function ensureSpace(required: number) {
    if (y - required >= margin) return;
    if (document.getPageCount() >= 2) throw new Error("The résumé content exceeds the two-page PDF limit.");
    page = document.addPage(PageSizes.A4);
    y = height - margin;
  }

  function advanceLine() {
    if (y - bodyLeading >= margin) return;
    if (document.getPageCount() >= 2) throw new Error("The résumé content exceeds the two-page PDF limit.");
    page = document.addPage(PageSizes.A4);
    y = height - margin;
  }

  function paragraph(text: string, font = regular, size = bodySize, leading = bodyLeading, indent = 0) {
    const lines = wrapText(text, font, size, contentWidth - indent);
    ensureSpace(leading);
    for (let index = 0; index < lines.length; index += 1) {
      if (index > 0) advanceLine();
      page.drawText(lines[index], {
        x: margin + (index === 0 ? 0 : indent),
        y: y - size,
        size,
        font,
        color: black,
      });
      y -= leading;
    }
  }

  function sectionHeading(title: string, firstLine: string) {
    const firstLineCount = wrapText(firstLine, regular, bodySize, contentWidth).length;
    ensureSpace(sectionSize + 6 + (firstLineCount ? bodyLeading : 0));
    y -= 2;
    page.drawText(normalizeResumePdfText(title), {
      x: margin,
      y: y - sectionSize,
      size: sectionSize,
      font: bold,
      color: black,
    });
    y -= sectionSize + 4;
  }

  function bullet(text: string) {
    const indent = 12;
    const lines = wrapText(text, regular, bodySize, contentWidth - indent);
    ensureSpace(bodyLeading + 1);
    page.drawText("•", { x: margin, y: y - bodySize, size: bodySize, font: regular, color: black });
    page.drawText(lines[0], { x: margin + indent, y: y - bodySize, size: bodySize, font: regular, color: black });
    y -= bodyLeading;
    for (const line of lines.slice(1)) {
      advanceLine();
      page.drawText(line, { x: margin + indent, y: y - bodySize, size: bodySize, font: regular, color: black });
      y -= bodyLeading;
    }
  }

  page.drawText(normalizeResumePdfText(resume.name), {
    x: margin,
    y: y - 20,
    size: 20,
    font: bold,
    color: black,
  });
  y -= 24;
  paragraph(resume.headline.toUpperCase(), bold, 10, 13.5);
  paragraph(
    [resume.location, resume.email, ...resume.links.map((link) => `${link.label}: ${link.href.replace("https://", "")}`)].join("  •  "),
    regular,
    9,
    12,
  );
  y -= 3;

  sectionHeading("Professional Summary", resume.summary);
  paragraph(resume.summary);

  sectionHeading("Skills", resume.skills[0].label);
  for (const skill of resume.skills) {
    const previousHeading = resume.skills[resume.skills.indexOf(skill) - 1]?.heading;
    if (skill.heading !== previousHeading) {
      ensureSpace(bodyLeading * 2);
      page.drawText(normalizeResumePdfText(skill.heading), {
        x: margin,
        y: y - bodySize,
        size: bodySize,
        font: bold,
        color: black,
      });
      y -= bodyLeading;
    }
    paragraph(`${skill.label}: ${skill.items}`);
  }

  sectionHeading("Experience", `${resume.experience[0].role}, ${resume.experience[0].organisation}`);
  for (const entry of resume.experience) {
    const heading = `${entry.role}, ${entry.organisation}`;
    ensureSpace(bodyLeading * 3);
    paragraph(heading, bold, bodySize, bodyLeading);
    paragraph(`${entry.period}, ${entry.location}`, oblique, 9.6, 12);
    for (const item of entry.bullets) bullet(item);
  }

  sectionHeading("Projects", `${resume.projects[0].title} — ${resume.projects[0].subtitle}`);
  for (const project of resume.projects) {
    ensureSpace(bodyLeading * 2);
    paragraph(`${project.title} — ${project.subtitle}`, bold, bodySize, bodyLeading);
    if (project.href) paragraph(project.href.replace("https://", ""), regular, 9.4, 12);
    paragraph(project.body);
  }

  sectionHeading("Education", resume.education.qualification);
  paragraph(resume.education.qualification, bold);
  paragraph(`${resume.education.institution}, ${resume.education.location} — ${resume.education.period}`);
  paragraph(`Relevant Coursework: ${resume.education.coursework}`);

  sectionHeading("Certifications", `${resume.certifications[0].name} — ${resume.certifications[0].issuer}`);
  for (const certification of resume.certifications) {
    bullet(`${certification.name} — ${certification.issuer} (${certification.date})`);
  }

  sectionHeading("References", resume.references);
  paragraph(resume.references);

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
