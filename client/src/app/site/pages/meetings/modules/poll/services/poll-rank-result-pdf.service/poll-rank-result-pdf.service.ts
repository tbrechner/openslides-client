import { Injectable } from '@angular/core';
import { _, TranslateService } from '@ngx-translate/core';
import { Content, TableCell } from 'pdfmake/interfaces';
import { Id } from 'src/app/domain/definitions/key-types';
import { PollData } from 'src/app/domain/models/poll/generic-poll';
import {
    PollMethod,
    PollRankAlgorithm,
    PollRankAlgorithmVerbose,
    PollRankQuotaVerbose
} from 'src/app/domain/models/poll/poll-constants';
import { PollRankResult, PollRankResultRound } from 'src/app/domain/models/poll/rank-result';

/** How many counting rounds are printed side by side in one table. */
const ROUNDS_PER_TABLE = 5;

const UnknownUserLabel = _(`Deleted user`);

/**
 * A candidate of a rank poll together with the rounds in which they were
 * elected/excluded (if any), used to build the round-by-round table.
 */
interface RankCandidateRow {
    id: Id;
    name: string;
    electedInRound: number | null;
    /** 1-based order of election, if elected. */
    electionOrder: number | null;
    excludedInRound: number | null;
}

/**
 * Renders the counting result (`poll.rank_result`) of a rank (STV) poll as
 * pdfmake content: the elected candidates in order of election, a summary
 * line and — for the STV algorithms — a round-by-round (Meek) or
 * stage-by-stage (Scottish STV) table with votes (and keep factors for Meek),
 * or a simple points table for the Borda count. The error variant of
 * `rank_result` renders as an error message.
 *
 * This is the PDF counterpart of the `os-assignment-poll-rank-result`
 * component and is used by both the election PDF and the single poll PDF.
 */
@Injectable({ providedIn: `root` })
export class PollRankResultPdfService {
    public constructor(private translate: TranslateService) {}

    /**
     * Whether `createResultContent` will render anything for this poll: it is
     * a rank poll and the backend has written a `rank_result` (also for its
     * error variant).
     */
    public showRankResult(poll: PollData): boolean {
        return poll.pollmethod === PollMethod.Rank && !!poll.rank_result;
    }

    /**
     * For rank polls with a successfully counted result the generic results
     * table (which would only show first-preference totals) is replaced by
     * the STV result block. If counting failed, the first-preference totals
     * are shown below the error message.
     */
    public suppressGenericResults(poll: PollData): boolean {
        return this.showRankResult(poll) && !poll.rank_result!.error;
    }

    /**
     * The STV result block for the given poll or an empty array if the poll
     * is not a rank poll or has no `rank_result` yet.
     */
    public createResultContent(poll: PollData): Content[] {
        if (!this.showRankResult(poll)) {
            return [];
        }
        const result = poll.rank_result!;
        if (result.error) {
            return [
                {
                    text: `${this.translate.instant(_(`Counting the ranked ballots failed`))}: ${result.error}`,
                    bold: true,
                    color: `#cc0000`,
                    margin: [0, 5, 0, 5]
                }
            ];
        }

        const candidateRows = this.getCandidateRows(poll, result);
        const content: Content[] = [...this.createElectedList(candidateRows), this.createSummary(result)];
        const detailTables =
            result.algorithm === PollRankAlgorithm.Borda
                ? this.createBordaTable(candidateRows, result)
                : this.createRoundTables(candidateRows, result);
        if (detailTables.length) {
            content.push({
                text: this.translate.instant(_(`Count details`)),
                bold: true,
                margin: [0, 10, 0, 5]
            });
            content.push(...detailTables);
        }
        content.push(...this.createTieBreakNotes(candidateRows, result));
        return content;
    }

    /**
     * The elected candidates in order of election as a numbered list, or a
     * hint that no candidates were elected.
     */
    private createElectedList(candidateRows: RankCandidateRow[]): Content[] {
        const electedNames = candidateRows
            .filter(row => row.electionOrder !== null)
            .sort((a, b) => a.electionOrder! - b.electionOrder!)
            .map(row => row.name);
        const heading: Content = {
            text: this.translate.instant(_(`Elected`)),
            bold: true,
            margin: [0, 10, 0, 5]
        };
        if (!electedNames.length) {
            return [heading, { text: this.translate.instant(_(`No candidates were elected.`)), italics: true }];
        }
        return [heading, { ol: electedNames.map(name => ({ text: name, margin: [0, 0, 0, 2] })) }];
    }

