/** Builds the fixture corpus from scripts/fixtures/cases.json.
 *
 * The committed fixtures are what the demo runs on, so this script is the only place their
 * shape is decided: which case gets which file name, which rows of the workbook are already
 * reviewed, and what the recorded readings say. Re-running it must reproduce them, so every
 * timestamp is pinned and nothing here is random.
 *
 * The naming is deliberately untidy. A real shared drive has the case number on the folder
 * and not the file, or punctuated differently, or not present at all, and a pipeline that
 * only works on tidy names does not work. Each file below is named to force one of the join
 * keys in src/sources/coverage.ts to earn its keep.
 *
 *   npm run fixtures
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import cases from "./fixtures/cases.json" with { type: "json" };
import { APPROVED_FONT } from "../src/workbook/colours.ts";
import { isFictional } from "../src/domain/case-number.ts";

const ROOT = "fixtures";
const SOURCES = join(ROOT, "sources");
const WORKBOOK = join(ROOT, "workbook", "caseload.xlsx");
const RECORDINGS = join(ROOT, "recordings.json");

/** Pinned so a rebuild is byte-comparable and nothing leaks the machine it was built on. */
const PINNED = new Date(Date.UTC(2099, 0, 1, 0, 0, 0));
const AUTHOR = "judgment-summary-pipeline fixtures";
const MODEL = "claude-opus-5";

// ---------------------------------------------------------------------------------------
// PDFs
// ---------------------------------------------------------------------------------------

const PAGE: [number, number] = [595.28, 841.89];
const MARGIN = 48;
const SIZE = 9;
const LEADING = 11.5;

/** Replacements for characters the PDF base font cannot encode. */
const FOLD: Record<string, string> = {
  "‑": "-",
  "‒": "-",
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  " ": " ",
  " ": " ",
  " ": " ",
  "\t": "    ",
};

function foldText(text: string): string {
  let out = "";
  for (const ch of text) out += FOLD[ch] ?? ch;
  return out;
}

/** Wraps to the page width using the font's own measurements, not a character count. */
function wrap(
  text: string,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  width: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, SIZE) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = word;
    }
    if (line) lines.push(line);
  }
  return lines;
}

async function writePdf(path: string, text: string): Promise<number> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.setTitle("Peça processual (fictícia)");
  pdf.setAuthor(AUTHOR);
  pdf.setSubject("Synthetic court filing for tests and demos. Not a real case.");
  pdf.setProducer(AUTHOR);
  pdf.setCreator(AUTHOR);
  pdf.setCreationDate(PINNED);
  pdf.setModificationDate(PINNED);

  const usable = PAGE[0] - MARGIN * 2;
  const lines = wrap(foldText(text), font, usable);
  const perPage = Math.floor((PAGE[1] - MARGIN * 2) / LEADING);

  for (let i = 0; i < lines.length; i += perPage) {
    const page = pdf.addPage(PAGE);
    let y = PAGE[1] - MARGIN;
    for (const line of lines.slice(i, i + perPage)) {
      page.drawText(line, { x: MARGIN, y, size: SIZE, font, color: rgb(0.1, 0.1, 0.1) });
      y -= LEADING;
    }
  }

  const bytes = await pdf.save({ useObjectStreams: false });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return bytes.length;
}

/** A PDF with pages but effectively no text layer: what a scan from paper looks like. */
async function writeScannedPdf(path: string): Promise<void> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Digitalização sem camada de texto (fictícia)");
  pdf.setAuthor(AUTHOR);
  pdf.setProducer(AUTHOR);
  pdf.setCreator(AUTHOR);
  pdf.setCreationDate(PINNED);
  pdf.setModificationDate(PINNED);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 4; i++) {
    const page = pdf.addPage(PAGE);
    // Grey blocks where the scanned text would be, and a page number: enough marks for a
    // reader to see it is a document, far too little text for the extractor to accept.
    for (let row = 0; row < 26; row++) {
      page.drawRectangle({
        x: MARGIN,
        y: PAGE[1] - MARGIN - row * 22,
        width: usableWidth(row),
        height: 9,
        color: rgb(0.82, 0.82, 0.82),
      });
    }
    page.drawText(String(i + 1), { x: PAGE[0] / 2, y: MARGIN, size: 8, font });
  }
  const bytes = await pdf.save({ useObjectStreams: false });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

