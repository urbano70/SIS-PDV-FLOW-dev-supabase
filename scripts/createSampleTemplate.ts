/**
 * Creates a sample reservation template PDF at public/templates/reserva.pdf
 * Run with:  npx tsx scripts/createSampleTemplate.ts
 *
 * Replace the generated file with your real template afterwards.
 * The name will be drawn at the position defined in src/config/pdfTemplates.ts
 */
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'templates', 'reserva.pdf');

async function main() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4

  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  // Background
  page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(0.98, 0.97, 0.95) });

  // Decorative top bar
  page.drawRectangle({ x: 0, y: 790, width: 595, height: 52, color: rgb(0.08, 0.08, 0.08) });

  // Establishment name
  page.drawText('RESTAURANTE', {
    x: 595 / 2 - bold.widthOfTextAtSize('RESTAURANTE', 11) / 2,
    y: 820,
    size: 11,
    font: bold,
    color: rgb(0.9, 0.87, 0.8),
  });
  page.drawText('RESERVA CONFIRMADA', {
    x: 595 / 2 - bold.widthOfTextAtSize('RESERVA CONFIRMADA', 9) / 2,
    y: 802,
    size: 9,
    font: regular,
    color: rgb(0.7, 0.67, 0.6),
  });

  // Divider
  page.drawRectangle({ x: 60, y: 500, width: 475, height: 1, color: rgb(0.8, 0.78, 0.74) });
  page.drawRectangle({ x: 60, y: 380, width: 475, height: 1, color: rgb(0.8, 0.78, 0.74) });

  // Label above name area
  page.drawText('RESERVA EM NOME DE', {
    x: 595 / 2 - regular.widthOfTextAtSize('RESERVA EM NOME DE', 9) / 2,
    y: 420,
    size: 9,
    font: regular,
    color: rgb(0.5, 0.48, 0.45),
  });

  // Name placeholder note (this area is where the name will be inserted at y=395)
  page.drawText('[ nome do cliente ]', {
    x: 595 / 2 - regular.widthOfTextAtSize('[ nome do cliente ]', 13) / 2,
    y: 390,
    size: 13,
    font: regular,
    color: rgb(0.75, 0.73, 0.70),
  });

  // Footer
  page.drawText('Obrigado pela preferência', {
    x: 595 / 2 - regular.widthOfTextAtSize('Obrigado pela preferência', 10) / 2,
    y: 80,
    size: 10,
    font: regular,
    color: rgb(0.55, 0.53, 0.5),
  });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, await doc.save());
  console.log('Template criado em:', OUT);
}

main().catch(err => { console.error(err); process.exit(1); });
