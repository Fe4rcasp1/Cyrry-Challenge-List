import { store } from "../main.js";
import { embed } from "../util.js";
import { score } from "../score.js";
import { getLevelRating } from "../ratings.js";
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
                        <button type="button" class="filter-reset" v-if="searchQuery || sectionFilter !== 'all' || ratingFilter !== 'all'" @click="resetFilters">Clear filters</button>
                    </div>
                    <p class="search-count">{{ filteredLevels.length }} of {{ list.length }} levels</p>
                </div>
                <p v-if="list.length && !filteredLevels.length" class="search-empty">No levels match these filters.</p>
                <table class="list" v-if="list">
                    <tr class="section-header">
                        <td colspan="2" class="type-label-lg">{{ platformer ? "Platformer List" : "Main List" }}</td>
                    </tr>
                    <template v-for="item in filteredLevels" :key="item.index">
                        <tr>
                        <td class="rank">
                            <p class="type-label-lg">#{{ item.index + 1 }}</p>
                        </td>
                        <td class="level"   :class="{ 'active': selected == item.index, 'error': !item.level }">
                            <button @click="selected = item.index" :style="selected === item.index && item.level ? { backgroundColor: ratingColor(item.level), color: ratingTextColor(item.level) } : {}">
                                <span class="type-label-lg">{{ item.level?.name || \`Error (\${item.err}.json)\` }}</span>
                            </button>
                        </td>
                        </tr>
                        <tr v-if="!searchQuery.trim() && sectionFilter === 'all' && ratingFilter === 'all' && !platformer && item.index === 99 && (item.index + 1) < list.length" class="section-header">
                            <td colspan="2" class="type-label-lg">Extended</td>
                        </tr>
                    </template>
                </table>
            </div>
            <div class="level-container">
                <div class="level" v-if="level">
                    <h1>{{ level.name }}</h1>
                    <LevelAuthors :author="level.author" :creators="level.creators" :verifier="level.verifier"></LevelAuthors>
                    <iframe v-if="level.verification" class="video" id="videoframe" :src="video" frameborder="0"></iframe>
                    <p v-else class="type-label-md">Verification video not provided yet.</p>
                    <ul class="stats">
                        <li>
                            <div class="type-title-sm">Points when completed</div>
                            <p>{{ score(selected + 1, 100, level.percentToQualify) }}</p>
                        </li>
                        <li>
                            <div class="type-title-sm">ID</div>
                            <p>{{ level.id }}</p>
                        </li>
                        <li>
                            <div class="type-title-sm">Enjoyment</div>
                            <p>{{ level.Enjoyment || 'N/A' }}</p>
                        </li>
                    </ul>
                    <h2>Records</h2>
                    <p v-if="selected + 1 <= 75"><strong>{{ level.percentToQualify }}%</strong> or better to qualify</p>
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
                    <div class="og">
                        <p class="type-label-md">Website layout made by <a href="https://tsl.pages.dev/" target="_blank">TheShittyList</a></p>
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
        searchQuery: "",
        sectionFilter: "all",
        ratingFilter: "all",
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
            return (this.list || []).map(([level, err], index) => ({ level, err, index })).filter(({ level, err, index }) => {
                if (this.sectionFilter === "main" && index >= 100) return false;
                if (this.sectionFilter === "extended" && index < 100) return false;
                if (this.ratingFilter !== "all" && getLevelRating(level, this.platformer) !== this.ratingFilter) return false;
                return !query || [level?.name, level?.author, ...(level?.creators || []), level?.id, err].some(value => String(value ?? "").toLocaleLowerCase().includes(query));
            });
        },
        level() {
            return this.list[this.selected]?.[0] || null;
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
    async mounted() {
        // Hide loading spinner
        this.list = await fetchList(this.listFile);
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

        this.loading = false;
    },
    methods: {
        embed,
        score,
        resetFilters() { this.searchQuery = ""; this.sectionFilter = "all"; this.ratingFilter = "all"; },
        ratingColor(level) { return ({ rate: "#808080", featured: "#e4c526", epic: "#ef922d", legendary: "#a855f7", mythic: "#08bfd4" })[getLevelRating(level, this.platformer)] || "#244f88"; },
        ratingTextColor(level) { return ["featured", "epic", "mythic"].includes(getLevelRating(level, this.platformer)) ? "#171c27" : "#fff"; },
    },
};
