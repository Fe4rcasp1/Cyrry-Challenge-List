import { fetchLeaderboard, fetchCreatorLeaderboard } from '../content.js';
import { getLevelRating } from '../ratings.js';
const badge = (id, title, desc, earned) => ({ id, title, desc, earned });
export default {
    data: () => ({ loading: true, player: null, creator: null, rank: null, staffRole: null, error: '' }),
    template: `
      <main class="ccl-hub">
        <section class="hub-head"><router-link to="/hub">← Back to CCL Hub</router-link><h1>{{ displayName }}</h1><div v-if="profileRoles.length" class="profile-role-list"><span v-for="role in profileRoles" :key="role.label" class="profile-role-badge" :class="role.className">{{role.icon}} {{role.label}}</span></div><p>Player profile · based on public CCL records</p></section>
        <p v-if="loading">Loading player profile…</p><p v-else-if="error">{{ error }}</p>
        <template v-else>
          <section class="hub-card"><h2>Statistics</h2><div class="hub-stats">
            <div><strong>{{ player ? player.total : 0 }}</strong><span>Player points</span></div>
            <div><strong>{{ rank ? '#' + rank : '—' }}</strong><span>Player rank</span></div>
            <div><strong>{{ player ? player.completed.length : 0 }}</strong><span>Completions</span></div>
            <div><strong>{{ player ? player.verified.length : 0 }}</strong><span>Verifications</span></div>
            <div><strong>{{ creator ? creator.total : 0 }}</strong><span>Creator points</span></div>
            <div><strong>{{ creator ? creator.created.length : 0 }}</strong><span>Created levels</span></div>
          </div></section>
          <section class="hub-card"><h2>Achievements & Badges</h2><div class="hub-badges"><div v-for="b in badges" :key="b.id" class="hub-badge" :class="{ locked: !b.earned }"><strong>{{ b.earned ? '🏆' : '🔒' }} {{ b.title }}</strong><small>{{ b.desc }}</small></div></div><p class="hub-muted">Badges are calculated from current public list data; they are not permanent awards.</p></section>
          <section v-if="player" class="hub-card"><h2>Completed levels</h2><p v-if="!player.completed.length">No completed records yet.</p><div v-for="item in player.completed" :key="'c'+item.rank" class="hub-change"><strong>#{{ item.rank }} {{ item.level }}</strong><span>+{{ item.score }} points</span></div><h2>Verified levels</h2><div v-for="item in player.verified" :key="'v'+item.rank" class="hub-change"><strong>#{{ item.rank }} {{ item.level }}</strong><span>+{{ item.score }} points</span></div><h2>Progress records</h2><div v-for="item in player.progressed" :key="'p'+item.rank" class="hub-change"><strong>#{{ item.rank }} {{ item.level }}</strong><span>{{ item.percent }}% · +{{ item.score }} points</span></div></section>
          <section v-if="creator" class="hub-card"><h2>Created levels</h2><div v-for="item in creator.created" :key="item.rank" class="hub-change"><strong>#{{ item.rank }} {{ item.level }}</strong><span class="creator-rating" :class="'rating-' + item.rating.toLowerCase()">{{ item.rating }} · +{{ item.score }}</span></div></section>
        </template>
      </main>`,
    computed: {
        displayName() { return this.player?.user || this.creator?.user || this.$route.params.username; },
        profileRoles() {
            const roles = [];
            if (this.staffRole) {
                const label = this.staffRole.charAt(0).toUpperCase() + this.staffRole.slice(1);
                roles.push({label, icon:'🛡️', className:'profile-role-staff profile-role-' + this.staffRole});
            }
            if (this.rank === 1) roles.push({label:'Top 1 Player', icon:'👑', className:'profile-role-first'});
            else if (this.rank !== null && this.rank <= 10) roles.push({label:'Top 10 Player', icon:'🏆', className:'profile-role-top10'});
            return roles;
        },
        profileRoles() {
            const roles = [];
            if (this.staffRole) {
                const label = this.staffRole.charAt(0).toUpperCase() + this.staffRole.slice(1);
                roles.push({label, icon:'🛡️', className:'profile-role-staff profile-role-' + this.staffRole});
            }
            if (this.rank === 1) roles.push({label:'Top 1 Player', icon:'👑', className:'profile-role-first'});
            else if (this.rank !== null && this.rank <= 10) roles.push({label:'Top 10 Player', icon:'🏆', className:'profile-role-top10'});
            return roles;
        },
        badges() {
            const c = this.player?.completed.length || 0, v = this.player?.verified.length || 0, p = this.player?.progressed.length || 0, made = this.creator?.created.length || 0;
            const mythic = this.creator?.created.some(x => x.rating === 'mythic') || false;
            return [badge('first', 'First Clear', 'Complete 1 level', c >= 1), badge('ten', 'Challenge Veteran', 'Complete 10 levels', c >= 10), badge('fifty', 'Challenge Legend', 'Complete 50 levels', c >= 50), badge('verify', 'Verifier', 'Verify 1 level', v >= 1), badge('top10', 'Top 10 Conqueror', 'Complete a Top 10 level', !!this.player?.completed.some(x => x.rank <= 10)), badge('progress', 'Making Progress', 'Submit a progress record', p >= 1), badge('creator', 'Level Creator', 'Create a listed level', made >= 1), badge('mythic', 'Mythic Creator', 'Create a Mythic-rated level', mythic)];
        }
    },
    async mounted() {
        try {
            const [[players], [creators]] = await Promise.all([fetchLeaderboard(), fetchCreatorLeaderboard()]);
            const username = String(this.$route.params.username || '').toLowerCase();
            const index = players.findIndex(x => x.user.toLowerCase() === username);
            this.player = players[index] || null;
            this.rank = index >= 0 ? index + 1 : null;
            this.creator = creators.find(x => x.user.toLowerCase() === username) || null;
            if (!this.player && !this.creator) this.error = 'No public CCL player or creator records found for this username.';
            try {
                const roleResponse = await fetch('/api/profiles/roles?username=' + encodeURIComponent(this.displayName), {cache:'no-store'});
                if (roleResponse.ok) this.staffRole = (await roleResponse.json()).role || null;
            } catch (e) { console.warn('Unable to load staff role',e); }
            try {
                const roleResponse = await fetch('/api/profiles/roles?username=' + encodeURIComponent(this.displayName), {cache:'no-store'});
                if (roleResponse.ok) this.staffRole = (await roleResponse.json()).role || null;
            } catch (e) { console.warn('Unable to load staff role',e); }
        } catch (e) { this.error = 'Unable to load player data right now.'; }
        this.loading = false;
    }
};
