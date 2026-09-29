/** The colour code of the deliverable, which is also its safety contract.
 *
 * The client's team had already reviewed part of the column by hand and marked those cells
 * with green TEXT. That convention is the one non-negotiable rule of the engagement: a
 * green cell is human work and is never touched. Everything else the pipeline writes is
 * marked so a reviewer can see at a glance what came from a model and what still needs a
 * person. */

/** Human-reviewed and approved. Untouchable. */
export const APPROVED_FONT = "FF00B050";
/** Written by the pipeline and audited: blue text on a light blue fill. */
export const WRITTEN_FONT = "FF0000FF";
export const WRITTEN_FILL = "FFDDEBF7";
/** Refused by a gate: the existing text is left exactly as it was and only tinted. */
export const REVIEW_FILL = "FFFFF2CC";
/** Report headers. Neutral ink rather than any firm's brand colour. */
export const HEADER_FILL = "FF17181C";
export const HEADER_FONT = "FFFFFFFF";
