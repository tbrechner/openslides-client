import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { _, TranslateService } from '@ngx-translate/core';
import { Id } from 'src/app/domain/definitions/key-types';
import { PollRankAlgorithm, PollRankAlgorithmVerbose, PollRankQuotaVerbose } from 'src/app/domain/models/poll';
import { PollData } from 'src/app/domain/models/poll/generic-poll';
import { PollRankResult, PollRankResultRound } from 'src/app/domain/models/poll/rank-result';

import { UnknownUserLabel } from '../../services/assignment-poll.service';

/**
 * One row of the round-by-round table: a candidate together with the round
 * in which they were elected/excluded (if any).
 */
interface RankResultCandidateRow {
    id: Id;
    name: string;
    /** The round number in which the candidate was elected, if elected. */
    electedInRound: number | null;
    /** 1-based order of election, if elected. */
    electionOrder: number | null;
    /** The round number in which the candidate was excluded, if excluded. */
    excludedInRound: number | null;
}

/**
 * One row of the Borda points table: a candidate with their weighted point
 * total, ordered by points (descending).
 */
interface BordaResultRow {
    id: Id;
    name: string;
    points: string;
    /** 1-based order of election, if elected. */
    electionOrder: number | null;
}

/**
 * Renders the counting result (`poll.rank_result`) of an assignment poll with
 * pollmethod `rank`, depending on the counting algorithm: the elected
 * candidates in order of election, a summary line and — for the STV
 * algorithms — a round-by-round (Meek) or stage-by-stage (Scottish STV) table
 * with votes (and keep factors for Meek), or a simple points table for the
 * Borda count. Also handles the error variant (`{ version, error }`) of
 * `rank_result`.
 */
