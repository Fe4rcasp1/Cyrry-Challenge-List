import { fetchLeaderboard, fetchCreatorLeaderboard } from '../content.js';
import { localize } from '../util.js';

import Spinner from '../components/Spinner.js';

export default {
    components: {
        Spinner,
    },
    data: () => ({
        leaderboard: [],
        pointsLeaderboard: [],
        creatorLeaderboard: [],
        leaderboardType: "points",
        pointsErrors: [],
        creatorErrors: [],
        searchQuery: "",
        loading: true,
        selected: 0,
        err: [],
    }),
    template: `
        <main v-if="loading">
            <Spinner></Spinner>
        </main>
        <main v-else class="page-leaderboard-container">
            <div class="page-leaderboard">
                <div class="leaderboard-switcher" role="group" aria-label="Leaderboard type">
                    <button type="button" :class="{ active: leaderboardType === 'points' }" @click="switchLeaderboard('points')">Points Leaderboard</button>
                    <button type="button" :class="{ active: leaderboardType === 'creators' }" @click="switchLeaderboard('creators')">Creator Points</button>
                </div>
                <div class="error-container">
                    <p class="error" v-if="err.length > 0">
                        Leaderboard may be incorrect, as the following levels could not be loaded: {{ err.join(', ') }}
                    </p>
                </div>
                <div class="board-container">
                    <div class="search-panel">
                        <label for="player-search">Search {{ leaderboardType === "creators" ? "creators" : "players" }}</label>
                        <input id="player-search" class="list-search" type="search" v-model="searchQuery" placeholder="Search by username…" autocomplete="off" />
                        <p class="search-count">{{ filteredPlayers.length }} of {{ leaderboard.length }} {{ leaderboardType === "creators" ? "creators" : "players" }}</p>
                    </div>
                    <p v-if="leaderboard.length && !filteredPlayers.length" class="search-empty">No usernames found.</p>
                    <table class="board">
                        <tr v-for="player in filteredPlayers" :key="player.index">
                            <td class="rank">
                                <p class="type-label-lg">#{{ player.index + 1 }}</p>
                            </td>
                            <td class="total">
                                <p class="type-label-lg">{{ leaderboardType === "creators" ? player.entry.total : localize(player.entry.total) }}</p>
                            </td>
                            <td class="user" :class="{ 'active': selected == player.index }">
                                <button @click="selected = player.index">
                                    <span class="type-label-lg">{{ player.entry.user }}</span>
                                </button>
                            </td>
                        </tr>
                    </table>
                </div>
                <div class="player-container">
                    <div class="player" v-if="entry">
                        <h1>#{{ selected + 1 }} {{ entry.user }}</h1>
                        <h3>{{ leaderboardType === "creators" ? entry.total + " Creator Points" : localize(entry.total) + " Points" }}</h3>
                        <template v-if="leaderboardType === 'creators'">
                            <h2>Created Levels ({{ entry.created.length }})</h2>
                            <table class="table">
                                <tr v-for="created in entry.created" :key="created.rank">
                                    <td class="rank"><p>#{{ created.rank }}</p></td>
                                    <td class="level"><a v-if="created.link" class="type-label-lg" :href="created.link" target="_blank" rel="noopener noreferrer">{{ created.level }}</a><p v-else>{{ created.level }}</p><span class="creator-rating" :class="`rating-${created.rating.toLowerCase()}`">{{ ratingLabel(created.rating) }}</span></td>
                                    <td class="score"><p>+{{ created.score }}</p></td>
                                </tr>
                            </table>
                        </template>
                        <template v-else>
                        <h2 v-if="entry.verified.length > 0">Verified ({{ entry.verified.length}})</h2>
                        <table class="table">
                            <tr v-for="score in entry.verified">
                                <td class="rank">
                                    <p>#{{ score.rank }}</p>
                                </td>
                                <td class="level">
                                    <a class="type-label-lg" target="_blank" :href="score.link">{{ score.level }}</a>
                                </td>
                                <td class="score">
                                    <p>+{{ localize(score.score) }}</p>
                                </td>
                            </tr>
                        </table>
                        <h2 v-if="entry.completed.length > 0">Completed ({{ entry.completed.length }})</h2>
                        <table class="table">
                            <tr v-for="score in entry.completed">
                                <td class="rank">
                                    <p>#{{ score.rank }}</p>
                                </td>
                                <td class="level">
                                    <a class="type-label-lg" target="_blank" :href="score.link">{{ score.level }}</a>
                                </td>
                                <td class="score">
                                    <p>+{{ localize(score.score) }}</p>
                                </td>
                            </tr>
                        </table>
                        <h2 v-if="entry.progressed.length > 0">Progressed ({{entry.progressed.length}})</h2>
                        <table class="table">
                            <tr v-for="score in entry.progressed">
                                <td class="rank">
                                    <p>#{{ score.rank }}</p>
                                </td>
                                <td class="level">
                                    <a class="type-label-lg" target="_blank" :href="score.link">{{ score.percent }}% {{ score.level }}</a>
                                </td>
                                <td class="score">
                                    <p>+{{ localize(score.score) }}</p>
                                </td>
                            </tr>
                        </table>
                        </template>
                    </div>
                </div>
            </div>
        </main>
    `,
    computed: {
        filteredPlayers() {
            const query = this.searchQuery.trim().toLocaleLowerCase();
            return this.leaderboard.map((entry, index) => ({ entry, index })).filter(({ entry }) => !query || entry.user.toLocaleLowerCase().includes(query));
        },
        entry() {
            return this.leaderboard[this.selected];
        },
    },
    async mounted() {
        const [[points, pointsErrors], [creators, creatorErrors]] = await Promise.all([
            fetchLeaderboard(), fetchCreatorLeaderboard(),
        ]);
        this.pointsLeaderboard = points;
        this.creatorLeaderboard = creators;
        this.pointsErrors = pointsErrors;
        this.creatorErrors = creatorErrors;
        this.leaderboard = points;
        this.err = pointsErrors;
        // Hide loading spinner
        this.loading = false;
    },
    methods: {
        localize,
        ratingLabel(rating) { return rating.charAt(0).toUpperCase() + rating.slice(1); },
        switchLeaderboard(type) {
            if (this.leaderboardType === type) return;
            this.leaderboardType = type;
            this.leaderboard = type === "creators" ? this.creatorLeaderboard : this.pointsLeaderboard;
            this.err = type === "creators" ? this.creatorErrors : this.pointsErrors;
            this.selected = 0;
            this.searchQuery = "";
        },
    },
};