function usableWidth(row: number): number {
  const full = PAGE[0] - MARGIN * 2;
  return row % 7 === 6 ? full * 0.45 : full;
}

// ---------------------------------------------------------------------------------------
// Where each document lands
// ---------------------------------------------------------------------------------------

/** One entry per document of each case, in the order the case lists them.
 *
 *  T1, T7, T8 and the gold cases are named after the case: the easy tier.
 *  T2 and T5 carry the number ONLY on the folder: the path tier.
 *  T3 punctuates it differently: only the twenty-digit tier finds it.
 *  T4 and T6 sit in a mixed folder with decoys.
 */
const LAYOUT: Record<string, string[]> = {
  "1000001-11.2099.8.26.0100": ["1000001-11.2099.8.26.0100 - sentenca.pdf"],
  "1000002-22.2099.8.26.0100": [
    "1000002-22.2099.8.26.0100/SENTENCA (2).pdf",
    "1000002-22.2099.8.26.0100/ACORDAO.pdf",
  ],
  "1000003-33.2099.8.26.0100": [
    "recebidos/10000033320998260100_peticao de acordo.pdf",
    "recebidos/10000033320998260100_sentenca homologatoria.pdf",
  ],
  "1000004-44.2099.8.26.0100": ["recebidos/1000004-44.2099.8.26.0100 homologacao.pdf"],
  "1000005-55.2099.8.26.0100": [
    "1000005-55.2099.8.26.0100/peticao inicial.pdf",
    "1000005-55.2099.8.26.0100/despacho.pdf",
    "1000005-55.2099.8.26.0100/certidao de recurso pendente.pdf",
  ],
  "1000006-66.2099.8.26.0100": ["1000006-66.2099.8.26.0100 - autos completos.pdf"],
  "1000007-77.2099.8.26.0100": ["1000007-77.2099.8.26.0100 - sentenca.pdf"],
  "1000008-88.2099.8.26.0100": ["1000008-88.2099.8.26.0100 - sentenca.pdf"],
  "2000001-11.2099.8.26.0200": ["revisados/2000001-11.2099.8.26.0200 - sentenca.pdf"],
  "2000002-22.2099.8.26.0200": ["revisados/2000002-22.2099.8.26.0200 - sentenca.pdf"],
  "2000003-33.2099.8.26.0200": ["revisados/2000003-33.2099.8.26.0200 - sentenca.pdf"],
  "2000004-44.2099.8.26.0200": [
    "revisados/2000004-44.2099.8.26.0200 - sentenca.pdf",
    "revisados/2000004-44.2099.8.26.0200 - acordao.pdf",
  ],
};

/** The case whose only document is a scan: it must stay blank, not be guessed at. */
const SCANNED_CASE = "1000009-99.2099.8.26.0100";

// ---------------------------------------------------------------------------------------
// The workbook
// ---------------------------------------------------------------------------------------

const HEADERS = ["Processo", "Comarca", "Cliente", "Resumo Decisão", "Responsável"];

type RowState = "blank" | "off_style" | "house_style" | "approved" | "approved_rich" | "approved_off";

interface SheetRow {
  caseNumber: string;
  comarca: string;
  client: string;
  state: RowState;
  text: string;
}

const HOUSE_ALREADY =
  "JULGADO IMPROCEDENTE o pedido de restituição de comissão de corretagem, ante o " +
  "reconhecimento da prescrição trienal, com honorários advocatícios de 10% a cargo do autor.";

