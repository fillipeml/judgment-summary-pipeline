# Glossary

The documents and the summaries are Brazilian Portuguese. These are the terms that appear in
the prompts, the regexes and the fixtures, and what they mean for the pipeline.

## The decision

**Sentença** — the first-instance judgment. Argues at length, then decides in the
*dispositivo*.

**Dispositivo** — the operative part: the paragraph that actually decides, usually opening
*Ante o exposto*, *Posto isso* or *Diante do exposto*. **The operative part prevails over the
reasoning.** A summary built from the argument can state the opposite of the judgment, so the
segmenter keeps everything from the operative marker onward and the prompt says the rule
twice.

**Acórdão** — the appellate ruling, decided by a panel. It *replaces* the judgment on the
points it reformed, so the final outcome must be the consolidated one, folded into a single
paragraph. One letter away from *acordo*, and the two mean opposite things — hence the
ordering in `sources/classify.ts`.

**Acordo homologado** — a settlement approved by the court. Only an explicit approval
counts: a deposit receipt or an unapproved settlement petition is not one. Where approval is
explicit it prevails over the earlier merits decision.

**Embargos de declaração** — a motion for clarification. It changes the outcome only when it
has *efeito modificativo* (amending effect). Otherwise the earlier result still governs.

**Trânsito em julgado** — finality; no further appeal is possible. Mentioned in certificates,
never inferred.

## Outcomes

Whole case, as the prompt and the schema use them:

| Portuguese | Schema value | Meaning |
| --- | --- | --- |
| Procedente | `upheld` | The claim succeeded |
| Parcialmente procedente | `partly_upheld` | It succeeded in part |
| Improcedente | `dismissed` | It failed on the merits |
| Extinto | `terminated` | Ended without a merits ruling, or by approved settlement |
| Não identificado | `not_identified` | The documents do not say |

A single claim can also be **Prejudicado** (`moot`): superseded, usually an interim-relief
request absorbed by the final ruling. A whole case cannot be.

Appeals have their own vocabulary:

| Portuguese | Schema value |
| --- | --- |
| Provido | `allowed` |
| Parcialmente provido | `partly_allowed` |
| Não provido / desprovido | `not_allowed` |
| Não conhecido | `not_entertained` |

`appealOutcome` is `null` when there was no appeal, which is different from `not_identified`.

## What a summary has to carry

**Retenção** — the percentage the developer keeps when a purchase contract is rescinded. A
figure a client acts on, and the one the audit fixture gets wrong on purpose.

**Cláusula de decaimento** — a contract term making the buyer forfeit most of what they paid.
Routinely reduced or struck down under the consumer code.

**Correção monetária** — indexation, restating an amount in today's money. The *index*
matters: INPC, IGP-M and IPCA are not interchangeable.

**Juros de mora** — default interest, typically 1% a month, running from a stated date
(usually *citação*, service of process).

**Honorários advocatícios** — the fee award, as a percentage. A trial award and an appellate
uplift are different things and the summary must distinguish them: *fixados em 10% e
majorados para 15% em grau recursal*.

**Custas processuais** — court costs, and who bears them.

**Gratuidade de justiça** — legal aid. Where granted, enforceability of costs and fees is
suspended, which must be said, because otherwise the row reads as a debt the party owes now.

**Taxa de fruição / taxa de ocupação** — a charge for the period the buyer had use of the
property, usually set off against the refund.

**Comissão de corretagem** — the brokerage fee, often claimed back on rescission.

**Tutela de urgência** — interim relief. Frequently *prejudicada* once the merits are decided.

## Procedure and paperwork

**Petição inicial** — the complaint. **Contestação** — the defence. **Réplica** — the reply.
None of them decides anything, which is why a file containing only these produces the
sentinel opening rather than an outcome.

**Despacho** — a procedural order. **Certidão** — a certificate recording a procedural fact.
**Mandado** — a writ. All classified and all non-decisive.

**Autos** — the case file as a whole. An export of the *autos* is the single large PDF that
sends the segmenter into window mode.

**Comarca** — the judicial district. **Vara** — the court within it. **Relator** — the
reporting judge of an appellate panel.

**Segredo de justiça** — judicial seal. A case under seal is itself a confidentiality flag,
and no sealed material appears anywhere in this repository.

## Identifiers

**Número CNJ** — the national case number, `NNNNNNN-DD.YYYY.J.TR.OOOO`: seven sequential
digits, two check digits, the year, one digit for the branch of justice, two for the court,
four for the originating unit. The check digits are modulo 97 base 10 over the rest, which is
what lets this repository prove its fixtures are invented rather than assert it.

**CPF / CNPJ / OAB** — personal, company and bar registration numbers. None appears anywhere
here, in any form. The fixtures write *qualificada nos autos* instead, which is what the
documents themselves usually say.
