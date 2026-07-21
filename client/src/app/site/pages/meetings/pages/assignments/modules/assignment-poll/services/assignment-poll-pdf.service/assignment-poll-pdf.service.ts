import { Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { PollMethod } from 'src/app/domain/models/poll/poll-constants';
import {
    AbstractPollData,
    BasePollPdfService
} from 'src/app/site/pages/meetings/modules/poll/base/base-poll-pdf.service';
import { ViewPoll } from 'src/app/site/pages/meetings/pages/polls';
import { MeetingSettingsService } from 'src/app/site/pages/meetings/services/meeting-settings.service';

import { AssignmentControllerService } from '../../../../services/assignment-controller.service';
import { ViewAssignment } from '../../../../view-models';
import { AssignmentPollService } from '../assignment-poll.service';

@Injectable({
    providedIn: 'root'
})
export class AssignmentPollPdfService extends BasePollPdfService {
    public constructor(
        meetingSettingsService: MeetingSettingsService,
        protected override translate: TranslateService,
        private assignmentRepo: AssignmentControllerService,
        pollService: AssignmentPollService
    ) {
        super(pollService);
        meetingSettingsService
            .get(`assignment_poll_ballot_paper_number`)
            .subscribe(count => (this.ballotCustomCount = count));
        meetingSettingsService
            .get(`assignment_poll_ballot_paper_selection`)
            .subscribe(selection => (this.ballotCountSelection = selection));
    }

    /**
     * Triggers a pdf creation for this poll's ballots. Currently, only ballots
     * for a limited amount of candidates will return useful pdfs:
     * - about 15 candidates (method: yes/no and yes/no/abstain)
     * - about 29 candidates (one vote per candidate)
     *
     * @param title (optional) a different title
     * @param subtitle (optional) a different subtitle
     */
    public printBallots(poll: ViewPoll, title?: string, subtitle?: string): void {
        const assignment = this.assignmentRepo.getViewModel(poll.content_object?.id)!;
        const fileName = `${this.translate.instant(`Election`)} - ${assignment.getTitle()} - ${this.translate.instant(
            `ballot-paper` // TODO proper title (second election?)
        )}`;
        if (!title) {
            title = assignment.getTitle();
        }
        if (!subtitle) {
            subtitle = poll.getTitle();
        }
        if (subtitle.length > 90) {
            subtitle = subtitle.substring(0, 90) + `...`;
        }
        const rowsPerPage = this.getRowsPerPage(poll);
        const sheetEnd = Math.floor(417 / rowsPerPage);
        this.downloadWithBallotPaper(
            this.getPages(rowsPerPage, { sheetend: sheetEnd, title, subtitle, poll }),
            fileName
        );
    }

    protected getPollResultFileNamePrefix(poll: ViewPoll): string {
        return (poll.content_object as ViewAssignment)?.getTitle();
    }

    /**
     * Rank (STV) ballots are taller than yes/no ballots: they carry the extra
     * ranking instruction and a write-in box for every candidate. Fewer fit on
     * a page, otherwise the last row overflows its cell.
     */
    protected override getRowsPerPage(poll: ViewPoll): number {
        if (poll.pollmethod !== PollMethod.Rank) {
            return super.getRowsPerPage(poll);
        }
        const optionCount = poll.options.length + (poll.global_abstain ? 1 : 0);
        if (optionCount <= 2) {
            return 3;
        } else if (optionCount <= 5) {
            return 2;
        }
        return 1;
    }

    /**
     * Creates one ballot in it's position on the page. Note that creating once
     * and then pasting the result several times does not work
     */
    protected createBallot(data: AbstractPollData): object {
        return {
            columns: [
                {
                    width: 1,
                    margin: [0, data.sheetend],
                    text: ``
                },
                {
                    width: `*`,
                    stack: [
                        this.getHeader(),
                        this.getTitle(data.title),
                        this.getSubtitle(data.subtitle),
                        this.createPollHint(data.poll),
                        ...(data.poll.pollmethod === PollMethod.Rank ? [this.createRankHint()] : []),
                        this.createOptionFields(data.poll)
                    ],
                    margin: [0, 0, 0, 0]
                }
            ]
        };
    }

    private createOptionFields(poll: ViewPoll): object {
        const options = poll.options.sort((a, b) => a.weight - b.weight);
        const resultObject = options.map(opt => {
            let optionName = ``;
            if (opt.isListOption) {
                optionName = this.translate.instant(opt.content_object?.getTitle() ?? ``);
            } else {
                optionName = opt.content_object?.full_name;
            }
            if (optionName) {
                if (poll.pollmethod === PollMethod.Rank) {
                    return this.createRankBallotEntry(optionName);
                }
                return poll.pollmethod === PollMethod.Y
                    ? this.createBallotOption(optionName)
                    : this.createYNBallotEntry(optionName, poll.pollmethod);
            } else {
                throw new Error(this.translate.instant(`This ballot contains deleted users.`));
            }
        });

        if (poll.pollmethod === PollMethod.Rank && poll.global_abstain) {
            const abstainEntry = this.createBallotOption(this.translate.instant(`Abstain`));
            abstainEntry.margin[1] = 25;
            resultObject.push(abstainEntry);
        }

        if (poll.pollmethod === PollMethod.Y) {
            if (poll.global_yes) {
                const yesEntry = this.createBallotOption(this.translate.instant(`Yes`));
                yesEntry.margin[1] = 25;
                resultObject.push(yesEntry);
            }

            if (poll.global_no) {
                const noEntry = this.createBallotOption(this.translate.instant(`No`));
                noEntry.margin[1] = 25;
                resultObject.push(noEntry);
            }

            if (poll.global_abstain) {
                const abstainEntry = this.createBallotOption(this.translate.instant(`Abstain`));
                abstainEntry.margin[1] = 25;
                resultObject.push(abstainEntry);
            }
        }
        return resultObject;
    }

    /**
     * Creates one entry of a ranked-choice ballot: an empty box to write the
     * rank number into, followed by the candidate's name.
     */
    private createRankBallotEntry(option: string): { margin: number[]; columns: object[] } {
        const boxSize = 14;
        return {
            margin: [21, 10, 0, 0],
            columns: [
                {
                    width: boxSize + 7,
                    canvas: [
                        {
                            type: `rect`,
                            x: 0,
                            y: 0,
                            w: boxSize,
                            h: boxSize,
                            lineColor: `black`
                        }
                    ]
                },
                {
                    width: `auto`,
                    text: option,
                    margin: [0, 2, 0, 0]
                }
            ]
        };
    }

    /**
     * The filling instruction printed on ranked-choice (STV) ballots.
     */
    private createRankHint(): object {
        return {
            text: this.translate.instant(
                `Rank the candidates in order of preference: 1 for your first choice, 2 for your second choice, and so on. You do not have to rank all candidates.`
            ),
            style: `description`,
            margin: [20, 5, 10, 0]
        };
    }

    private createYNBallotEntry(option: string, method: PollMethod): object {
        const choices = method === `YNA` ? [`Yes`, `No`, `Abstain`] : [`Yes`, `No`];
        const columnstack = choices.map(choice => ({
            width: `auto`,
            stack: [this.createBallotOption(this.translate.instant(choice))]
        }));
        return [
            {
                text: option,
                margin: [21, 10, 0, 0]
            },
            {
                width: `auto`,
                columns: columnstack
            }
        ];
    }

    /**
     * Generates the poll description
     *
     * @param poll
     * @returns pdfMake definitions
     */
    private createPollHint(poll: ViewPoll): object {
        return {
            text: poll.content_object?.default_poll_description || ``,
            style: `description`
        };
    }
}