    /** The one-line counting summary below the elected candidates. */
    private createSummary(result: PollRankResult): Content {
        const isBorda = result.algorithm === PollRankAlgorithm.Borda;
        const algorithm = result.algorithm
            ? (PollRankAlgorithmVerbose[result.algorithm as PollRankAlgorithm] ?? result.algorithm)
            : ``;
        const quotaRule = result.quota_rule ? (PollRankQuotaVerbose[result.quota_rule] ?? result.quota_rule) : ``;
        const parts = [
            `${this.translate.instant(_(`Seats`))}: ${result.seats}`,
            ...(isBorda
                ? []
                : [
                      `${this.translate.instant(_(`Quota rule`))}: ${this.translate.instant(quotaRule)}`,
                      `${this.translate.instant(_(`Final quota`))}: ${this.formatDecimal(result.quota_final)}`
                  ]),
            `${this.translate.instant(_(`Ballots`))}: ${result.ballot_count}`,
            `${this.translate.instant(_(`Abstain`))}: ${this.formatDecimal(result.abstain_weight)}`,
            ...(isBorda
                ? []
                : [`${this.translate.instant(_(`Exhausted votes`))}: ${this.formatDecimal(result.exhausted_final)}`]),
            `${this.translate.instant(_(`Algorithm`))}: ${this.translate.instant(algorithm)}`,
            `${this.translate.instant(_(`Tie-break seed`))}: ${result.seed}`
        ];
        return {
            text: parts.join(` · `),
            fontSize: 8,
            color: `#555555`,
            margin: [0, 5, 0, 0]
        };
    }

    /**
     * The round-by-round (Meek) or stage-by-stage (Scottish STV) tables:
     * candidates as rows, rounds as columns, chunked into tables of at most
     * `ROUNDS_PER_TABLE` rounds so they fit on the page. Elected candidates
     * are printed bold from their election round onwards, excluded ones gray
     * from their exclusion round onwards; Meek keep factors are printed below
     * the vote values.
     */
    private createRoundTables(candidateRows: RankCandidateRow[], result: PollRankResult): Content[] {
        const rounds = result.rounds ?? [];
        if (!rounds.length) {
            return [];
        }
        const showKeepFactors = result.algorithm !== PollRankAlgorithm.ScottishStv;
        const roundLabel = this.getRoundLabel(result);
        const tables: Content[] = [];
        for (let start = 0; start < rounds.length; start += ROUNDS_PER_TABLE) {
            const chunk = rounds.slice(start, start + ROUNDS_PER_TABLE);
            const header = [
                { text: this.translate.instant(_(`Candidate`)), style: `tableHeader` },
                ...chunk.map(round => ({
                    text: `${this.translate.instant(roundLabel)} ${round.number}`,
                    style: `tableHeader`
                }))
            ];
            const body: TableCell[][] = [header];
            for (const row of candidateRows) {
                body.push([
                    this.createCandidateCell(row, roundLabel),
                    ...chunk.map(round => this.createVoteCell(row, round, showKeepFactors))
                ]);
            }
            body.push([
                { text: this.translate.instant(_(`Exhausted votes`)), italics: true },
                ...chunk.map(round => ({ text: this.formatDecimal(round.exhausted), italics: true }))
            ]);
            body.push([
                { text: this.translate.instant(_(`Quota`)), italics: true },
                ...chunk.map(round => ({ text: this.formatDecimal(round.quota), italics: true }))
            ]);
            tables.push({
                table: {
                    widths: [`28%`, ...chunk.map(() => `14%`)],
                    headerRows: 1,
                    body
                },
                layout: `switchColorTableLayout`,
                margin: [0, 0, 0, 10]
            });
        }
        return tables;
    }

    /**
     * The candidate name cell of the round tables, annotated with the round
     * of election/exclusion, e.g. "elected (Round 2)".
     */
    private createCandidateCell(row: RankCandidateRow, roundLabel: string): TableCell {
        const stack: Content[] = [{ text: row.name, bold: row.electionOrder !== null }];
        if (row.electedInRound !== null) {
            stack.push(this.createAnnotation(_(`elected`), roundLabel, row.electedInRound));
        } else if (row.excludedInRound !== null) {
            stack.push(this.createAnnotation(_(`excluded`), roundLabel, row.excludedInRound));
        }
        return { stack };
    }

    private createAnnotation(outcome: string, roundLabel: string, round: number): Content {
        return {
            text: `${this.translate.instant(outcome)} (${this.translate.instant(roundLabel)} ${round})`,
            fontSize: 7,
            color: `#555555`
        };
    }

    /** A single vote cell of the round tables. */
    private createVoteCell(row: RankCandidateRow, round: PollRankResultRound, showKeepFactors: boolean): TableCell {
        const votes = round.votes?.[`${row.id}`];
        const isElected = row.electedInRound !== null && round.number >= row.electedInRound;
        const isExcluded = row.excludedInRound !== null && round.number >= row.excludedInRound;
        const stack: Content[] = [
            {
                text: votes !== undefined ? this.formatDecimal(votes) : `–`,
                bold: isElected,
                color: isExcluded ? `#909090` : undefined
            }
        ];
        const keepFactor = showKeepFactors ? round.keep_factors?.[`${row.id}`] : undefined;
        if (keepFactor !== undefined) {
            stack.push({
                text: `${this.translate.instant(_(`Keep factor`))}: ${this.formatDecimal(keepFactor)}`,
                fontSize: 7,
                color: `#555555`
            });
        }
        return { stack };
    }

