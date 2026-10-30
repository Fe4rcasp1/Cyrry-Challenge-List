import { fetchLeaderboard, fetchCreatorLeaderboard } from '../content.js';
import { getLevelRating } from '../ratings.js';
import { store } from '../main.js';
const badge = (id, title, desc, earned) => ({ id, title, desc, earned });
export default {
    data: () => ({ loading: true, player: null, platformerPlayer:null, platformerRank:null, creator: null, rank: null, staffRole: null, clan: null, achievementFilter: 'all', customProfile: null, history: [], advancedStats:null, recentRecords:[], error: '' }),
    template: `
      <main class="ccl-hub">
        <section class="hub-head profile-custom-head" :style="customProfile ? {borderColor:customProfile.accent} : {}">
          <div v-if="customProfile?.banner_url" class="profile-banner" :style="{backgroundImage:'url(' + customProfile.banner_url + ')'}"></div>
          <div class="profile-header-content" :style="customProfile?.background_url ? {backgroundImage:'linear-gradient(#0a1421d9,#0a1421e8),url('+customProfile.background_url+')',backgroundSize:'cover',backgroundPosition:'center'} : {}">
            <div class="profile-header-actions">
              <router-link to="/hub" class="profile-back-link">← Back to CCL Hub</router-link>
              <router-link v-if="canEditProfile" to="/account" class="profile-settings-link" aria-label="Profile settings" title="Edit profile settings">
                <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.9 1.9-.06-.06A1.7 1.7 0 0 0 16 18.4a1.7 1.7 0 0 0-1 1.56V20h-2.7v-.04A1.7 1.7 0 0 0 11.3 18.4a1.7 1.7 0 0 0-1.88.34l-.06.06-1.9-1.9.06-.06A1.7 1.7 0 0 0 7.86 15a1.7 1.7 0 0 0-1.56-1H6.2v-2.7h.1A1.7 1.7 0 0 0 7.86 10a1.7 1.7 0 0 0-.34-1.88l-.06-.06 1.9-1.9.06.06A1.7 1.7 0 0 0 11.3 6.56a1.7 1.7 0 0 0 1-1.56V5h2.7v.04A1.7 1.7 0 0 0 16 6.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 1.9 1.9-.06.06A1.7 1.7 0 0 0 19.4 10a1.7 1.7 0 0 0 1.56 1h.04v2.7h-.04A1.7 1.7 0 0 0 19.4 15Z"/></svg>
              </router-link>
            </div>
            <img v-if="customProfile?.avatar_url" class="profile-avatar" :src="customProfile.avatar_url" alt="Player avatar" referrerpolicy="no-referrer" />
            <h1><router-link v-if="clan" to="/teams" class="profile-clan-tag" :title="'Clan: '+clan.name">[{{clan.tag}}]</router-link> {{ displayName }}</h1>
            <router-link v-if="clan" to="/teams" class="profile-clan-name">⚔️ {{clan.name}} · Clan member</router-link>
            <div v-if="profileRoles.length" class="profile-role-list"><span v-for="role in profileRoles" :key="role.label" class="profile-role-badge" :class="role.className">{{role.icon}} {{role.label}}</span></div>
            <p>Player profile · based on public CCL records</p>
            <p v-if="customProfile?.bio" class="profile-bio">{{customProfile.bio}}</p><div class="profile-showcase"><span v-if="customProfile?.favorite_level">♥ Favorite: {{customProfile.favorite_level.replaceAll('_',' ')}}</span></div>
          </div>
        </section>
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
          <section class="hub-card"><h2>Platformer Statistics</h2><div class="hub-stats">
            <div><strong>{{platformerPlayer?.total || 0}}</strong><span>Platformer points</span></div>
            <div><strong>{{platformerRank ? '#'+platformerRank : '—'}}</strong><span>Platformer rank</span></div>
            <div><strong>{{platformerPlayer?.completed.length || 0}}</strong><span>Platformer completions</span></div>
            <div><strong>{{platformerPlayer?.verified.length || 0}}</strong><span>Platformer verifications</span></div>
          </div><h3>Platformer records</h3><p v-if="!platformerPlayer">No platformer records yet.</p><template v-else>
            <div v-for="item in platformerPlayer.completed" :key="'pc'+item.rank" class="hub-change"><strong>#{{item.rank}} {{item.level}}</strong><span>+{{item.score}} points</span></div>
            <div v-for="item in platformerPlayer.verified" :key="'pv'+item.rank" class="hub-change"><strong>#{{item.rank}} {{item.level}} · Verification</strong><span>+{{item.score}} points</span></div>
          </template></section>
          <section class="hub-card"><h2>Advanced statistics</h2><div class="hub-stats"><div><strong>{{hardestRank}}</strong><span>Hardest clear</span></div><div><strong>{{player ? player.progressed.length : 0}}</strong><span>Progress records</span></div><div><strong>{{advancedStats?.approved_records ?? '—'}}</strong><span>Approved submissions</span></div><div><strong>{{advancedStats?.average_enjoyment ?? '—'}}</strong><span>Average enjoyment / 10</span></div></div><h3>Recent approved records</h3><p v-if="!recentRecords.length">No approved on-site submissions yet.</p><div v-for="r in recentRecords" :key="r.level_path+r.reviewed_at" class="hub-change"><strong>{{r.level_path.replaceAll('_',' ')}} · {{r.percent}}%</strong><span>{{r.enjoyment}}/10 enjoyment</span></div></section>
          <section class="hub-card"><h2>Ranking history</h2>
            <p class="hub-muted">Snapshots start when staff save them. Historical rankings before the first snapshot are not available.</p>
            <p v-if="!history.length">No snapshots saved for this player yet.</p>
            <div v-else class="profile-history">
              <div v-for="(h,i) in history" :key="i" class="hub-change"><strong>{{h.captured_at}}</strong><span>#{{h.rank}} · {{h.points}} points</span></div>
            </div>
          </section>
          <section class="hub-card"><div class="admin-section-head"><h2>Achievements & Badges</h2><span class="admin-subtle-pill">{{earnedCount}} / {{badges.length}} unlocked</span></div><div class="profile-achievement-progress"><div :style="{width:achievementPercent + '%'}"></div></div><div class="profile-achievement-controls"><button type="button" :class="{active:achievementFilter==='all'}" @click="achievementFilter='all'">All</button><button type="button" :class="{active:achievementFilter==='earned'}" @click="achievementFilter='earned'">Unlocked</button><button type="button" :class="{active:achievementFilter==='locked'}" @click="achievementFilter='locked'">Locked</button></div><div class="hub-badges"><div v-for="b in filteredBadges" :key="b.id" class="hub-badge" :class="{ locked: !b.earned }"><strong>{{ b.earned ? '🏆' : '🔒' }} {{ b.title }}</strong><small>{{ b.desc }}</small></div></div><p class="hub-muted">Badges are calculated from current public list data; they are not permanent awards.</p></section>
          <section v-if="player" class="hub-card"><h2>Completed levels</h2><p v-if="!player.completed.length">No completed records yet.</p><div v-for="item in player.completed" :key="'c'+item.rank" class="hub-change"><strong>#{{ item.rank }} {{ item.level }}</strong><span>+{{ item.score }} points</span></div><h2>Verified levels</h2><div v-for="item in player.verified" :key="'v'+item.rank" class="hub-change"><strong>#{{ item.rank }} {{ item.level }}</strong><span>+{{ item.score }} points</span></div><h2>Progress records</h2><div v-for="item in player.progressed" :key="'p'+item.rank" class="hub-change"><strong>#{{ item.rank }} {{ item.level }}</strong><span>{{ item.percent }}% · +{{ item.score }} points</span></div></section>
          <section v-if="creator" class="hub-card"><h2>Created levels</h2><div v-for="item in creator.created" :key="item.rank" class="hub-change"><strong>#{{ item.rank }} {{ item.level }}</strong><span class="creator-rating" :class="'rating-' + item.rating.toLowerCase()">{{ item.rating }} · +{{ item.score }}</span></div></section>
        </template>
      </main>`,
    computed: {
        hardestRank() { const clears=[...(this.player?.completed||[]),...(this.player?.verified||[])];return clears.length?'#'+Math.min(...clears.map(x=>x.rank)):'—'; },
        canEditProfile() { return !!store.user && String(store.profileUsername || '').toLowerCase() === String(this.$route.params.username || '').toLowerCase(); },
        displayName() { return this.player?.user || this.platformerPlayer?.user || this.creator?.user || this.$route.params.username; },
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
        earnedCount() { return this.badges.filter(b => b.earned).length; },
        achievementPercent() { return this.badges.length ? Math.round(this.earnedCount / this.badges.length * 100) : 0; },
        filteredBadges() {
            if (this.achievementFilter === 'earned') return this.badges.filter(b => b.earned);
            if (this.achievementFilter === 'locked') return this.badges.filter(b => !b.earned);
            return this.badges;
        },
        badges() {
            const completed = this.player?.completed || [], verified = this.player?.verified || [],
                progressed = this.player?.progressed || [], created = this.creator?.created || [];
            const c = completed.length, v = verified.length, p = progressed.length, made = created.length;
            const clears = [...completed, ...verified];
            const hasClear = max => clears.some(x => x.rank <= max);
            const hasRating = rating => created.some(x => String(x.rating).toLowerCase() === rating);
            const points = this.player?.total || 0, creatorPoints = this.creator?.total || 0;
            return [
                badge('first','First Clear','Complete your first level',c >= 1),
                badge('five','Getting Started','Complete 5 levels',c >= 5),
                badge('ten','Challenge Veteran','Complete 10 levels',c >= 10),
                badge('twentyfive','Dedicated Dasher','Complete 25 levels',c >= 25),
                badge('fifty','Challenge Legend','Complete 50 levels',c >= 50),
                badge('hundred','Centurion','Complete 100 levels',c >= 100),
                badge('verify','Verifier','Verify your first level',v >= 1),
                badge('verify5','Trusted Verifier','Verify 5 levels',v >= 5),
                badge('verify10','Verification Machine','Verify 10 levels',v >= 10),
                badge('top50','Top 50 Conqueror','Beat or verify a Top 50 level',hasClear(50)),
                badge('top25','Top 25 Conqueror','Beat or verify a Top 25 level',hasClear(25)),
                badge('top10','Top 10 Conqueror','Beat or verify a Top 10 level',hasClear(10)),
                badge('top1clear','Summit Slayer','Beat or verify the #1 level',hasClear(1)),
                badge('progress','Making Progress','Submit a progress record',p >= 1),
                badge('progress5','Never Give Up','Submit progress on 5 levels',p >= 5),
                badge('points100','Point Collector','Earn 100 player points',points >= 100),
                badge('points500','Point Hunter','Earn 500 player points',points >= 500),
                badge('points1000','Point Master','Earn 1,000 player points',points >= 1000),
                badge('rank100','On the Board','Reach the Top 100 player rankings',this.rank !== null && this.rank <= 100),
                badge('rank50','Rising Star','Reach the Top 50 player rankings',this.rank !== null && this.rank <= 50),
                badge('rank10','Elite Player','Reach the Top 10 player rankings',this.rank !== null && this.rank <= 10),
                badge('rank1','Number One','Hold #1 on the player leaderboard',this.rank === 1),
                badge('creator','Level Creator','Create a listed level',made >= 1),
                badge('creator5','Prolific Creator','Create 5 listed levels',made >= 5),
                badge('creator10','Master Builder','Create 10 listed levels',made >= 10),
                badge('featured','Featured Creator','Create a Featured level',hasRating('featured')),
                badge('epic','Epic Creator','Create an Epic level',hasRating('epic')),
                badge('legendary','Legendary Creator','Create a Legendary level',hasRating('legendary')),
                badge('mythic','Mythic Creator','Create a Mythic level',hasRating('mythic')),
                badge('creatorpoints','Creative Genius','Earn 25 creator points',creatorPoints >= 25)
            ];
        }
    },
    async mounted() {
        try {
            const [[players], [creators], [platformerPlayers]] = await Promise.all([fetchLeaderboard(), fetchCreatorLeaderboard(), fetchLeaderboard('_platformer.json')]);
            const username = String(this.$route.params.username || '').toLowerCase();
            const index = players.findIndex(x => x.user.toLowerCase() === username);
            this.player = players[index] || null;
            const pIndex=platformerPlayers.findIndex(x=>x.user.toLowerCase()===username);
            this.platformerPlayer=platformerPlayers[pIndex]||null;this.platformerRank=pIndex>=0?pIndex+1:null;
            this.rank = index >= 0 ? index + 1 : null;
            this.creator = creators.find(x => x.user.toLowerCase() === username) || null;
            if (!this.player && !this.creator && !this.platformerPlayer) this.error = 'No public CCL player or creator records found for this username.';
            try {
                const [profileResponse,historyResponse,statsResponse,clanResponse]=await Promise.all([
                    fetch('/api/community/profile?username='+encodeURIComponent(this.displayName),{cache:'no-store'}),
                    fetch('/api/community/history?username='+encodeURIComponent(this.displayName),{cache:'no-store'}),
                    fetch('/api/community/player-stats?username='+encodeURIComponent(this.displayName),{cache:'no-store'}),
                    fetch('/api/teams/profile?username='+encodeURIComponent(this.displayName),{cache:'no-store'})
                ]);
                if(profileResponse.ok)this.customProfile=(await profileResponse.json()).profile;
                if(clanResponse.ok)this.clan=(await clanResponse.json()).clan;
                if(historyResponse.ok)this.history=(await historyResponse.json()).history||[];
                if(statsResponse.ok){const d=await statsResponse.json();this.advancedStats=d.stats;this.recentRecords=d.recent||[];}
            }catch(e){console.warn('Community profile details unavailable',e)}
            try {
                const roleResponse = await fetch('/api/profiles/roles?username=' + encodeURIComponent(this.displayName), {cache:'no-store'});
                if (roleResponse.ok) this.staffRole = (await roleResponse.json()).role || null;
            } catch (e) { console.warn('Unable to load staff role',e); }

        } catch (e) { this.error = 'Unable to load player data right now.'; }
        this.loading = false;
    }
};
