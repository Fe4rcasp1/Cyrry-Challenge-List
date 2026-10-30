import { round, score } from './score.js';
import { getLevelRating, getImpossibleRating } from './ratings.js';

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
            score: score(rank + 1, 100, level.percentToQualify, listFile === '_platformer.json' ? 'platformer' : 'normal'),
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
                score: score(rank + 1, record.percent, level.percentToQualify, listFile === '_platformer.json' ? 'platformer' : 'normal'),
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
 * Combines normal, platformer, and impossible level creator ratings.
 */
export async function fetchCreatorLeaderboard() {
    const [normal, platformer, impossible, impossiblePlatformer] = await Promise.all([
        fetchList(), fetchList('_platformer.json'),
        fetch('/api/impossible-levels').then(r=>{if(!r.ok)throw Error('Impossible list unavailable');return r.json();}).catch(e=>({levels:[],error:e.message})),
        fetch('/api/impossible-levels?list=platformer').then(r=>{if(!r.ok)throw Error('Impossible platformer unavailable');return r.json();}).catch(e=>({levels:[],error:e.message}))
    ]);
    const creators = new Map(), errors = [];
    const ratingPoints = {rate:1,featured:2,epic:3,legendary:4,mythic:5};
    const sources = [
        {items:(normal||[]).map(([level,error],rank)=>({level,error,rank})),type:'Normal',platformer:false,impossible:false},
        {items:(platformer||[]).map(([level,error],rank)=>({level,error,rank})),type:'Platformer',platformer:true,impossible:false},
        {items:(impossible.levels||[]).map((level,rank)=>({level,rank})),type:'Impossible',platformer:false,impossible:true},
        {items:(impossiblePlatformer.levels||[]).map((level,rank)=>({level,rank})),type:'Impossible Platformer',platformer:true,impossible:true}
    ];
    if(!normal)errors.push('Normal list unavailable');
    if(!platformer)errors.push('Platformer list unavailable');
    if(impossible.error)errors.push(impossible.error);
    if(impossiblePlatformer.error)errors.push(impossiblePlatformer.error);
    for(const source of sources)for(const {level,error,rank} of source.items){
        if(!level){errors.push(error||source.type+' #'+(rank+1));continue;}
        const rating=source.impossible?getImpossibleRating(rank,source.platformer):getLevelRating(level,source.platformer);
        const points=ratingPoints[rating]||0,seen=new Set();
        for(const raw of Array.isArray(level.creators)?level.creators:[]){
            if(typeof raw!=='string')continue;
            const user=raw.trim(),key=user.toLowerCase();
            if(!key||seen.has(key))continue;seen.add(key);
            if(!creators.has(key))creators.set(key,{user,total:0,created:[]});
            const entry=creators.get(key);
            entry.total+=points;
            entry.created.push({rank:rank+1,level:level.name,score:points,rating:rating||'Unrated',listType:source.type,link:level.verification||''});
        }
    }
    return [[...creators.values()].sort((a,b)=>b.total-a.total||a.user.localeCompare(b.user)),errors];
}