@Component({
    selector: `os-assignment-poll-rank-result`,
    templateUrl: `./assignment-poll-rank-result.component.html`,
    styleUrls: [`./assignment-poll-rank-result.component.scss`],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class AssignmentPollRankResultComponent {
    @Input()
    public set poll(poll: PollData) {
        this._poll = poll;
        this.update();
    }

    public get poll(): PollData {
        return this._poll;
    }

    public result: PollRankResult | null = null;

    public rounds: PollRankResultRound[] = [];

    public candidateRows: RankResultCandidateRow[] = [];

    public bordaRows: BordaResultRow[] = [];

    public electedNames: string[] = [];

    public tieBreakNotes: string[] = [];

    public get isError(): boolean {
        return !!this.result?.error;
    }

    public get errorMessage(): string {
        return this.result?.error ?? ``;
    }

    public get algorithmVerbose(): string {
        const algorithm = this.result?.algorithm;
        return algorithm ? (PollRankAlgorithmVerbose[algorithm as PollRankAlgorithm] ?? algorithm) : ``;
    }

    public get isBorda(): boolean {
        return this.result?.algorithm === PollRankAlgorithm.Borda;
    }

    public get isScottish(): boolean {
        return this.result?.algorithm === PollRankAlgorithm.ScottishStv;
    }

    /** Keep factors are a concept of Meek's method only. */
    public get showKeepFactors(): boolean {
        return !this.isBorda && !this.isScottish;
    }

    /**
     * Scottish STV counts in "stages" (the statutory term of SSI 2007/42,
     * e.g. rule 45 "First stage"); Meek's method is reported in "rounds".
     */
    public get roundLabel(): string {
        return this.isScottish ? _(`Stage`) : _(`Round`);
    }

    /** The verbose quota rule ("Droop quota"/"Hare quota"); empty for Borda. */
    public get quotaRuleVerbose(): string {
        const quotaRule = this.result?.quota_rule;
        return quotaRule ? (PollRankQuotaVerbose[quotaRule] ?? quotaRule) : ``;
    }

    private _poll!: PollData;

    public constructor(private translate: TranslateService) {}

    public getVotes(row: RankResultCandidateRow, round: PollRankResultRound): string | null {
        const votes = round.votes?.[`${row.id}`];
        return votes !== undefined ? this.formatDecimal(votes) : null;
    }

    public getKeepFactor(row: RankResultCandidateRow, round: PollRankResultRound): string | null {
        const keepFactor = round.keep_factors?.[`${row.id}`];
        return keepFactor !== undefined ? this.formatDecimal(keepFactor) : null;
    }

    public isElectedInRound(row: RankResultCandidateRow, round: PollRankResultRound): boolean {
        return row.electedInRound === round.number;
    }

    public isExcludedInRound(row: RankResultCandidateRow, round: PollRankResultRound): boolean {
        return row.excludedInRound === round.number;
    }

    public isElectedByRound(row: RankResultCandidateRow, round: PollRankResultRound): boolean {
        return row.electedInRound !== null && round.number >= row.electedInRound;
    }

    public isExcludedByRound(row: RankResultCandidateRow, round: PollRankResultRound): boolean {
        return row.excludedInRound !== null && round.number >= row.excludedInRound;
    }

    /**
     * Formats a decimal string of the backend (e.g. "33.333333333") for
     * display with at most `maxDecimals` decimal places and without trailing
     * zeros. The full precision remains available through the exports.
     */
    public formatDecimal(value: string | undefined | null, maxDecimals = 3): string {
        if (value === undefined || value === null || value === ``) {
            return ``;
        }
        const numeric = Number(value);
        if (Number.isNaN(numeric)) {
            return value;
        }
        return String(+numeric.toFixed(maxDecimals));
    }

    private update(): void {
        this.result = this._poll?.rank_result ?? null;
        this.rounds = [];
        this.candidateRows = [];
        this.bordaRows = [];
        this.electedNames = [];
        this.tieBreakNotes = [];
        if (!this.result || this.result.error) {
            return;
        }

        const nameById = this.getCandidateNames();
        const getName = (id: Id): string => nameById.get(id) ?? this.translate.instant(UnknownUserLabel);
        const elected = this.result.elected ?? [];
        this.rounds = this.result.rounds ?? [];
        this.electedNames = elected.map(getName);
        this.candidateRows = (this.result.candidates ?? []).map(id => {
            const electedRound = this.rounds.find(round => (round.elected ?? []).includes(id));
            const excludedRound = this.rounds.find(round => round.excluded === id);
            const electionIndex = elected.indexOf(id);
            return {
                id,
                name: getName(id),
                electedInRound: electedRound ? electedRound.number : null,
                electionOrder: electionIndex >= 0 ? electionIndex + 1 : null,
                excludedInRound: excludedRound ? excludedRound.number : null
            };
        });
        if (this.isBorda) {
            this.bordaRows = this.getBordaRows();
        }
        this.tieBreakNotes = this.rounds
            .filter(round => !!round.tie_break)
            .map(round => this.getTieBreakNote(round, getName));
    }

    /**
     * The rows of the Borda points table: every candidate with the weighted
     * point total of the single `rounds` entry, ordered by points
     * (descending), elected candidates first on equal points.
     */
    private getBordaRows(): BordaResultRow[] {
        const points = this.rounds[0]?.votes ?? {};
        return this.candidateRows
            .map(row => ({
                id: row.id,
                name: row.name,
                points: points[`${row.id}`] ?? `0`,
                electionOrder: row.electionOrder
            }))
            .sort(
                (a, b) =>
                    Number(b.points) - Number(a.points) || (a.electionOrder ?? Infinity) - (b.electionOrder ?? Infinity)
            );
    }

    private getTieBreakNote(round: PollRankResultRound, getName: (id: Id) => string): string {
        const among = round.tie_break!.among.map(getName).join(`, `);
        const chosen = getName(round.tie_break!.chosen);
        const outcome =
            round.excluded === round.tie_break!.chosen
                ? this.translate.instant(_(`excluded`))
                : this.translate.instant(_(`elected`));
        // Borda has only a single counting round, so a round prefix would be noise.
        const prefix = this.isBorda ? `` : `${this.translate.instant(this.roundLabel)} ${round.number}: `;
        return (
            prefix +
            `${this.translate.instant(_(`Tie between`))} ${among} ` +
            `${this.translate.instant(_(`broken randomly`))} → ${chosen} ${outcome}`
        );
    }

    private getCandidateNames(): Map<Id, string> {
        const nameById = new Map<Id, string>();
        for (const option of this._poll?.options ?? []) {
            if (option.id !== undefined) {
                nameById.set(option.id, option.getOptionTitle().title);
            }
        }
        return nameById;
    }
}
