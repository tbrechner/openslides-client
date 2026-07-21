import { Component, Inject, ViewChild } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { BaseModel } from 'src/app/domain/models/base/base-model';
import {
    GeneralValueVerbose,
    GlobalOptionKey,
    parseRankVoteValue,
    PollMethod,
    PollPercentBaseVerbose,
    PollPropertyVerbose,
    VoteValue
} from 'src/app/domain/models/poll';
import {
    BasePollDialogComponent,
    OptionsObject
} from 'src/app/site/pages/meetings/modules/poll/base/base-poll-dialog.component';
import { PollRankBallotEntryComponent } from 'src/app/site/pages/meetings/modules/poll/components/poll-rank-ballot-entry/poll-rank-ballot-entry.component';
import { ViewAssignment } from 'src/app/site/pages/meetings/pages/assignments';
import { ViewPoll } from 'src/app/site/pages/meetings/pages/polls';

import { AssignmentPollMethodVerbose, AssignmentPollPercentBaseVerbose } from '../../definitions';
import { AssignmentPollService, UnknownUserLabel } from '../../services/assignment-poll.service';

@Component({
    selector: `os-assignment-poll-dialog`,
    templateUrl: `./assignment-poll-dialog.component.html`,
    styleUrls: [`./assignment-poll-dialog.component.scss`],
    standalone: false
})
export class AssignmentPollDialogComponent extends BasePollDialogComponent {
    public unknownUserLabel = UnknownUserLabel;

    /**
     * List of accepted special non-numerical values.
     * See {@link PollService.specialPollVotes}
     */
    public specialValues: [number, string][] = [];

    public generalValueVerbose = GeneralValueVerbose;
    public PollPropertyVerbose = PollPropertyVerbose;

    public AssignmentPollMethodVerbose = AssignmentPollMethodVerbose;
    public get AssignmentPollPercentBaseVerbose(): Record<string, string> {
        return this.pollData.isListPoll ? PollPercentBaseVerbose : AssignmentPollPercentBaseVerbose;
    }

    public readonly globalValues: GlobalOptionKey[] = [`global_yes`, `global_no`, `global_abstain`];

    @ViewChild(PollRankBallotEntryComponent)
    public rankBallotEntry: PollRankBallotEntryComponent | undefined;

    /** Whether the dialog edits an analog rank poll (paper ballot entry). */
    public get isRankAnalogPoll(): boolean {
        return this.isAnalogPoll && this.isRankPoll;
    }

    public get isGlobalAbstainEnabled(): boolean {
        return !!this.pollForm?.contentForm.get(`global_abstain`)?.value;
    }

    /** The candidate names in ballot-paper order for the entry legend. */
    public get rankCandidateNames(): string[] {
        return this.orderedRankOptions.map(option => this.getCandidateLabel(option));
    }

    /**
     * The options in ballot-paper order (option weight order — the order the
     * backend and the ballot papers PDF use for the candidate numbers).
     */
    private get orderedRankOptions(): any[] {
        const options = [...(this.options ?? [])];
        if (options.length && typeof (options[0] as any).weight === `number`) {
            options.sort((a: any, b: any) => (a as any).weight - (b as any).weight);
        }
        return options;
    }

    /**
     * The ballots of an already saved analog rank poll, reconstructed from
     * the vote records on the global option: one line per ballot, weight-N
     * records expanded to N identical lines.
     */
    public get rankBallotsInitialText(): string {
        if (!this.isRankAnalogPoll || !(this.pollData instanceof ViewPoll)) {
            return ``;
        }
        const optionIds = this.orderedRankOptions.map(option => option.id);
        const lines: string[] = [];
        for (const vote of this.pollData.global_option?.votes ?? []) {
            const ranking = parseRankVoteValue(vote.value);
            if (!ranking) {
                continue;
            }
            const numbers = ranking.map(optionId => optionIds.indexOf(optionId) + 1).filter(number => number > 0);
            if (!numbers.length) {
                continue;
            }
            const count = Math.max(1, Math.round(Number(vote.weight) || 1));
            for (let i = 0; i < count; i++) {
                lines.push(numbers.join(` `));
            }
        }
        return lines.join(`\n`);
    }

    /**
     * Warns (non-blocking) when the entered ballots and abstains do not add
     * up to the entered number of valid votes.
     */
    public get rankBallotMismatch(): boolean {
        if (!this.rankBallotEntry) {
            return false;
        }
        const votesvalid = parseFloat(this.dialogVoteForm?.value?.votesvalid);
        if (isNaN(votesvalid) || votesvalid < 0) {
            return false;
        }
        const abstainRaw = parseFloat(this.dialogVoteForm?.value?.amount_global_abstain);
        const abstain = isNaN(abstainRaw) || abstainRaw < 0 ? 0 : abstainRaw;
        return this.rankBallotEntry.ballotCount + abstain !== votesvalid;
    }

    public get isCreatedOrNewPoll(): boolean {
        return !(this.pollData instanceof ViewPoll) || this.pollData.isCreated;
    }

    public override get formsValid(): boolean {
        if (this.isRankAnalogPoll && this.rankBallotEntry && !this.rankBallotEntry.valid) {
            return false;
        }
        return super.formsValid;
    }

    /**
     * Constructor. Retrieves necessary metadata from the pollService,
     * injects the poll itself
     */
    public constructor(
        public readonly assignmentPollService: AssignmentPollService,
        @Inject(MAT_DIALOG_DATA) pollData: ViewPoll
    ) {
        super(pollData);
    }

    public override onBeforeInit(): void {
        this.subscriptions.push(
            this.pollForm!.contentForm.valueChanges.pipe(debounceTime(150), distinctUntilChanged()).subscribe(() => {
                this.triggerUpdate();
            })
        );
    }

    public getOptionAmount(): number {
        return this._options?.length;
    }

    public optionIsList(option: OptionsObject): boolean {
        return !!option.poll_candidate_user_ids?.length;
    }

    /** Change-detection trigger for the tally and the mismatch warning. */
    public onRankBallotsChange(): void {}

    protected getContentObjectsForOptions(): BaseModel[] {
        if (!this.pollData) {
            return [];
        }
        const contentObject = this.pollData.content_object as ViewAssignment;
        return contentObject.candidatesAsUsers;
    }

    protected getAnalogVoteFields(): VoteValue[] {
        const pollmethod = this.pollForm!.contentForm.get(`pollmethod`)!.value;

        const analogPollValues: VoteValue[] = [];

        if (pollmethod === PollMethod.Rank) {
            // ballots of analog rank polls are entered as rankings, not as
            // per-option amounts
            return analogPollValues;
        }

        if (pollmethod === PollMethod.N) {
            analogPollValues.push(`N`);
        } else {
            analogPollValues.push(`Y`);

            if (pollmethod !== PollMethod.Y) {
                analogPollValues.push(`N`);
            }
            if ((pollmethod as string).toUpperCase() === PollMethod.YNA) {
                analogPollValues.push(`A`);
            }
        }

        return analogPollValues;
    }

    protected override enrichAnalogPayload(payload: any): void {
        if (this.isRankAnalogPoll) {
            payload.rank_ballots = (this.rankBallotEntry?.rankings ?? []).map(ranking => ({ ranking }));
        }
    }

    private getCandidateLabel(option: any): string {
        if (typeof option?.getOptionTitle === `function`) {
            return option.getOptionTitle().title;
        }
        if (typeof option?.content_object?.getFullName === `function`) {
            return option.content_object.getFullName();
        }
        return option?.text ?? UnknownUserLabel;
    }
}
