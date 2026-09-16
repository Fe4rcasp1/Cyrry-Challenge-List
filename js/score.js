/**
 * Numbers of decimal digits to round to
 */
const scale = 2;

/**
 * Scoring settings
 *
 * maxPoints:
 *     Points awarded to rank #1 at 100%.
 *
 * curve:
 *     Controls how the points decrease by rank.
 *
 *     1.0 = normal linear-style decrease
 *     0.5 = points decrease faster near the top
 *     2.0 = points decrease slower near the top,
 *           then faster toward the bottom
 *
 *     Increase curve to make the top ranks hold more points.
 */
const maxPoints = 250;
const curve = 1.0;

/**
 * Calculate the score awarded for a list level.
 *
 * @param {Number} rank Position on the list
 * @param {Number} percent Percentage of completion
 * @param {Number} minPercent Minimum percentage required
 * @returns {Number}
 */
export function score(rank, percent, minPercent) {
    /*
     * Rank curve:
     *
     * rank 1 = maxPoints
     * Higher ranks receive fewer points.
     *
     * The curve variable can be adjusted manually.
     */
    let baseScore = maxPoints / Math.pow(rank, 0.2 / curve);

    /*
     * Apply completion percentage.
     */
    let score = baseScore *
        ((percent - (minPercent - 1)) / (100 - (minPercent - 1)));

    score = Math.max(0, score);

    /*
     * Incomplete levels receive reduced points.
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
            Math.round(+arr[0] + 'e' + sig + (+arr[1] + scale)) +
            'e-' +
            scale
        );
    }
}