/** Rows with no case in cases.json: they exercise the states, not the model. */
const EXTRA_ROWS: SheetRow[] = [
  {
    caseNumber: SCANNED_CASE,
    comarca: "Serra Azul do Norte",
    client: "Rogério Tavares Nunes",
    state: "blank",
    text: "",
  },
  {
    caseNumber: "1000010-10.2099.8.26.0100",
    comarca: "Vila Boaventura",
    client: "Clarice Monteiro Alves",
    state: "blank",
    text: "",
  },
  {
    caseNumber: "1000011-11.2099.8.26.0100",
    comarca: "Porto das Águas",
    client: "Dário Espíndola Rocha",
    state: "off_style",
    text: "ver com o escritório — acho que houve acordo",
  },
  {
    caseNumber: "2000005-55.2099.8.26.0200",
    comarca: "Serra Azul do Norte",
    client: "Helena Prado Vilela",
    state: "approved_off",
    text: "combinado com a parte: devolve 70% e encerra",
  },
  {
    caseNumber: "2000006-66.2099.8.26.0200",
    comarca: "Vila Boaventura",
    client: "Otávio Rezende Campos",
    state: "approved_off",
    text: "acordo fechado na audiência, sem valores no sistema",
  },
  {
    caseNumber: "2000007-77.2099.8.26.0200",
    comarca: "Porto das Águas",
    client: "Marina Duarte Bastos",
    state: "house_style",
    text: HOUSE_ALREADY,
  },
  {
    caseNumber: "2000008-88.2099.8.26.0200",
    comarca: "Serra Azul do Norte",
    client: "Rogério Tavares Nunes",
    state: "house_style",
    text: HOUSE_ALREADY,
  },
  {
    caseNumber: "2000009-99.2099.8.26.0200",
    comarca: "Vila Boaventura",
    client: "Clarice Monteiro Alves",
    state: "house_style",
    text: HOUSE_ALREADY,
  },
];

const COMARCAS = ["Porto das Águas", "Serra Azul do Norte", "Vila Boaventura"];
const CLIENTS = [
  "Marina Duarte Bastos",
  "Otávio Rezende Campos",
  "Helena Prado Vilela",
  "Rogério Tavares Nunes",
  "Clarice Monteiro Alves",
  "Dário Espíndola Rocha",
];

/** Approved settlement rows, and the whole reason the house-style survey exists.
 *
 *  Two wordings compete for the same outcome: "Acordo homologado ..." and "JULGADO EXTINTO
 *  ... homologado o acordo". Only one can be the house style, and the rule the gate enforces
 *  was decided by counting these rows, not by preference. The split below is deliberately
 *  lopsided but not unanimous, because that is what a real corpus looks like and because a
 *  survey with a unanimous answer proves nothing about the method. */
const SETTLEMENT_SURVEY_ROWS: SheetRow[] = [
  "Acordo homologado entre as partes no valor de R$ 62.000,00, em 10 parcelas mensais de R$ 6.200,00, abrangendo a devolução das quantias pagas e a multa contratual, arcando cada parte com os honorários de seu patrono.",
  "Acordo homologado no valor de R$ 118.500,00, pago em parcela única no prazo de 30 dias, com quitação recíproca quanto ao objeto do contrato e extinção do processo com resolução do mérito.",
  "Acordo homologado entre as partes, com devolução de R$ 45.900,00 em 6 parcelas mensais, multa de 10% sobre o saldo em caso de inadimplemento e custas remanescentes rateadas igualmente.",
  "Acordo homologado no valor de R$ 87.300,00, em 12 parcelas mensais, mantida a ré na posse do lote e renunciando a autora ao pedido de danos morais.",
  "Acordo homologado entre as partes no valor de R$ 33.750,00, quitado mediante depósito judicial único, expedindo-se alvará em favor da autora.",
  "JULGADO EXTINTO o processo, com resolução do mérito, homologado o acordo pelo qual a ré restituirá R$ 54.200,00 em 8 parcelas mensais, com honorários a cargo de cada parte.",
  "JULGADO EXTINTO o processo, com resolução do mérito, ante a homologação do acordo no valor de R$ 71.000,00, pago em parcela única, com quitação recíproca.",
].map((text, i) => ({
  caseNumber: `300000${i + 1}-${String((i + 1) * 11).padStart(2, "0")}.2099.8.26.0300`,
  comarca: COMARCAS[i % COMARCAS.length]!,
  client: CLIENTS[i % CLIENTS.length]!,
  state: "approved" as RowState,
  text,
}));

