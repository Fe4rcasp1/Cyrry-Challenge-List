/**
 * Numbers of decimal digits to round to
 */
const scale = 3;

/**
 * Manual scoring curve.
 *
 * Each entry is:
 * [rank, points at 100%]
 *
 * The score between anchor points is calculated
 * automatically using smooth interpolation.
 *
 * To adjust the scoring system, edit the values below.
 */
const scoreCurve = [
    [1, 500],
    [10, 385],
    [50, 160],
    [100, 62],
    [125, 33],
    [150, 16],
    [200, 5],
];

/**
 * Calculate the base points for a specific rank.
 *
 * This interpolates between the manually defined
 * score-curve anchor points.
 */
function getBaseScore(rank) {
    // Rank 1 and anything below it use the first value.
    if (rank <= scoreCurve[0][0]) {
        return scoreCurve[0][1];
    }

    // Find the two anchor points surrounding this rank.
    for (let i = 0; i < scoreCurve.length - 1; i++) {
        const [rank1, points1] = scoreCurve[i];
        const [rank2, points2] = scoreCurve[i + 1];

        if (rank <= rank2) {
            const progress = (rank - rank1) / (rank2 - rank1);

            return points1 + (points2 - points1) * progress;
        }
    }

    /*
     * For ranks after the final anchor, continue decreasing
     * based on the slope between the final two anchor points.
     */
    const [lastRank, lastPoints] =
        scoreCurve[scoreCurve.length - 1];

    const [previousRank, previousPoints] =
        scoreCurve[scoreCurve.length - 2];

    const finalSlope =
        (lastPoints - previousPoints) /
        (lastRank - previousRank);

    const points =
        lastPoints + finalSlope * (rank - lastRank);

    return Math.max(points, 0);
}

/**
 * Calculate the score awarded when having a certain
 * percentage on a list level.
 *
 * @param {Number} rank Position on the list
 * @param {Number} percent Percentage of completion
 * @param {Number} minPercent Minimum percentage required
 * @returns {Number}
 */
export function score(rank, percent, minPercent, listType = 'normal') {
    // Platformer has 14 ranked levels: 500 at #1 and 2 at #14.
    // Scale to the current platformer list length rather than using the 200-rank challenge curve.
    const baseScore = listType === 'platformer' ? Math.max(2, 500 * Math.pow(2 / 500, (Math.max(1, rank) - 1) / 13)) : getBaseScore(rank);

    /*
     * Apply the percentage-completion multiplier.
     */
    let score = baseScore *
        ((percent - (minPercent - 1)) /
        (100 - (minPercent - 1)));

    score = Math.max(0, score);

    /*
     * Incomplete levels receive reduced points.
     * 100% completion receives the full calculated score.
     */
    if (percent != 100) {
        return round(score - score / 3);
    }

    return Math.max(round(score), 0);
}

/**
 * Round a number to the configured number of decimal places.
 */
export function round(num) {
    if (!('' + num).includes('e')) {
        return +(Math.round(num + 'e+' + scale) + 'e-' + scale);
    } else {
        var arr = ('' + num).split('e');
        var sig = '';

        if (+arr[1] + scale > 0) {
            sig = '+';
        }

        return +(
            Math.round(
                +arr[0] + 'e' + sig + (+arr[1] + scale)
            ) +
            'e-' +
            scale
        );
    }
}
