import { Id } from '../../definitions/key-types';

/**
 * A single counting round of a rank (STV) poll as written by the backend
 * counter into `poll.rank_result.rounds`. All decimals are serialized as
 * strings by the backend.
 */
export interface PollRankResultRound {
    number: number;
    /** Null only for the Borda count, which has no quota. */
    quota: string | null;
    /** option id -> vote total; may omit candidates (e.g. already excluded ones) */
    votes: Record<string, string>;
    exhausted: string;
    /** option id -> keep factor */
    keep_factors: Record<string, string>;
    /** option ids elected in this round, in order of election */
    elected: Id[];
    /** option id excluded in this round, if any */
    excluded: Id | null;
    tie_break: { among: Id[]; chosen: Id } | null;
}

/**
 * The result of counting a rank (STV) poll, written by the backend to
 * `poll.rank_result` when the poll is stopped. If counting failed, only
 * `version` and `error` are present.
 */
export interface PollRankResult {
    version: number;
    /** Set instead of the result fields if the backend counter failed. */
    error?: string;
    /** `meek-nz`, `scottish-stv` or `borda` (see `PollRankAlgorithm`). */
    algorithm?: string;
    /**
     * The quota rule used for counting. Always present in the success
     * variant: `droop` or `hare` for the STV algorithms, null for the Borda
     * count (which has no quota).
     */
    quota_rule?: `droop` | `hare` | null;
    seats?: number;
    seed?: number;
    /** All option ids in ballot-paper order (used for BLT candidate indexing). */
    candidates?: Id[];
    /** Elected option ids in order of election. */
    elected?: Id[];
    /** Null only for the Borda count, which has no quota. */
    quota_final?: string | null;
    ballot_count?: number;
    abstain_weight?: string;
    exhausted_final?: string;
    rounds?: PollRankResultRound[];
}

/**
 * Parses the raw `value` of a vote record of a rank poll. Ranked ballots are
 * stored as compact JSON strings mapping option id to rank, e.g.
 * `{"12":1,"15":2}`; abstentions are stored as the plain string `"A"`.
 *
 * @returns the ranked option ids ordered by rank (most preferred first) or
 *          `null` if the value is not a ranking (e.g. a global abstain).
 */
export function parseRankVoteValue(value: unknown): Id[] | null {
    if (typeof value !== `string` || !value.trim().startsWith(`{`)) {
        return null;
    }
    try {
        const parsed = JSON.parse(value);
        if (!parsed || typeof parsed !== `object` || Array.isArray(parsed)) {
            return null;
        }
        return Object.entries(parsed)
            .map(([optionId, rank]) => [Number(optionId), Number(rank)])
            .sort((a, b) => a[1] - b[1])
            .map(([optionId]) => optionId);
    } catch {
        return null;
    }
}
