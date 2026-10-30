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
        platformerLeaderboard: [],
        platformerErrors: [],
        metric: "points", snapshotBusy:false, snapshotMessage:"",
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
                    <button type="button" :class="{ active: leaderboardType === 'platformer' }" @click="switchLeaderboard('platformer')">Platformer Leaderboard</button>
                </div>
                <div class="leaderboard-metrics" v-if="leaderboardType!=='creators'">
                  <label>Rank by <select v-model="metric" @change="applyMetric">
                    <option value="points">Total points</option><option value="completed">Completions</option>
                    <option value="verified">Verifications</option><option v-if="leaderboardType !== 'platformer'" value="progressed">Progress records</option>
                    <option value="hardest">Hardest clear</option><option value="top10">Top 10 clears</option>
                  </select></label>
                  <button v-if="isStaff && leaderboardType === 'points'" :disabled="snapshotBusy" @click="saveSnapshot">Save ranking snapshot</button>
                </div><p v-if="snapshotMessage" class="search-count">{{snapshotMessage}}</p>
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
                                <p class="type-label-lg">{{ leaderboardType === "creators" || metric === "points" ? localize(player.entry.total) : metricValue(player.entry) }}</p>
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
                        <router-link class="hub-profile-link" :to="'/player/' + encodeURIComponent(entry.user)">View Profile & Achievements →</router-link>
                        <h3>{{ leaderboardType === "creators" ? entry.total + " Creator Points" : localize(entry.total) + " Points" }}</h3>
                        <template v-if="leaderboardType === 'creators'">
                            <h2>Created Levels ({{ entry.created.length }})</h2>
                            <table class="table">
                                <tr v-for="created in entry.created" :key="created.rank">
                                    <td class="rank"><p>#{{ created.rank }}</p></td>
                                    <td class="level"><div class="creator-level-line"><a v-if="created.link" class="type-label-lg" :href="created.link" target="_blank" rel="noopener noreferrer">{{ created.level }} <small v-if="created.listType">({{created.listType}})</small></a><span v-else class="type-label-lg">{{ created.level }}</span><span v-if="created.rating" class="creator-rating" :class="'rating-' + created.rating.toLowerCase()">{{ ratingLabel(created.rating) }}</span></div></td>
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
        isStaff(){return ['owner','admin'].includes(this.$root.store?.role);},
        filteredPlayers() {
            const query = this.searchQuery.trim().toLocaleLowerCase();
            return this.leaderboard.map((entry, index) => ({ entry, index })).filter(({ entry }) => !query || entry.user.toLocaleLowerCase().includes(query));
        },
        entry() {
            return this.leaderboard[this.selected];
        },
    },
    async mounted() {
        const [[points, pointsErrors], [creators, creatorErrors], [platformer, platformerErrors]] = await Promise.all([
            fetchLeaderboard(), fetchCreatorLeaderboard(), fetchLeaderboard("_platformer.json"),
        ]);
        this.pointsLeaderboard = points;
        this.creatorLeaderboard = creators;
        this.platformerLeaderboard = platformer;
        this.platformerErrors = platformerErrors;
        this.pointsErrors = pointsErrors;
        this.creatorErrors = creatorErrors;
        this.leaderboard = points;
        this.err = pointsErrors;
        // Hide loading spinner
        this.loading = false;
    },
    methods: {
        localize,
        metricValue(entry) {
            const clears=[...entry.completed,...entry.verified];
            if(this.metric==='completed')return entry.completed.length;
            if(this.metric==='verified')return entry.verified.length;
            if(this.metric==='progressed')return entry.progressed.length;
            if(this.metric==='top10')return clears.filter(x=>x.rank<=10).length;
            if(this.metric==='hardest')return clears.length?'#'+Math.min(...clears.map(x=>x.rank)):'—';
            return entry.total;
        },
        applyMetric(){
            const value=e=>{
                if(this.metric==='completed')return e.completed.length;
                if(this.metric==='verified')return e.verified.length;
                if(this.metric==='progressed')return e.progressed.length;
                const clears=[...e.completed,...e.verified];
                if(this.metric==='top10')return clears.filter(x=>x.rank<=10).length;
                if(this.metric==='hardest')return clears.length?-Math.min(...clears.map(x=>x.rank)):-Infinity;
                return e.total;
            };
            this.leaderboard=[...(this.leaderboardType === "platformer" ? this.platformerLeaderboard : this.pointsLeaderboard)].sort((a,b)=>value(b)-value(a)||b.total-a.total||a.user.localeCompare(b.user));
            this.selected=0;
        },
        async saveSnapshot(){
            if(this.metric!=='points' || this.leaderboardType!=='points'){this.snapshotMessage='Switch to the regular Points Leaderboard and Total points first.';return;}
            this.snapshotBusy=true;this.snapshotMessage='';
            try{
                const res=await fetch('/api/admin/rankings/snapshot',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({entries:this.pointsLeaderboard.slice(0,1000).map((p,i)=>({user:p.user,points:p.total,rank:i+1}))})});
                const data=await res.json();if(!res.ok)throw new Error(data.error||'Snapshot failed');
                this.snapshotMessage='Saved '+data.count+' rankings for today.';
            }catch(e){this.snapshotMessage=e.message}finally{this.snapshotBusy=false;}
        },
        ratingLabel(rating) { return rating.charAt(0).toUpperCase() + rating.slice(1); },
        switchLeaderboard(type) {
            if (this.leaderboardType === type) return;
            this.leaderboardType = type;
            this.leaderboard = type === "creators" ? this.creatorLeaderboard : type === "platformer" ? this.platformerLeaderboard : this.pointsLeaderboard;
            if(type==='platformer'&&this.metric==='progressed')this.metric='points';
            if(type!=="creators")this.applyMetric();
            this.err = type === "creators" ? this.creatorErrors : type === "platformer" ? this.platformerErrors : this.pointsErrors;
            this.selected = 0;
            this.searchQuery = "";
        },
    },
};
