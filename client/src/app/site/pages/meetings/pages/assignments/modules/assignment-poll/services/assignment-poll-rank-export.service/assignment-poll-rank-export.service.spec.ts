import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { PollType } from 'src/app/domain/models/poll';
import { FileExportService } from 'src/app/gateways/export/file-export.service';

import { AssignmentPollRankExportService } from './assignment-poll-rank-export.service';

function mockUser(name: string, structureLevel: string): object {
    return {
        getShortName: (): string => name,
        structure_level: (): string => structureLevel
    };
}

/**
 * A structural stand-in for a ViewPoll<ViewAssignment> of a rank poll with
 * two candidates and three ballots (Bob ranks 11>10, Alice ranks 10, Carol
 * abstains).
 */
function mockPoll(overrides: object = {}): any {
    return {
        id: 1,
        title: `Test poll`,
        meeting_id: 1,
        meeting: { name: `Test meeting` },
        pollmethod: `rank`,
        type: PollType.Named,
        is_pseudoanonymized: false,
        state: `published`,
        content_object: { open_posts: 1 },
        options: [
            { id: 10, getOptionTitle: (): object => ({ title: `Anna Candidate` }) },
            { id: 11, getOptionTitle: (): object => ({ title: `Otto Candidate` }) }
        ],
        global_option: {
            votes: [
                { weight: 1, value: `{"11":1,"10":2}`, user: mockUser(`Bob`, `East Chapter`) },
                { weight: 1, value: `{"10":1}`, user: mockUser(`Alice`, `West Chapter`) },
                { weight: 1, value: `A`, user: mockUser(`Carol`, ``) }
            ]
        },
        rank_result: {
            version: 1,
            algorithm: `meek-nz`,
            quota_rule: `droop`,
            seats: 1,
            candidates: [10, 11],
            elected: [11]
        },
        ...overrides
    };
}

describe(`AssignmentPollRankExportService`, () => {
    let service: AssignmentPollRankExportService;
    let savedFiles: { content: string; filename: string }[];

    beforeEach(() => {
        savedFiles = [];
        TestBed.configureTestingModule({
            providers: [
                AssignmentPollRankExportService,
                {
                    provide: FileExportService,
                    useValue: {
                        saveFile: (content: string, filename: string): void => {
                            savedFiles.push({ content, filename });
                        }
                    }
                },
                { provide: TranslateService, useValue: { instant: (key: string): string => key } }
            ]
        });
        service = TestBed.inject(AssignmentPollRankExportService);
    });

    it(`exports CSV with voter and structure level for named polls`, () => {
        service.exportCsv(mockPoll());
        const lines = savedFiles[0].content.trim().split(`\r\n`);
        expect(lines[0]).toBe(`ballot,voter,structure_level,weight,choice_1,choice_2`);
        // Ballots are sorted by voter name; Carol's abstain row comes last.
        expect(lines[1]).toBe(`1,Alice,West Chapter,1,Anna Candidate,`);
        expect(lines[2]).toBe(`2,Bob,East Chapter,1,Otto Candidate,Anna Candidate`);
        expect(lines[3]).toBe(`3,Carol,,1,,`);
    });

    it(`exports CSV without voter columns for anonymized polls`, () => {
        service.exportCsv(mockPoll({ is_pseudoanonymized: true }));
        const lines = savedFiles[0].content.trim().split(`\r\n`);
        expect(lines[0]).toBe(`ballot,weight,choice_1,choice_2`);
        expect(lines.every(line => !line.includes(`Chapter`))).toBeTrue();
    });

    it(`exports CSV without voter columns for pseudoanonymous polls`, () => {
        service.exportCsv(mockPoll({ type: PollType.Pseudoanonymous }));
        const lines = savedFiles[0].content.trim().split(`\r\n`);
        expect(lines[0]).toBe(`ballot,weight,choice_1,choice_2`);
    });

    it(`exports JSON with voter objects for named polls`, () => {
        service.exportJson(mockPoll());
        const data = JSON.parse(savedFiles[0].content);
        expect(data.ballots.length).toBe(3);
        expect(data.ballots[0].voter).toEqual({ name: `Alice`, structure_level: `West Chapter` });
        expect(data.ballots[1].voter).toEqual({ name: `Bob`, structure_level: `East Chapter` });
        expect(data.ballots[2]).toEqual({ weight: 1, abstain: true, voter: { name: `Carol`, structure_level: `` } });
    });

    it(`exports JSON without voter objects for anonymized polls`, () => {
        service.exportJson(mockPoll({ is_pseudoanonymized: true }));
        const data = JSON.parse(savedFiles[0].content);
        expect(data.ballots.every((ballot: object) => !(`voter` in ballot))).toBeTrue();
    });

    it(`exports BLT without voter names`, () => {
        service.exportBlt(mockPoll());
        const lines = savedFiles[0].content.trim().split(`\n`);
        expect(lines[0]).toBe(`2 1`);
        expect(lines).toContain(`1 2 1 0`);
        expect(lines).toContain(`1 1 0`);
        expect(savedFiles[0].content).not.toContain(`Bob`);
        expect(savedFiles[0].content).not.toContain(`Chapter`);
    });
});
