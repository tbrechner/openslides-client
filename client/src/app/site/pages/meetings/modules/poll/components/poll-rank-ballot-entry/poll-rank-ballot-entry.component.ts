import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { TranslateService } from '@ngx-translate/core';
import { OpenSlidesTranslationModule } from 'src/app/site/modules/translations';

/**
 * One parse problem of the entered ballot text or an imported file,
 * anchored to a 1-based line number.
 */
export interface RankBallotEntryError {
    line: number;
    message: string;
}

/**
 * The parsed state of the entry: one ranking (list of 1-based candidate
 * numbers in ballot-paper order, most preferred first) per entered ballot.
 */
export interface RankBallotEntryState {
    rankings: number[][];
    errors: RankBallotEntryError[];
}

/**
 * Entry mask for transcribing paper ballots of an analog rank poll:
 * a numbered candidate list in ballot-paper order and a text box taking one
 * ballot per line as candidate numbers in preference order (e.g. `3 1 4`).
 * BLT or CSV files (mirroring the poll's export formats) can be imported into
 * the text box for review before saving.
 */
@Component({
    selector: `os-poll-rank-ballot-entry`,
    templateUrl: `./poll-rank-ballot-entry.component.html`,
    styleUrls: [`./poll-rank-ballot-entry.component.scss`],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, MatButtonModule, MatIconModule, MatMenuModule, OpenSlidesTranslationModule]
})
export class PollRankBallotEntryComponent {
    /**
     * The candidate names in ballot-paper order. The 1-based position in this
     * list is the number the teller types.
     */
    @Input()
    public candidateNames: string[] = [];

    /**
     * Prefills the text box, e.g. with the ballots reconstructed from the
     * stored vote records when editing a poll.
     */
    @Input()
    public set initialText(text: string) {
        if (text && !this.text) {
            this.text = text;
            this.parse();
        }
    }

    @Output()
    public ballotsChange = new EventEmitter<RankBallotEntryState>();

    public text = ``;

    public errors: RankBallotEntryError[] = [];

    public importErrors: RankBallotEntryError[] = [];

    public rankings: number[][] = [];

    public get valid(): boolean {
        return this.errors.length === 0;
    }

    public get ballotCount(): number {
        return this.rankings.length;
    }

    private _importMode: `replace` | `append` = `replace`;

    public constructor(
        private translate: TranslateService,
        private cd: ChangeDetectorRef
    ) {}

    public onTextChange(): void {
        this.parse();
    }

    public startImport(fileInput: HTMLInputElement, mode: `replace` | `append`): void {
        this._importMode = mode;
        fileInput.value = ``;
        fileInput.click();
    }

    public async onFileSelected(fileInput: HTMLInputElement): Promise<void> {
        const file = fileInput.files?.[0];
        if (!file) {
            return;
        }
        const content = await file.text();
        const isCsv =
            file.name.toLowerCase().endsWith(`.csv`) ||
            (!file.name.toLowerCase().endsWith(`.blt`) && content.split(`\n`, 1)[0]?.includes(`,`));
        const result = isCsv ? this.parseCsv(content) : this.parseBlt(content);
        if (result.errors.length) {
            this.importErrors = result.errors;
        } else {
            this.importErrors = [];
            const imported = result.lines.join(`\n`);
            this.text =
                this._importMode === `append` && this.text.trim() ? `${this.text.trimEnd()}\n${imported}` : imported;
            this.parse();
        }
        this.cd.markForCheck();
    }

