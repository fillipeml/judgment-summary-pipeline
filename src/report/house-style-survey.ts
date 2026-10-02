/** Where the house style came from.
 *
 * The gate in `domain/house-style.ts` enforces two accepted openings. Neither was invented:
 * both were counted off the rows a lawyer had already written and approved, before a single
 * line of the prompt was written.
 *
 * The survey matters most for settlements, where two wordings compete — "Acordo homologado"
 * and "JULGADO EXTINTO ... homologação". Only one of them can be the house style, and the
 * approved rows, not a preference, decide which. Re-running this is how anyone checks the
 * rule is still the one the corpus supports. */
import {
  MERITS_OPENING_RE,
  MERITS_WORDS,
  SETTLEMENT_OPENING_RE,
} from "../domain/house-style.ts";
import type { WorkbookRow } from "../workbook/read.ts";

/** The words that mark a row as being about a settlement at all, whichever form it takes. */
const SETTLEMENT_MENTION_RE = /acordo|homolog/i;

export interface FormCount {
  form: string;
  count: number;
  examples: string[];
}

export interface StyleSurvey {
  approvedRows: number;
  /** Approved rows that mention a settlement: the population the contest is decided on. */
  settlementRows: number;
  settlementForms: FormCount[];
  /** Which settlement wording the approved rows actually favour. */
  dominantSettlementForm: string | null;
  /** How decisive that majority is. A thin margin is a reason not to enforce the rule. */
  dominancePct: number | null;
  /** The denominator dominancePct is over: approved rows whose opening matched a known
   *  settlement form, which is fewer than `settlementRows`. Reported so the percentage can
   *  name what it is a percentage of. */
  settlementFormTotal: number;
  meritsForms: FormCount[];
  /** Approved rows matching no accepted opening: the ceiling on how strict the gate can be. */
  unrecognised: FormCount;
}

function example(list: string[], text: string, cap = 3): void {
  if (list.length < cap) list.push(text.slice(0, 160));
}

export function surveyHouseStyle(rows: WorkbookRow[]): StyleSurvey {
  const approved = rows.filter((r) => r.approved && r.existing.trim());

  const forms = new Map<string, FormCount>();
  const bump = (form: string, text: string): void => {
    const entry = forms.get(form) ?? { form, count: 0, examples: [] };
    entry.count++;
    example(entry.examples, text);
    forms.set(form, entry);
  };

  const unrecognised: FormCount = { form: "no accepted opening", count: 0, examples: [] };
  let settlementRows = 0;

  for (const row of approved) {
    const text = row.existing.trim();
    const isSettlement = SETTLEMENT_MENTION_RE.test(text);
    if (isSettlement) settlementRows++;

    if (SETTLEMENT_OPENING_RE.test(text)) {
      bump("Acordo homologado", text);
    } else if (MERITS_OPENING_RE.test(text)) {
      // Whitespace collapsed first: extraction and OCR both produce double spaces.
      const opening = text.toUpperCase().split(/\s+/).join(" ");
      const word = MERITS_WORDS.find((w) => opening.startsWith(`JULGADO ${w}`));
      // A merits opening on a row that talks about a settlement is the competing form.
      bump(isSettlement && word === "EXTINTO" ? "JULGADO EXTINTO (settlement)" : `JULGADO ${word}`, text);
    } else {
      unrecognised.count++;
      example(unrecognised.examples, text);
    }
  }

  const all = [...forms.values()].sort((a, b) => b.count - a.count);
  const settlementForms = all.filter((f) => /Acordo homologado|settlement/.test(f.form));
  const settlementTotal = settlementForms.reduce((s, f) => s + f.count, 0);
  const winner = settlementForms[0] ?? null;

  return {
    approvedRows: approved.length,
    settlementRows,
    settlementForms,
    dominantSettlementForm: winner?.form ?? null,
    settlementFormTotal: settlementTotal,
    dominancePct:
      winner && settlementTotal
        ? Math.round((winner.count / settlementTotal) * 1000) / 10
        : null,
    meritsForms: all.filter((f) => !/Acordo homologado|settlement/.test(f.form)),
    unrecognised,
  };
}

export function renderStyleSurvey(survey: StyleSurvey): string {
  const lines = [
    "# House style, counted off the approved rows",
    "",
    "The two accepted openings are not a preference. They are what the lawyers who reviewed",
    "this workbook actually wrote. This report recounts them, so the rule the gate enforces",
    "can be checked against the corpus rather than taken on trust.",
    "",
    `Approved rows read: **${survey.approvedRows}**, of which **${survey.settlementRows}** concern a settlement.`,
    "",
    "## The settlement wording contest",
    "",
    "| Form | Rows |",
    "| --- | --- |",
  ];
  for (const f of survey.settlementForms) lines.push(`| ${f.form} | ${f.count} |`);
  lines.push("");
  if (survey.dominantSettlementForm) {
    lines.push(
      `**Winner: "${survey.dominantSettlementForm}"** — ${survey.dominancePct}% of the ${survey.settlementFormTotal} approved rows whose opening matched a known settlement form.`,
      "That is the form the structuring prompt asks for, and the one the gate accepts.",
      "",
    );
    for (const f of survey.settlementForms) {
      if (!f.examples.length) continue;
      lines.push(`### ${f.form}`, "");
      for (const e of f.examples) lines.push(`> ${e}`);
      lines.push("");
    }
  } else {
    lines.push("No approved settlement rows: the settlement rule is unsupported by this corpus.", "");
  }

  lines.push("## Merits openings", "", "| Form | Rows |", "| --- | --- |");
  for (const f of survey.meritsForms) lines.push(`| ${f.form} | ${f.count} |`);
  lines.push("");

  lines.push(
    "## Approved rows matching no accepted opening",
    "",
    `**${survey.unrecognised.count}** row(s). This is the honest ceiling on the gate: a rule`,
    "stricter than the humans' own output would refuse work they consider finished.",
    "",
  );
  for (const e of survey.unrecognised.examples) lines.push(`> ${e}`);
  return lines.join("\n") + "\n";
}
