import { store } from "../main.js";
import { embed } from "../util.js";
import { score } from "../score.js";
import { getLevelRating, getImpossibleRating } from "../ratings.js";
import { isFavorite, toggleFavorite } from "../favorites.js";
import { fetchEditors, fetchList } from "../content.js";

import Spinner from "../components/Spinner.js";
import LevelAuthors from "../components/List/LevelAuthors.js";

const roleIconMap = {
    owner: "crown",
    admin: "user-gear",
    helper: "user-shield",
    dev: "code",
    trial: "user-lock",
};

export default {
    components: { Spinner, LevelAuthors },
    props: { listFile: { type: String, default: "_list.json" }, platformer: { type: Boolean, default: false } },
    template: `
        <main v-if="loading">
            <Spinner></Spinner>
        </main>
        <main v-else class="page-list">
            <div class="list-container">
                <div class="search-panel">
                    <label :for="platformer ? 'platformer-search' : 'level-search'">Search levels</label>
                    <input :id="platformer ? 'platformer-search' : 'level-search'" class="list-search" type="search" v-model="searchQuery" placeholder="Search by level name, creator, or ID…" autocomplete="off" />
                    <div class="level-filters">
                        <label :for="platformer ? 'platformer-section' : 'challenge-section'">List section</label>
                        <select :id="platformer ? 'platformer-section' : 'challenge-section'" v-model="sectionFilter" class="filter-select">
                            <option value="all">All levels</option>
                            <option value="main">Main List (1–100)</option>
                            <option value="extended">Extended List (101+)</option>
                            <option value="unverified">Unverified</option>
                        </select>
                        <label :for="platformer ? 'platformer-rating' : 'challenge-rating'">Rating</label>
                        <select :id="platformer ? 'platformer-rating' : 'challenge-rating'" v-model="ratingFilter" class="filter-select">
                            <option value="all">All ratings</option>
                            <option value="rate">Rate</option>
                            <option value="featured">Featured</option>
                            <option value="epic">Epic</option>
                            <option value="legendary">Legendary</option>
                            <option value="mythic">Mythic</option>
                        </select>
                        <label :for="platformer ? 'platformer-enjoyment' : 'challenge-enjoyment'">Enjoyment</label>
                        <select :id="platformer ? 'platformer-enjoyment' : 'challenge-enjoyment'" v-model="enjoymentFilter" class="filter-select">
                            <option value="all">All enjoyment ratings</option>
                            <option value="rated">Rated levels only</option>
                            <option value="9">9+/10</option>
                            <option value="8">8+/10</option>
                            <option value="7">7+/10</option>
                            <option value="5">5+/10</option>
                            <option value="unrated">Unrated levels</option>
                        </select>
                        <label :for="platformer ? 'platformer-enjoyment-sort' : 'challenge-enjoyment-sort'">Sort enjoyment</label>
                        <select :id="platformer ? 'platformer-enjoyment-sort' : 'challenge-enjoyment-sort'" v-model="enjoymentSort" class="filter-select">
                            <option value="rank">List ranking</option>
                            <option value="highest">Highest enjoyment first</option>
                            <option value="lowest">Lowest enjoyment first</option>
                        </select>
                        <button type="button" class="filter-reset" v-if="searchQuery || sectionFilter !== 'all' || ratingFilter !== 'all' || enjoymentFilter !== 'all' || enjoymentSort !== 'rank'" @click="resetFilters">Clear filters</button>
                    </div>
                    <p class="search-count">{{ filteredLevels.length }} of {{ list.length + impossibleLevels.length }} levels</p>
                </div>
                <p v-if="list.length && !filteredLevels.length" class="search-empty">No levels match these filters.</p>
                <table class="list" v-if="list">
                    <tr class="section-header">
                        <td colspan="2" class="type-label-lg">{{ platformer ? "Platformer List" : "Main List" }}</td>
                    </tr>
                    <template v-for="item in filteredLevels" :key="item.impossible ? 'unverified-' + item.index : item.index">
                        <tr v-if="item.impossible && (!filteredLevels.some(x => x.impossible && x.index < item.index))" class="section-header"><td colspan="2" class="type-label-lg">Unverified</td></tr>
                        <tr>
                        <td class="rank">
                            <p class="type-label-lg">#{{ item.impossible ? item.level.impossibleRank : item.index + 1 }}</p>
                        </td>
                        <td class="level"   :class="{ 'active': selected == item.index && selectedImpossible === !!item.impossible, 'error': !item.level, 'completed-by-user': isCompletedByUser(item.level) }">
                            <button @click="selectLevel(item)" :style="item.level ? { backgroundColor: ratingColor(item.level, item.impossible, item.index), color: ratingTextColor(item.level, item.impossible, item.index) } : {}">
                                <span class="type-label-lg">{{ item.level?.name || \`Error (\${item.err}.json)\` }}</span>
                            <small v-if="!item.impossible && item.level?.records?.length > 0 && enjoymentByPath[levelPaths[item.index]]" class="list-enjoyment-label">★ {{enjoymentByPath[levelPaths[item.index]].average}}/10 ({{enjoymentByPath[levelPaths[item.index]].ratings}})</small>
                            </button>
                        </td>
                        </tr>
                        <tr v-if="!searchQuery.trim() && sectionFilter === 'all' && ratingFilter === 'all' && enjoymentFilter === 'all' && enjoymentSort === 'rank' && !platformer && item.index === 99 && (item.index + 1) < list.length" class="section-header">
                            <td colspan="2" class="type-label-lg">Extended</td>
                        </tr>
                    </template>
                </table>
                <section v-if="!showUnverified && sectionFilter !== 'unverified'" class="ccl-unverified-section">
                    <div class="ccl-unverified-eyebrow">SECTION 03</div>
                    <h2>Unverified</h2>
                    <p>{{ impossibleLevels.length ? impossibleLevels.length + (platformer ? ' Impossible Platformer levels' : ' Impossible CCL levels') : (platformer ? 'Impossible Platformer levels' : 'Impossible CCL levels') }}</p>
                    <button type="button" class="ccl-unverified-toggle" @click="openUnverified" :disabled="impossibleLoading">{{ impossibleLoading ? 'Loading levels…' : 'Show unverified levels ↓' }}</button>
                    <p v-if="impossibleError" class="error">{{ impossibleError }}</p>
                </section>
            </div>
            <div class="level-container">
                <div class="level" v-if="level">
                    <h1>{{ level.name }}</h1>
                    <button v-if="!selectedImpossible" type="button" class="hub-fav-button" @click="toggleLevelFavorite" :aria-pressed="favorite" :aria-label="favorite ? 'Remove favorite' : 'Save favorite'">{{ favorite ? "★ Saved to Favorites" : "☆ Save to Favorites" }}</button>
                    <LevelAuthors :author="level.author" :creators="level.creators" :verifier="level.verifier"></LevelAuthors>
                    <iframe v-if="level.verification" class="video" id="videoframe" :src="video" frameborder="0"></iframe>
                    <p v-else class="type-label-md">Verification video not provided yet.</p>
                    <ul class="stats">
                        <li>
                            <div class="type-title-sm">Points when completed</div>
                            <p>{{ selectedImpossible ? "Unverified · no points" : score(selected + 1, 100, level.percentToQualify, platformer ? "platformer" : "normal") }}</p>
                        </li>
                        <li>
                            <div class="type-title-sm">ID</div>
                            <p>{{ level.id }}</p>
                        </li>
                        <li>
                            <div class="type-title-sm">Enjoyment</div>
                            <p>{{ !level.records?.length ? 'N/A' : (!selectedImpossible && enjoymentByPath[levelPaths[selected]] ? enjoymentByPath[levelPaths[selected]].average + '/10 (' + enjoymentByPath[levelPaths[selected]].ratings + ' ratings)' : (level.Enjoyment || 'N/A')) }}</p>
                        </li>
                    </ul>
                    <section v-if="!selectedImpossible" class="hub-card" style="margin:1rem 0">
                        <div class="admin-section-head"><h2>Level changelog</h2><button type="button" class="admin-btn" @click="loadLevelHistory">View history</button></div>
                        <p v-if="historyLoading" class="hub-muted">Loading history…</p>
                        <p v-if="historyError" class="error">{{historyError}}</p>
                        <div v-for="entry in levelHistory" :key="entry.id" class="hub-change">
                            <strong>{{entry.summary}}</strong><span>{{entry.editor||'Staff'}} · {{entry.created_at}}</span>
                            <small>{{entry.github_synced?'GitHub backed up':'GitHub backup not confirmed'}}</small>
                        </div>
                        <p v-if="historyLoaded && !levelHistory.length" class="hub-muted">No recorded changes yet. History starts with new admin edits.</p>
                    </section>
                    <h2>Records</h2>
                    <p v-if="selectedImpossible">Unverified level</p>
                    <p v-else-if="selected + 1 <= 75"><strong>{{ level.percentToQualify }}%</strong> or better to qualify</p>
                    <p v-else-if="selected + 1 <= 100"><strong>100%</strong> or better to qualify</p>
                    <p v-else><strong>100%</strong> or better to qualify</p>
                    <table class="records">
                        <tr v-for="record in level.records" class="record">
                            <td class="percent">
                                <p>{{ record.percent }}%</p>
                            </td>
                            <td class="user">
                                <a :href="record.link" target="_blank" class="type-label-lg">{{ record.user }}</a>
                            </td>
                            <td class="mobile">
                                <img v-if="record.mobile" :src="\`/assets/phone-landscape\${store.dark ? '-dark' : ''}.svg\`" alt="Mobile">
                            </td>
                            <td class="hz">
                                <p>{{ record.hz }}Hz</p>
                            </td>
                        </tr>
                    </table>
                </div>
                <div v-else class="level" style="height: 100%; justify-content: center; align-items: center;">
                    <p>(ノಠ益ಠ)ノ彡┻━┻</p>
                </div>
            </div>
            <div class="meta-container">
                <div class="meta">
                    <div class="errors" v-show="errors.length > 0">
                        <p class="error" v-for="error of errors">{{ error }}</p>
                    </div>
                    
                    <template v-if="editors">
                        <h3>List Editors</h3>
                        <ol class="editors">
                            <li v-for="editor in editors">
                                <img :src="\`/assets/\${roleIconMap[editor.role]}\${store.dark ? '-dark' : ''}.svg\`" :alt="editor.role">
                                <a v-if="editor.link" class="type-label-lg link" target="_blank" :href="editor.link">{{ editor.name }}</a>
                                <p v-else>{{ editor.name }}</p>
                            </li>
                        </ol>
                    </template>
                    <h3>Level Info | Ratings</h3>
                     <p>
                        ⭐ = recently added
                        ___________________________
                    </p>    
                    <p>
                        🏆 = creator contest winner
                        ___________________________
                    </p>
                    <p>
                        Grey = Star Rating
                    </p>    
                    <p>
                        Yellow = Feature Rating
                    </p> 
                    <p>
                        Orange = Epic Rating
                    </p>
                    <p>
                        Pink = Legendary Rating
                    </p>
                    <p>
                        Cyan = Mythic Rating
                    </p>
                    <p>
                        ⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
                    </p>
                    <p>
                        <h3>Record Submission Requirements</h3>
                    </p>
                    <p>
                        ⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
                    </p>
                    <p>
                        Submit levels/verifcations in the discord (link at the top of the website) and submit completions using the "submit record" button or in the discord.
                    </p>
                    <p>
                        If you achieved a record on a level that is listed on the site - please check the level ID before you submit the record.
                    </p>
                    <p>
                        Verifications and completions must have clicks, cheat indicator, and show the end screen (except some limitations like mobile, broken mic, or not having mods).
                    </p>
                    <p>
                        The recording must show some of the previous attempt and entire death animation shown before the completion, unless the completion is on the first attempt.
                    </p>
                    <p>
                        The recording must also show the player hit the end wall, or the completion may not be accepted.
                    </p>
                    <p>
                        Do not use secret routes or bug routes.
                    </p>
                    <p>
                        Levels can be beaten/verified with 100% noclip accuracy if enough proof that it was legit.
                    </p>
                    <p>
                        This is more a statement than a rule but everyones username on the list will be based off of their in-game username.
                    </p>
                    <p>
                        ⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
                    </p>
                    <p>
                        <h3>Level Submission Requirements</h3>
                    </p>
                    <p>
                        ⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
                    </p>
                    <p>
                        Levels must have some effort put into them
                    </p>
                    <p>
                        CPS limit is 15 (including impossible levels)
                    </p>
                    <p>
                        Levels must be uploaded publicly and startposes must be disabled in the editor
                    </p>
                    <p>
                        No crash triggers or random trigger abuse
                    </p>
                    <p>
                        No rated levels or 2 player levels
                    </p>
                    <p>
                        Do not just copy and paste other levels
                    </p>
                    <p>
                        If your level is a collab between 2 or more people, please tell me so I can put everyones names under the level on the list
                    </p>
                    <p>
                        If you have an unverified level, you can submit it to the impossible/unverified list in the discord
                    </p>
                </div>
            </div>
        </main>
    `,
    data: () => ({
        list: [],
        showUnverified: false,
        impossibleLevels: [],
        impossibleLoading: false,
        impossibleError: "",
        selectedImpossible: false,
        searchQuery: "",
        favorite: false,
        sectionFilter: "all",
        ratingFilter: "all",
        enjoymentFilter: "all",
        enjoymentSort: "rank",
        enjoymentByPath: {},
        levelHistory: [], historyLoading:false, historyLoaded:false, historyError:"",
        levelPaths: [],
        editors: [],
        loading: true,
        selected: 0,
        errors: [],
        roleIconMap,
        store
    }),
    computed: {
        filteredLevels() {
            const query = this.searchQuery.trim().toLocaleLowerCase();
            const verified = (this.list || []).map(([level, err], index) => ({ level, err, index, impossible:false }));
            const unverified = !this.showUnverified ? [] : this.impossibleLevels.map((level,index)=>({level,err:null,index,impossible:true}));
            const filtered = [...verified,...unverified].filter(({level,err,index,impossible})=>{
                if (this.sectionFilter === 'main' && (impossible || index >= 100)) return false;
                if (this.sectionFilter === 'extended' && (impossible || index < 100)) return false;
                if (this.sectionFilter === 'unverified' && !impossible) return false;
                if (this.ratingFilter !== 'all' && getLevelRating(level,this.platformer) !== this.ratingFilter) return false;
                const enjoyment = impossible || !level?.records?.length ? null : this.enjoymentByPath[this.levelPaths[index]];
                if (this.enjoymentFilter === 'rated' && !enjoyment) return false;
                if (this.enjoymentFilter === 'unrated' && enjoyment) return false;
                if (!['all','rated','unrated'].includes(this.enjoymentFilter) && (!enjoyment || Number(enjoyment.average) < Number(this.enjoymentFilter))) return false;
                return !query || [level?.name,level?.author,...(level?.creators||[]),level?.id,err].some(value=>String(value??'').toLocaleLowerCase().includes(query));
            });
            if(this.enjoymentSort !== 'rank')filtered.sort((a,b)=>{
                const x=a.impossible||!a.level?.records?.length?null:this.enjoymentByPath[this.levelPaths[a.index]]?.average;
                const y=b.impossible||!b.level?.records?.length?null:this.enjoymentByPath[this.levelPaths[b.index]]?.average;
                if(x==null&&y==null)return Number(a.impossible)-Number(b.impossible)||a.index-b.index;
                if(x==null)return 1;
                if(y==null)return -1;
                return (this.enjoymentSort==='highest'?Number(y)-Number(x):Number(x)-Number(y))||a.index-b.index;
            });
            return filtered;
        },
        level() {
            return this.selectedImpossible ? this.impossibleLevels[this.selected] || null : this.list[this.selected]?.[0] || null;
        },
        video() {
            if (!this.level) return "";
            if (!this.level.showcase) {
                return embed(this.level.verification);
            }

            return embed(
                this.toggledShowcase
                    ? this.level.showcase
                    : this.level.verification
            );
        },
    },
    watch: {
        selected() { this.syncFavorite(); }
    },
    async mounted() {
        // Hide loading spinner
        this.list = await fetchList(this.listFile);
        try {
            const [namesResponse, ratingsResponse] = await Promise.all([
                fetch('/data/' + this.listFile),
                fetch('/api/community/enjoyment', { cache: 'no-store' })
            ]);
            if (namesResponse.ok) this.levelPaths = await namesResponse.json();
            if (ratingsResponse.ok) {
                const ratings = (await ratingsResponse.json()).levels || [];
                const type = this.platformer ? 'platformer' : 'normal';
                this.enjoymentByPath = Object.fromEntries(ratings.filter(x => x.list_type === type).map(x => [x.level_path, x]));
            }
        } catch (error) { console.warn('Enjoyment filters unavailable', error); }
        this.editors = await fetchEditors();

        // Error handling
        if (!this.list) {
            this.errors = [
                "Failed to load list. Retry in a few minutes or notify list staff.",
            ];
        } else {
            this.errors.push(
                ...this.list
                    .filter(([_, err]) => err)
                    .map(([_, err]) => {
                        return `Failed to load level. (${err}.json)`;
                    })
            );
            if (!this.editors) {
                this.errors.push("Failed to load list editors.");
            }
        }

        const targetId = this.$route.query.level;
        if (targetId && this.list) {
            const index = this.list.findIndex(([level]) => String(level?.id) === String(targetId));
            if (index >= 0) this.selected = index;
        }
        this.loading = false;
        this.syncFavorite();
    },
    methods: {
        async openUnverified(scrollToBottom=true) {
            if(!this.impossibleLevels.length) {
                this.impossibleLoading=true;this.impossibleError='';
                try {
                    const response=await fetch('/api/impossible-levels' + (this.platformer ? '?list=platformer' : ''),{cache:'no-store'});
                    const data=await response.json();
                    if(!response.ok)throw new Error(data.error||'Could not load unverified levels.');
                    this.impossibleLevels=data.levels||[];
                }catch(e){this.impossibleError=e.message;this.impossibleLoading=false;return;}
                this.impossibleLoading=false;
            }
            this.showUnverified=true;
            if(scrollToBottom)this.$nextTick(()=>{const el=document.querySelector('.page-list .list-container');if(el)el.scrollTop=el.scrollHeight;});
        },
        selectLevel(item){this.selectedImpossible=!!item.impossible;this.selected=item.index;this.levelHistory=[];this.historyLoaded=false;this.historyError='';this.syncFavorite();},
        isCompletedByUser(level) {
            const username = this.store.profileUsername;
            if (!username || !level) return false;
            const normalized = username.toLocaleLowerCase();
            return (level.verifier || '').toLocaleLowerCase() === normalized ||
                (level.records || []).some(record => (record.user || '').toLocaleLowerCase() === normalized && Number(record.percent) === 100);
        },
        syncFavorite() { this.favorite = !this.selectedImpossible && isFavorite(this.level?.id, this.platformer); },
        toggleLevelFavorite() { if(this.selectedImpossible)return; toggleFavorite(this.level, this.platformer); this.syncFavorite(); },
        embed,
        score,
        async loadLevelHistory(){
            if(this.selectedImpossible || !this.levelPaths[this.selected])return;
            this.historyLoading=true;this.historyError='';this.levelHistory=[];
            try{
                const type=this.platformer?'platformer':'normal';
                const response=await fetch('/api/levels/history?list='+type+'&path='+encodeURIComponent(this.levelPaths[this.selected]),{cache:'no-store'});
                const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to load history.');
                this.levelHistory=data.history||[];this.historyLoaded=true;
            }catch(e){this.historyError=e.message;}finally{this.historyLoading=false;}
        },
        resetFilters() { this.searchQuery = ""; this.sectionFilter = "all"; this.ratingFilter = "all"; this.enjoymentFilter = "all"; this.enjoymentSort = "rank"; },
        ratingColor(level, impossible=false, index=0) { const rating=impossible?getImpossibleRating(index,this.platformer):getLevelRating(level,this.platformer);return ({ rate: "#808080", featured: "#e4c526", epic: "#ef922d", legendary: "#a855f7", mythic: "#08bfd4" })[rating] || "#244f88"; },
        ratingTextColor(level, impossible=false, index=0) { return ["featured", "epic", "mythic"].includes(impossible?getImpossibleRating(index,this.platformer):getLevelRating(level,this.platformer)) ? "#171c27" : "#fff"; },
    },
};