    /**
     * Parses the text box: one ballot per line, candidate numbers separated
     * by spaces or commas. Blank lines are ignored.
     */
    private parse(): void {
        const rankings: number[][] = [];
        const errors: RankBallotEntryError[] = [];
        const lines = this.text.split(`\n`);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) {
                continue;
            }
            const ranking = this.parseRankingTokens(line.split(/[\s,]+/), i + 1, errors);
            if (ranking) {
                rankings.push(ranking);
            }
        }
        this.rankings = rankings;
        this.errors = errors;
        this.ballotsChange.emit({ rankings, errors });
    }

    private parseRankingTokens(tokens: string[], line: number, errors: RankBallotEntryError[]): number[] | null {
        const ranking: number[] = [];
        for (const token of tokens) {
            if (!/^\d+$/.test(token)) {
                errors.push({
                    line,
                    message: this.translate.instant(`"%s" is not a candidate number`).replace(`%s`, token)
                });
                return null;
            }
            const num = parseInt(token, 10);
            if (num < 1 || num > this.candidateNames.length) {
                errors.push({
                    line,
                    message: this.translate.instant(`There is no candidate with number %s`).replace(`%s`, token)
                });
                return null;
            }
            if (ranking.includes(num)) {
                errors.push({
                    line,
                    message: this.translate.instant(`Candidate %s is ranked twice`).replace(`%s`, String(num))
                });
                return null;
            }
            ranking.push(num);
        }
        return ranking.length ? ranking : null;
    }

    /**
     * Parses a BLT file (`n seats` header, ballot lines `weight num… 0`,
     * ballots terminated by a `0` line; candidate names and title after the
     * terminator are ignored). A ballot with weight N becomes N identical
     * lines so the teller can review each paper ballot.
     */
    private parseBlt(content: string): { lines: string[]; errors: RankBallotEntryError[] } {
        const lines: string[] = [];
        const errors: RankBallotEntryError[] = [];
        const rows = content.split(`\n`).map(row => row.trim());
        let row = 0;
        while (row < rows.length && !rows[row]) {
            row++;
        }
        const header = rows[row]?.split(/\s+/) ?? [];
        if (header.length < 2 || !/^\d+$/.test(header[0]) || !/^\d+$/.test(header[1])) {
            errors.push({
                line: row + 1,
                message: this.translate.instant(`Missing BLT header line (candidates and seats)`)
            });
            return { lines, errors };
        }
        const candidateCount = parseInt(header[0], 10);
        if (candidateCount !== this.candidateNames.length) {
            errors.push({
                line: row + 1,
                message: this.translate
                    .instant(`The file has %s candidates, but this poll has %s`)
                    .replace(`%s`, header[0])
                    .replace(`%s`, String(this.candidateNames.length))
            });
            return { lines, errors };
        }
        for (row++; row < rows.length; row++) {
            const line = rows[row];
            if (!line) {
                continue;
            }
            if (line === `0`) {
                // end-of-ballots marker; names and title follow
                return { lines, errors };
            }
            const tokens = line.split(/\s+/);
            const last = tokens.pop();
            const weightToken = tokens.shift();
            if (last !== `0` || !weightToken || !/^\d+$/.test(weightToken) || parseInt(weightToken, 10) < 1) {
                errors.push({
                    line: row + 1,
                    message: this.translate.instant(`Invalid BLT ballot line (expected "weight number… 0")`)
                });
                continue;
            }
            if (!this.parseRankingTokens(tokens, row + 1, errors)) {
                continue;
            }
            const weight = parseInt(weightToken, 10);
            for (let i = 0; i < weight; i++) {
                lines.push(tokens.join(` `));
            }
        }
        errors.push({ line: rows.length, message: this.translate.instant(`Missing "0" end-of-ballots line`) });
        return { lines, errors };
    }

    /**
     * Parses a CSV file with `choice_1..choice_k` columns holding candidate
     * names (as written by the poll's CSV export). An optional `weight` or
     * `count` column repeats the ballot; other columns are ignored.
     */
    private parseCsv(content: string): { lines: string[]; errors: RankBallotEntryError[] } {
        const lines: string[] = [];
        const errors: RankBallotEntryError[] = [];
        const rows = content.split(`\n`).map(row => row.replace(/\r$/, ``));
        const delimiter = (rows[0]?.match(/;/g)?.length ?? 0) > (rows[0]?.match(/,/g)?.length ?? 0) ? `;` : `,`;
        const header = this.splitCsvRow(rows[0] ?? ``, delimiter).map(cell => cell.trim().toLowerCase());
        const choiceColumns: number[] = [];
        for (let index = 1; ; index++) {
            const column = header.indexOf(`choice_${index}`);
            if (column === -1) {
                break;
            }
            choiceColumns.push(column);
        }
        if (!choiceColumns.length) {
            errors.push({ line: 1, message: this.translate.instant(`Missing "choice_1" column in the CSV header`) });
            return { lines, errors };
        }
        const weightColumn = header.findIndex(cell => cell === `weight` || cell === `count`);
        const names = this.candidateNames.map(name => name.trim().toLowerCase());
        for (let row = 1; row < rows.length; row++) {
            if (!rows[row].trim()) {
                continue;
            }
            const cells = this.splitCsvRow(rows[row], delimiter);
            const ranking: number[] = [];
            let ok = true;
            for (const column of choiceColumns) {
                const cell = (cells[column] ?? ``).trim();
                if (!cell) {
                    break;
                }
                const num = names.indexOf(cell.toLowerCase()) + 1;
                if (!num) {
                    errors.push({
                        line: row + 1,
                        message: this.translate.instant(`Unknown candidate "%s"`).replace(`%s`, cell)
                    });
                    ok = false;
                    break;
                }
                if (ranking.includes(num)) {
                    errors.push({
                        line: row + 1,
                        message: this.translate.instant(`Candidate %s is ranked twice`).replace(`%s`, cell)
                    });
                    ok = false;
                    break;
                }
                ranking.push(num);
            }
            if (!ok || !ranking.length) {
                continue;
            }
            let weight = 1;
            if (weightColumn !== -1) {
                const cell = (cells[weightColumn] ?? `1`).trim();
                const parsed = parseFloat(cell.replace(`,`, `.`));
                if (!Number.isInteger(parsed) || parsed < 1) {
                    errors.push({
                        line: row + 1,
                        message: this.translate.instant(`"%s" is not a valid ballot count`).replace(`%s`, cell)
                    });
                    continue;
                }
                weight = parsed;
            }
            for (let i = 0; i < weight; i++) {
                lines.push(ranking.join(` `));
            }
        }
        return { lines, errors };
    }

    private splitCsvRow(row: string, delimiter: string): string[] {
        const cells: string[] = [];
        let cell = ``;
        let quoted = false;
        for (let i = 0; i < row.length; i++) {
            const char = row[i];
            if (quoted) {
                if (char === `"` && row[i + 1] === `"`) {
                    cell += `"`;
                    i++;
                } else if (char === `"`) {
                    quoted = false;
                } else {
                    cell += char;
                }
            } else if (char === `"`) {
                quoted = true;
            } else if (char === delimiter) {
                cells.push(cell);
                cell = ``;
            } else {
                cell += char;
            }
        }
        cells.push(cell);
        return cells;
    }
}
