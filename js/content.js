import { round, score } from './score.js';
import { getLevelRating } from './ratings.js';

/**
 * Path to directory containing `_list.json` and all levels
 */
const dir = '/data';

export async function fetchList(listFile = '_list.json') {
    const listResult = await fetch(`${dir}/${listFile}`);
    const type = listFile === '_platformer.json' ? 'platformer' : 'normal';
    let overrides = {};
    try { const res = await fetch('/api/levels/overrides?list=' + type, {cache:'no-store'}); if (res.ok) overrides = (await res.json()).levels || {}; } catch(e) { console.warn('Level overrides unavailable', e); }
    try {
        const list = await listResult.json();
        return await Promise.all(
            list.map(async (path, rank) => {
                const levelResult = overrides[path] ? null : await fetch(`${dir}/${path}.json`);
                try {
                    const level = overrides[path] || await levelResult.json();
                    return [
                        {
                            ...level,
                            path,
                            records: level.records.sort(
                                (a, b) => b.percent - a.percent,
                            ),
                        },
                        null,
                    ];
                } catch {
                    console.error(`Failed to load level #${rank + 1} ${path}.`);
                    return [null, path];
                }
            }),
        );
    } catch {
        console.error(`Failed to load list.`);
        return null;
    }
}

export async function fetchEditors() {
    try {
        const editorsResults = await fetch(`${dir}/_editors.json`);
        const editors = await editorsResults.json();
        return editors;
    } catch {
        return null;
    }
}

export async function fetchLeaderboard(listFile = "_list.json") {
    const list = await fetchList(listFile);
    if (!list) return [[], ["Failed to load the level list."]];

    const scoreMap = {};
    const errs = [];
    list.forEach(([level, err], rank) => {
        if (err) {
            errs.push(err);
            return;
        }

        // Verification
        const verifier = Object.keys(scoreMap).find(
            (u) => u.toLowerCase() === level.verifier.toLowerCase(),
        ) || level.verifier;
        scoreMap[verifier] ??= {
            verified: [],
            completed: [],
            progressed: [],
        };
        const { verified } = scoreMap[verifier];
        verified.push({
            rank: rank + 1,
            level: level.name,
            score: score(rank + 1, 100, level.percentToQualify),
            link: level.verification,
        });

        // Records
        level.records.forEach((record) => {
            const user = Object.keys(scoreMap).find(
                (u) => u.toLowerCase() === record.user.toLowerCase(),
            ) || record.user;
            scoreMap[user] ??= {
                verified: [],
                completed: [],
                progressed: [],
            };
            const { completed, progressed } = scoreMap[user];
            if (record.percent === 100) {
                completed.push({
                    rank: rank + 1,
                    level: level.name,
                    score: score(rank + 1, 100, level.percentToQualify),
                    link: record.link,
                });
                return;
            }

            progressed.push({
                rank: rank + 1,
                level: level.name,
                percent: record.percent,
                score: score(rank + 1, record.percent, level.percentToQualify),
                link: record.link,
            });
        });
    });

    // Wrap in extra Object containing the user and total score
    const res = Object.entries(scoreMap).map(([user, scores]) => {
        const { verified, completed, progressed } = scores;
        const total = [verified, completed, progressed]
            .flat()
            .reduce((prev, cur) => prev + cur.score, 0);

        return {
            user,
            total: round(total),
            ...scores,
        };
    });

    // Sort by total score
    return [res.sort((a, b) => b.total - a.total), errs];
}

/**
 * Creator leaderboard: creators earn 1–5 points per level based on its rating.
 * Uses the normal CCL level list, keeping it independent of platformer rankings.
 */
export async function fetchCreatorLeaderboard() {
    const list = await fetchList();
    if (!list) return [[], ['Failed to load the level list.']];
    const creators = new Map();
    const errors = [];
    list.forEach(([level, err], rank) => {
        if (!level) {
            errors.push(err || `Level #${rank + 1}`);
            return;
        }
        const rating = getLevelRating(level);
        const ratingPoints = { rate: 1, featured: 2, epic: 3, legendary: 4, mythic: 5 };
        const points = ratingPoints[rating] ?? 0;
        const seen = new Set();
        for (const raw of Array.isArray(level.creators) ? level.creators : []) {
            if (typeof raw !== 'string') continue;
            const user = raw.trim();
            const key = user.toLocaleLowerCase();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            if (!creators.has(key)) creators.set(key, { user, total: 0, created: [] });
            const entry = creators.get(key);
            entry.total += points;
            entry.created.push({
                rank: rank + 1,
                level: level.name,
                score: points,
                rating: rating || "Unrated",
                link: level.verification || '',
            });
        }
    });
    return [[...creators.values()].sort((a, b) => b.total - a.total || a.user.localeCompare(b.user)), errors];
}
