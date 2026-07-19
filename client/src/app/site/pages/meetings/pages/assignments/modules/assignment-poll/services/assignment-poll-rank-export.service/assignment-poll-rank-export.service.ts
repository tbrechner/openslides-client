import { Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { Id } from 'src/app/domain/definitions/key-types';
import { parseRankVoteValue, PollType } from 'src/app/domain/models/poll';
import { FileExportService } from 'src/app/gateways/export/file-export.service';
import { ViewPoll } from 'src/app/site/pages/meetings/pages/polls';

import { ViewAssignment } from '../../../../view-models';
import { UnknownUserLabel } from '../assignment-poll.service';

/** The voter of a ballot of a non-anonymous (named, not anonymized) poll. */
interface BallotVoter {
    name: string;
    /** The voter's structure level names, comma-joined; may be empty. */
    structureLevel: string;
}

interface RankedBallot {
    weight: number;
    /** Ranked option ids, most preferred first. */
    ranking: Id[];
    voter?: BallotVoter;
}

interface AbstainBallot {
    weight: number;
    voter?: BallotVoter;
}

/**
 * Client-side exports of the raw ballots and the counting result of rank
 * (STV) assignment polls. The ballots are reconstructed from the vote records
 * on the poll's global option, where each ranked ballot is stored as a JSON
 * string (`{"<option_id>": <rank>, ...}`) and each explicit abstention as the
 * plain string "A".
 */
@Injectable({
    providedIn: `root`
})
export class AssignmentPollRankExportService {
    public constructor(
        private exporter: FileExportService,
        private translate: TranslateService
    ) {}

    /**
     * Exports the ballots in BLT format: a `<n_candidates> <seats>` header,
     * one line per non-abstain ballot (`<weight> <preference indexes...> 0`
     * with 1-based candidate indexes in `rank_result.candidates` order), a
     * terminating `0`, the quoted candidate names and the quoted poll title.
     * Abstain ballots are not part of a BLT file.
     */
    public exportBlt(poll: ViewPoll<ViewAssignment>): void {
        const candidateIds = this.getCandidateIds(poll);
        const { rankings } = this.getBallots(poll);
        const lines: string[] = [`${candidateIds.length} ${this.getSeats(poll)}`];
        for (const ballot of rankings) {
            const preferences = ballot.ranking
                .map(optionId => candidateIds.indexOf(optionId) + 1)
                .filter(index => index > 0);
            lines.push([this.formatWeight(ballot.weight), ...preferences, 0].join(` `));
        }
        lines.push(`0`);
        for (const optionId of candidateIds) {
            lines.push(`"${this.bltEscape(this.getCandidateName(poll, optionId))}"`);
        }
        lines.push(`"${this.bltEscape(poll.title)}"`);
        this.exporter.saveFile(lines.join(`\n`) + `\n`, this.getFilename(poll, `ballots`, `blt`), `text/plain`);
    }

    /**
     * Exports the ballots as CSV with the header
     * `ballot,weight,choice_1..choice_k` (k = longest ranking) and candidate
     * names as choices. For non-anonymous polls (named, not anonymized)
     * `voter` and `structure_level` columns are inserted after `ballot`.
     * Abstain ballots are included as rows with their weight and all choice
     * columns empty.
     */
    public exportCsv(poll: ViewPoll<ViewAssignment>): void {
        const includeVoters = this.includesVoters(poll);
        const { rankings, abstains } = this.getBallots(poll);
        const maxChoices = Math.max(0, ...rankings.map(ballot => ballot.ranking.length));
        const header = [
            `ballot`,
            ...(includeVoters ? [`voter`, `structure_level`] : []),
            `weight`,
            ...Array.from({ length: maxChoices }, (_, index) => `choice_${index + 1}`)
        ];
        const rows: string[][] = [header];
        let ballotNumber = 1;
        const voterCells = (ballot: RankedBallot | AbstainBallot): string[] =>
            includeVoters ? [ballot.voter?.name ?? ``, ballot.voter?.structureLevel ?? ``] : [];
        for (const ballot of rankings) {
            const choices = ballot.ranking.map(optionId => this.getCandidateName(poll, optionId));
            rows.push([
                `${ballotNumber++}`,
                ...voterCells(ballot),
                this.formatWeight(ballot.weight),
                ...choices,
                ...Array(maxChoices - choices.length).fill(``)
            ]);
        }
        for (const ballot of abstains) {
            rows.push([
                `${ballotNumber++}`,
                ...voterCells(ballot),
                this.formatWeight(ballot.weight),
                ...Array(maxChoices).fill(``)
            ]);
        }
        const csv = rows.map(row => row.map(cell => this.csvEscape(cell)).join(`,`)).join(`\r\n`) + `\r\n`;
        this.exporter.saveFile(csv, this.getFilename(poll, `ballots`, `csv`), `text/csv`);
    }

    /**
     * Exports poll metadata, candidates, the raw ballots (abstentions as
     * `{ weight, abstain: true }`) and the full `rank_result` as JSON. For
     * non-anonymous polls (named, not anonymized) each ballot carries a
     * `voter: { name, structure_level }` object.
     */
    public exportJson(poll: ViewPoll<ViewAssignment>): void {
        const candidateIds = this.getCandidateIds(poll);
        const { rankings, abstains } = this.getBallots(poll);
        const voterField = (ballot: RankedBallot | AbstainBallot): { voter?: object } =>
            ballot.voter ? { voter: { name: ballot.voter.name, structure_level: ballot.voter.structureLevel } } : {};
        const data = {
            poll: {
                id: poll.id,
                title: poll.title,
                meeting: poll.meeting?.name ?? null,
                method: poll.pollmethod,
                seats: this.getSeats(poll),
                type: poll.type,
                state: poll.state
            },
            candidates: candidateIds.map(optionId => ({
                option_id: optionId,
                name: this.getCandidateName(poll, optionId)
            })),
            ballots: [
                ...rankings.map(ballot => ({
                    weight: ballot.weight,
                    ranking: ballot.ranking,
                    ...voterField(ballot)
                })),
                ...abstains.map(ballot => ({ weight: ballot.weight, abstain: true, ...voterField(ballot) }))
            ],
            result: poll.rank_result ?? null
        };
        this.exporter.saveFile(
            JSON.stringify(data, null, 2),
            this.getFilename(poll, `stv-result`, `json`),
            `application/json`
        );
    }

    /**
     * Whether the exports may identify the voters: only for named polls
     * whose votes have not been anonymized.
     */
    private includesVoters(poll: ViewPoll<ViewAssignment>): boolean {
        return poll.type === PollType.Named && !poll.is_pseudoanonymized;
    }

    /**
     * Reconstructs the ballots from the vote records on the global option.
     * For non-anonymous polls each ballot carries its voter and the ballots
     * are sorted by voter name.
     */
    private getBallots(poll: ViewPoll<ViewAssignment>): { rankings: RankedBallot[]; abstains: AbstainBallot[] } {
        const includeVoters = this.includesVoters(poll);
        const rankings: RankedBallot[] = [];
        const abstains: AbstainBallot[] = [];
        for (const vote of poll.global_option?.votes ?? []) {
            if (!(vote.weight > 0)) {
                continue;
            }
            const voter = includeVoters
                ? {
                      voter: {
                          name: vote.user?.getShortName() ?? this.translate.instant(UnknownUserLabel),
                          structureLevel: vote.user?.structure_level(poll.meeting_id) ?? ``
                      }
                  }
                : {};
            const ranking = parseRankVoteValue(vote.value);
            if (ranking) {
                rankings.push({ weight: vote.weight, ranking, ...voter });
            } else if (vote.value === `A`) {
                abstains.push({ weight: vote.weight, ...voter });
            }
        }
        if (includeVoters) {
            const byName = (a: RankedBallot | AbstainBallot, b: RankedBallot | AbstainBallot): number =>
                (a.voter?.name ?? ``).localeCompare(b.voter?.name ?? ``);
            rankings.sort(byName);
            abstains.sort(byName);
        }
        return { rankings, abstains };
    }

    /**
     * All option ids in ballot-paper order. Prefers the order recorded in
     * `rank_result.candidates` (which the BLT indexes must match); falls back
     * to the poll's option order if the result is missing or errored.
     */
    private getCandidateIds(poll: ViewPoll<ViewAssignment>): Id[] {
        const fromResult = poll.rank_result?.candidates;
        return fromResult?.length ? fromResult : (poll.options ?? []).map(option => option.id);
    }

    private getSeats(poll: ViewPoll<ViewAssignment>): number {
        return poll.rank_result?.seats ?? poll.content_object?.open_posts ?? 1;
    }

    private getCandidateName(poll: ViewPoll<ViewAssignment>, optionId: Id): string {
        const option = (poll.options ?? []).find(opt => opt.id === optionId);
        return option ? option.getOptionTitle().title : this.translate.instant(UnknownUserLabel);
    }

    /**
     * Integral weights are written as integers, fractional weights (vote
     * weight enabled) as decimal strings. Note that some third-party BLT
     * tools only accept integer weights.
     */
    private formatWeight(weight: number): string {
        return String(weight);
    }

    private bltEscape(value: string): string {
        return value.replace(/"/g, `'`).replace(/[\r\n]+/g, ` `);
    }

    private csvEscape(value: string): string {
        if (/[",\r\n]/.test(value)) {
            return `"${value.replace(/"/g, `""`)}"`;
        }
        return value;
    }

    private getFilename(poll: ViewPoll<ViewAssignment>, suffix: string, extension: string): string {
        const title = poll.title?.trim() ? poll.title.trim() : `poll-${poll.id}`;
        return `${title.replace(/[/\\]/g, `-`)} - ${suffix}.${extension}`;
    }
}
