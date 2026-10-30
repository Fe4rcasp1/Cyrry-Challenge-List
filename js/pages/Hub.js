import { fetchList, fetchLeaderboard, fetchCreatorLeaderboard } from '../content.js';
import { getFavorites } from '../favorites.js';
import { getLevelRating } from '../ratings.js';
const links = [
    { name: 'Challenge List', url: '/#/', note: 'Normal CCL' },
    { name: 'Platformer List', url: '/#/platformer', note: 'Normal platformer' },
    { name: 'Impossible CCL', url: 'https://cclimpossible.ccllcc.workers.dev/#/', note: 'Impossible challenges' },
    { name: 'Impossible Platformer', url: 'https://cclimpossible.ccllcc.workers.dev/#/platformer', note: 'Impossible platformer' }
];
export default {
    data: () => ({ loading: true, players: [], creators: [], platformerPlayers: [], platformerCreators: [], levels: [], platformers: [], favorites: [], query: '' }),
    template: `
    <main class="ccl-hub">
      <section class="hub-head"><h1>CCL Hub</h1><p>Explore the lists, discover players, track achievements, and revisit favorite levels.</p></section>
      <section class="hub-card"><h2>Switch lists</h2><div class="hub-links"><a v-for="link in links" :key="link.url" :href="link.url"><strong>{{ link.name }} ↗</strong><small>{{ link.note }}</small></a></div></section>
      <p v-if="loading">Loading CCL statistics…</p>
      <template v-else>
        <section class="hub-card"><h2>Statistics Dashboard</h2><div class="hub-stats">
          <div><strong>{{ levels.length }}</strong><span>Challenge levels</span></div><div><strong>{{ platformers.length }}</strong><span>Platformer levels</span></div>
          <div><strong>{{ players.length }}</strong><span>Ranked players</span></div><div><strong>{{ creators.length }}</strong><span>Level creators (combined)</span></div>
          <div><strong>{{platformerPlayers.length}}</strong><span>Platformer ranked players</span></div>
          <div><strong>{{platformerCreators.length}}</strong><span>Platformer creators</span></div>
          <div><strong>{{platformerRecords}}</strong><span>Platformer records</span></div>
          <div><strong>{{ totalRecords }}</strong><span>Submitted records</span></div>
        </div><p class="hub-muted">Player statistics include classic and platformer lists. Creator totals include impossible lists when available.</p></section>
        <section class="hub-card"><h2>Player Profiles & Achievements</h2><input v-model="query" type="search" class="hub-search" placeholder="Search players…" aria-label="Search players" /><div class="hub-player-grid"><router-link v-for="player in matchingPlayers" :key="player.user" :to="'/player/' + encodeURIComponent(player.user)" class="hub-player"><strong>{{ player.user }}</strong><span>{{ player.creatorOnly ? player.total + ' creator points' : player.total + ' points · ' + player.completed.length + ' completions' }}</span></router-link></div><p v-if="!matchingPlayers.length">No players found.</p></section>
        <section class="hub-card"><h2>Favorite Levels ({{ favorites.length }})</h2><p class="hub-muted">Saved only in this browser.</p><p v-if="!favorites.length">No favorites yet. Use the ☆ button on a level to save it.</p><div class="hub-favorites"><a v-for="fav in favorites" :key="fav.id + ':' + fav.platformer" :href="(fav.platformer ? '/#/platformer' : '/#/') + '?level=' + encodeURIComponent(fav.id)"><strong>★ {{ fav.name }}</strong><span>{{ fav.platformer ? 'Platformer' : 'Challenge' }} · ID {{ fav.id }}</span></a></div></section>
        <section class="hub-card"><h2>List Changelog</h2><p class="hub-muted">Documented changes only. Historical rank movements are not inferred.</p><div v-for="change in changes" :key="change.date + change.title" class="hub-change"><time>{{ change.date }}</time><strong>{{ change.title }}</strong><p>{{ change.description }}</p></div></section>
      </template>
    </main>`,
    computed: {
        links() { return links; },
        platformerRecords(){return this.platformers.reduce((n,l)=>n+(l.records?.length||0),0);},
        totalRecords() { return [...this.levels, ...this.platformers].reduce((n, level) => n + (level.records?.length || 0), 0); },
        matchingPlayers() { const q = this.query.trim().toLowerCase(); const seen = new Set(); return [...this.players, ...this.creators.map(c => ({ ...c, completed: [], total: c.total, creatorOnly: true }))].filter(p => { const key = p.user.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return key.includes(q); }).slice(0, 80); },
        changes() { return [{ date: '2026-10-20', title: 'CCL Hub launched', description: 'Added player profiles, achievements, statistics, favorites, and a unified list switcher.' }]; }
    },
    async mounted() {
        try {
            const [normal, platformer, leaderboard, creators, platformerLeaderboard] = await Promise.all([fetchList(), fetchList('_platformer.json'), fetchLeaderboard(), fetchCreatorLeaderboard(), fetchLeaderboard('_platformer.json')]);
            this.levels = (normal || []).map(x => x[0]).filter(Boolean);
            this.platformers = (platformer || []).map(x => x[0]).filter(Boolean);
            this.players = leaderboard[0] || [];
            this.creators = creators[0] || [];
            this.platformerPlayers=platformerLeaderboard[0]||[];
            this.platformerCreators=[...new Set(this.platformers.flatMap(l=>l.creators||[]).map(n=>String(n).toLowerCase()))];
        } catch (e) { console.error('Hub data unavailable', e); }
        this.favorites = getFavorites();
        this.loading = false;
    }
};