const OFF_STYLE_NOTES = [
  "cliente ligou pedindo posição — pendente",
  "ganhou em parte, ver percentual com o Dr.",
  "falta conferir os valores da planilha antiga",
];

function sheetRows(): SheetRow[] {
  const rows: SheetRow[] = [];
  cases.forEach((c, i) => {
    const gold = c.caseNumber.startsWith("2");
    rows.push({
      caseNumber: c.caseNumber,
      comarca: COMARCAS[i % COMARCAS.length]!,
      client: CLIENTS[i % CLIENTS.length]!,
      // Two of the four approved rows are stored as rich text with only part of the run
      // coloured: the shape a naive colour check misses, and the one that loses a
      // reviewer's afternoon when it is missed.
      state: gold ? (i % 2 === 0 ? "approved" : "approved_rich") : i % 3 === 0 ? "off_style" : "blank",
      text: gold ? c.reference : i % 3 === 0 ? OFF_STYLE_NOTES[i % OFF_STYLE_NOTES.length]! : "",
    });
  });
  return [...rows, ...EXTRA_ROWS, ...SETTLEMENT_SURVEY_ROWS].sort((a, b) =>
    a.caseNumber.localeCompare(b.caseNumber),
  );
}

async function buildWorkbook(rows: SheetRow[]): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = AUTHOR;
  workbook.lastModifiedBy = AUTHOR;
  workbook.created = PINNED;
  workbook.modified = PINNED;

  const sheet = workbook.addWorksheet("Carteira");
  sheet.columns = [
    { width: 26 },
    { width: 20 },
    { width: 24 },
    { width: 90 },
    { width: 14 },
  ];
  const header = sheet.addRow(HEADERS);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17181C" } };
  });

  for (const row of rows) {
    const added = sheet.addRow([row.caseNumber, row.comarca, row.client, row.text, "MD"]);
    added.alignment = { vertical: "top", wrapText: true };
    const cell = added.getCell(4);
    if (row.state === "approved" || row.state === "approved_off") {
      cell.font = { color: { argb: APPROVED_FONT } };
    }
    if (row.state === "approved_rich") {
      const split = Math.floor(row.text.length * 0.6);
      cell.value = {
        richText: [
          { text: row.text.slice(0, split), font: { color: { argb: APPROVED_FONT } } },
          { text: row.text.slice(split), font: { color: { argb: APPROVED_FONT } } },
        ],
      };
    }
  }

  mkdirSync(dirname(WORKBOOK), { recursive: true });
  await workbook.xlsx.writeFile(WORKBOOK);
}

// ---------------------------------------------------------------------------------------
// Recorded readings
// ---------------------------------------------------------------------------------------

/** A token count from a character count. Not exact, and not pretending to be: the point is
 *  that the demo's cost report exercises real arithmetic on plausible numbers. */
const tokens = (chars: number): number => Math.max(1, Math.round(chars / 3.6));

const SYSTEM_PROMPT_TOKENS = 2_400;