    /**
     * The Borda points table: every candidate with the weighted point total
     * of the single `rounds` entry, ordered by points (descending), elected
     * candidates first on equal points.
     */
    private createBordaTable(candidateRows: RankCandidateRow[], result: PollRankResult): Content[] {
        const points = result.rounds?.[0]?.votes ?? {};
        const rows = candidateRows
            .map(row => ({ ...row, points: points[`${row.id}`] ?? `0` }))
            .sort(
                (a, b) =>
                    Number(b.points) - Number(a.points) || (a.electionOrder ?? Infinity) - (b.electionOrder ?? Infinity)
            );
        const body: TableCell[][] = [
            [
                { text: this.translate.instant(_(`Candidate`)), style: `tableHeader` },
                { text: this.translate.instant(_(`Points`)), style: `tableHeader` }
            ]
        ];
        for (const row of rows) {
            body.push([
                { text: row.name, bold: row.electionOrder !== null },
                { text: this.formatDecimal(row.points), bold: row.electionOrder !== null }
            ]);
        }
        return [
            {
                table: {
                    widths: [`70%`, `30%`],
                    headerRows: 1,
                    body
                },
                layout: `switchColorTableLayout`,
                margin: [0, 0, 0, 10]
            }
        ];
    }

    /** One note per round whose result was decided by a random tie-break. */
    private createTieBreakNotes(candidateRows: RankCandidateRow[], result: PollRankResult): Content[] {
        const nameById = new Map<Id, string>(candidateRows.map(row => [row.id, row.name]));
        const getName = (id: Id): string => nameById.get(id) ?? this.translate.instant(UnknownUserLabel);
        const isBorda = result.algorithm === PollRankAlgorithm.Borda;
        const roundLabel = this.getRoundLabel(result);
        return (result.rounds ?? [])
            .filter(round => !!round.tie_break)
            .map(round => {
                const among = round.tie_break!.among.map(getName).join(`, `);
                const chosen = getName(round.tie_break!.chosen);
                const outcome =
                    round.excluded === round.tie_break!.chosen
                        ? this.translate.instant(_(`excluded`))
                        : this.translate.instant(_(`elected`));
                // Borda has only a single counting round, so a round prefix would be noise.
                const prefix = isBorda ? `` : `${this.translate.instant(roundLabel)} ${round.number}: `;
                return {
                    text:
                        prefix +
                        `${this.translate.instant(_(`Tie between`))} ${among} ` +
                        `${this.translate.instant(_(`broken randomly`))} → ${chosen} ${outcome}`,
                    fontSize: 8,
                    color: `#555555`,
                    margin: [0, 0, 0, 2]
                };
            });
    }

    /**
     * Scottish STV counts in "stages" (the statutory term of SSI 2007/42);
     * Meek's method is reported in "rounds".
     */
    private getRoundLabel(result: PollRankResult): string {
        return result.algorithm === PollRankAlgorithm.ScottishStv ? _(`Stage`) : _(`Round`);
    }

    private getCandidateRows(poll: PollData, result: PollRankResult): RankCandidateRow[] {
        const nameById = new Map<Id, string>();
        for (const option of poll.options ?? []) {
            if (option.id !== undefined) {
                nameById.set(option.id, option.getOptionTitle().title);
            }
        }
        const elected = result.elected ?? [];
        const rounds = result.rounds ?? [];
        return (result.candidates ?? []).map(id => {
            const electedRound = rounds.find(round => (round.elected ?? []).includes(id));
            const excludedRound = rounds.find(round => round.excluded === id);
            const electionIndex = elected.indexOf(id);
            return {
                id,
                name: nameById.get(id) ?? this.translate.instant(UnknownUserLabel),
                electedInRound: electedRound ? electedRound.number : null,
                electionOrder: electionIndex >= 0 ? electionIndex + 1 : null,
                excludedInRound: excludedRound ? excludedRound.number : null
            };
        });
    }

    /**
     * Formats a decimal string of the backend (e.g. "33.333333333") with at
     * most `maxDecimals` decimal places and without trailing zeros. The full
     * precision remains available through the ballot exports.
     */
    private formatDecimal(value: string | undefined | null, maxDecimals = 3): string {
        if (value === undefined || value === null || value === ``) {
            return ``;
        }
        const numeric = Number(value);
        if (Number.isNaN(numeric)) {
            return value;
        }
        return String(+numeric.toFixed(maxDecimals));
    }
}
