import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { _ } from '@ngx-translate/core';
import { Id } from 'src/app/domain/definitions/key-types';
import { OpenSlidesTranslationModule } from 'src/app/site/modules/translations';
import { ViewOption } from 'src/app/site/pages/meetings/pages/polls';

/**
 * A two-panel ranking ballot for polls with pollmethod `rank`:
 * a pool of unranked candidates on one side and the ordered, numbered
 * ranking on the other. Candidates can be moved via drag & drop between
 * the two connected CDK drop lists or via the [+]/[-] buttons (tap fallback
 * for mobile). Reordering within the ranking is done via drag & drop.
 *
 * The component is stateless: it renders the given `ranking` (ordered list of
 * option ids) and emits the new ranking through `rankingChange` on every change.
 */
@Component({
    selector: `os-poll-rank-ballot`,
    templateUrl: `./poll-rank-ballot.component.html`,
    styleUrls: [`./poll-rank-ballot.component.scss`],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DragDropModule, MatButtonModule, MatIconModule, OpenSlidesTranslationModule]
})
export class PollRankBallotComponent {
    /**
     * All options of the poll in ballot order.
     */
    @Input()
    public set candidates(options: ViewOption[]) {
        this._candidates = options || [];
    }

    public get candidates(): ViewOption[] {
        return this._candidates;
    }

    /**
     * The current ranking as ordered list of option ids, most preferred first.
     */
    @Input()
    public ranking: Id[] = [];

    @Input()
    public disabled = false;

    @Output()
    public readonly rankingChange = new EventEmitter<Id[]>();

    public readonly rankBallotHint = _(`Drag candidates into your preferred order. You do not need to rank everyone.`);
    public readonly candidatesLabel = _(`Candidates`);
    public readonly rankingLabel = _(`Your ranking`);
    public readonly emptyPoolLabel = _(`All candidates are ranked.`);
    public readonly emptyRankingLabel = _(`No candidates ranked yet.`);

    private _candidates: ViewOption[] = [];

    public get rankedOptions(): ViewOption[] {
        return this.ranking
            .map(id => this._candidates.find(option => option.id === id))
            .filter(option => !!option) as ViewOption[];
    }

    public get unrankedOptions(): ViewOption[] {
        return this._candidates.filter(option => !this.ranking.includes(option.id));
    }

    public getOptionLabel(option: ViewOption): string {
        return option.getOptionTitle().title;
    }

    public getOptionSubtitle(option: ViewOption): string | undefined {
        return option.getOptionTitle().subtitle;
    }

    public addToRanking(option: ViewOption): void {
        if (!this.disabled && !this.ranking.includes(option.id)) {
            this.rankingChange.emit([...this.ranking, option.id]);
        }
    }

    public removeFromRanking(option: ViewOption): void {
        if (!this.disabled) {
            this.rankingChange.emit(this.ranking.filter(id => id !== option.id));
        }
    }

    public dropIntoRanking(event: CdkDragDrop<string>): void {
        const optionId: Id = event.item.data;
        const newRanking = [...this.ranking];
        if (event.previousContainer === event.container) {
            moveItemInArray(newRanking, event.previousIndex, event.currentIndex);
        } else {
            newRanking.splice(event.currentIndex, 0, optionId);
        }
        this.rankingChange.emit(newRanking);
    }

    public dropIntoPool(event: CdkDragDrop<string>): void {
        if (event.previousContainer === event.container) {
            return;
        }
        const optionId: Id = event.item.data;
        this.rankingChange.emit(this.ranking.filter(id => id !== optionId));
    }
}