function recordingFor(
  c: (typeof cases)[number],
  index: number,
  sourceChars: number,
): Record<string, unknown> {
  const mapTokens = tokens(c.map.length);
  const resultTokens = tokens(JSON.stringify(c.result).length);
  // The first request of a batch writes the system prompt to cache; the rest read it.
  const cacheWrite = index === 0 ? SYSTEM_PROMPT_TOKENS : 0;
  const cacheRead = index === 0 ? 0 : SYSTEM_PROMPT_TOKENS;

  const result = {
    ...c.result,
    appealOutcome: c.result.appealOutcome === "none" ? null : c.result.appealOutcome,
  };

  const recording: Record<string, unknown> = {
    caseNumber: c.caseNumber,
    map: c.map,
    result,
    audit: c.audit,
    usage: {
      map: {
        input_tokens: tokens(sourceChars),
        output_tokens: mapTokens,
        cache_creation_input_tokens: cacheWrite,
        cache_read_input_tokens: cacheRead,
      },
      structure: {
        input_tokens: mapTokens,
        output_tokens: resultTokens,
        cache_creation_input_tokens: cacheWrite,
        cache_read_input_tokens: cacheRead,
      },
      audit: {
        input_tokens: tokens(sourceChars) + tokens(result.summary.length),
        output_tokens: tokens(JSON.stringify(c.audit).length),
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  };

  if (c.parity && c.parity.verdict !== "none") {
    recording.parity = c.parity;
    (recording.usage as Record<string, unknown>).parity = {
      input_tokens: tokens(c.reference.length + result.summary.length),
      output_tokens: tokens(JSON.stringify(c.parity).length),
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };
  }
  return recording;
}

// ---------------------------------------------------------------------------------------

/** The full docket has to clear the segmenter's threshold, so its filings are separated by
 *  padding that decides nothing — exactly what makes a real docket long. */
function padDocket(text: string, filler: string[], target = 66_000): string {
  if (!filler.length || text.length >= target) return text;
  const marker = "\n\n";
  const parts = text.split(marker);
  const out: string[] = [];
  let i = 0;
  for (const part of parts) {
    out.push(part);
    if (out.join(marker).length < target) {
      out.push(filler[i % filler.length]!);
      i++;
    }
  }
  let padded = out.join(marker);
  // Padding goes BEFORE the closing filings, never after: the last operative part must stay
  // last, or the segmenter would be tested against a docket that cannot occur.
  while (padded.length < target) {
    const insertAt = padded.lastIndexOf(marker, Math.floor(padded.length * 0.6));
    padded = `${padded.slice(0, insertAt)}${marker}${filler[i++ % filler.length]}${padded.slice(insertAt)}`;
  }
  return padded;
}

async function main(): Promise<void> {
  rmSync(ROOT, { recursive: true, force: true });

  for (const c of cases) {
    if (!isFictional(c.caseNumber)) {
      throw new Error(`${c.caseNumber} is not provably fictional: refusing to build fixtures`);
    }
  }

  const recordings: Record<string, unknown>[] = [];
  let files = 0;

  for (const [index, c] of cases.entries()) {
    const paths = LAYOUT[c.caseNumber];
    if (!paths || paths.length !== c.documents.length) {
      throw new Error(
        `${c.caseNumber}: ${c.documents.length} document(s) but ${paths?.length ?? 0} path(s) in LAYOUT`,
      );
    }
    let sourceChars = 0;
    for (const [i, document] of c.documents.entries()) {
      const text =
        document.kind === "autos" ? padDocket(document.text, c.fillerParagraphs) : document.text;
      sourceChars += text.length;
      await writePdf(join(SOURCES, paths[i]!), text);
      files++;
    }
    recordings.push(recordingFor(c, index, sourceChars));
    process.stdout.write(
      `${c.caseNumber}  ${String(sourceChars).padStart(6)} chars  ${paths.length} file(s)\n`,
    );
  }

  // Decoys. Every archive has them, and a pipeline that only works without them does not.
  await writeScannedPdf(join(SOURCES, `${SCANNED_CASE}/digitalizacao.pdf`));
  await writePdf(
    join(SOURCES, "relatorio interno da equipe.pdf"),
    "Relatório interno de acompanhamento da carteira. Documento sem número de processo, " +
      "mantido aqui para que a apuração de cobertura tenha algo honesto a reportar na " +
      "categoria de peças não atribuíveis.",
  );
  writeFileSync(join(SOURCES, "recebidos", "controle de processos.xlsx"), "not a pdf\n");
  files += 3;

  const rows = sheetRows();
  await buildWorkbook(rows);

  writeFileSync(
    RECORDINGS,
    `${JSON.stringify({ model: MODEL, recordings }, null, 2)}\n`,
    "utf8",
  );

  process.stdout.write(
    `\n${files} source file(s), ${rows.length} workbook row(s), ${recordings.length} recording(s)\n`,
  );
}

await main();
