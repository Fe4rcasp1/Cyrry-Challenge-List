import { fetchList } from '../content.js';
import { store } from '../main.js';
async function api(path,payload) {
 const res=await fetch(path,{method:payload?'POST':'GET',credentials:'same-origin',headers:payload?{'content-type':'application/json'}:{},body:payload?JSON.stringify(payload):undefined,cache:'no-store'});
 const data=await res.json();if(!res.ok)throw new Error(data.error||'Request failed');return data;
}
export default {
 data:()=>({tab:'records',listType:'normal',levelPath:'',levelFiles:[],percent:100,videoUrl:'',note:'',weekly:[],submissions:[],entryUrl:'',busy:false,error:'',notice:''}),
 computed:{store(){return store},currentWeek(){const d=new Date();d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10)},activeChallenge(){return this.weekly.find(x=>x.week_start===this.currentWeek)},},
 template:`
 <main class="ccl-hub ccl-community">
 <section class="hub-head"><h1>CCL Community</h1><p>Submit records and compete in weekly challenges.</p></section>
 <nav class="profile-achievement-controls"><button :class="{active:tab==='records'}" @click="tab='records'">Record submissions</button><button :class="{active:tab==='weekly'}" @click="tab='weekly'">Weekly challenges</button></nav>
 <p v-if="error" class="hub-auth-error" role="alert">{{error}}</p><p v-if="notice" role="status">{{notice}}</p>
 <section v-if="tab==='records'" class="hub-card"><h2>Submit a record</h2>
 <p class="hub-muted">A staff member reviews your video. Approval does not automatically change the public level JSON; staff apply verified records separately.</p>
 <p v-if="!store.user">You must <router-link to="/account">log in</router-link> to submit.</p>
 <p v-else-if="!store.profileUsername">You need an <router-link to="/account">approved player profile claim</router-link> before submitting.</p>
 <form v-else @submit.prevent="submitRecord">
 <label>List</label><select v-model="listType" @change="loadFiles"><option value="normal">Normal CCL</option><option value="platformer">Platformer CCL</option></select>
 <label>Level</label><select v-model="levelPath" required><option value="">Choose a level</option><option v-for="f in levelFiles" :key="f" :value="f">{{f.replaceAll('_',' ')}}</option></select>
 <label>Percentage</label><input type="number" v-model.number="percent" min="1" max="100" required />
 <label>Video proof URL</label><input type="url" v-model.trim="videoUrl" maxlength="500" placeholder="https://..." required />
 <label>Notes (optional)</label><textarea v-model.trim="note" maxlength="500" rows="3"></textarea>
 <button class="hub-fav-button" type="submit" :disabled="busy">Send for review</button>
 </form>
 <h3 v-if="store.user">Your submissions</h3><p v-if="store.user&&!submissions.length">No submissions yet.</p>
 <div v-for="s in submissions" :key="s.id" class="hub-change"><strong>{{s.level_path.replaceAll('_',' ')}} · {{s.percent}}%</strong><span>{{s.status}}</span></div>
 </section>
 <section v-if="tab==='weekly'" class="hub-card"><h2>Weekly challenge</h2>
 <div v-if="activeChallenge"><span class="admin-subtle-pill">Week of {{activeChallenge.week_start}}</span><h3>{{activeChallenge.title}}</h3>
 <p>{{activeChallenge.description}}</p><p><strong>Level:</strong> {{activeChallenge.level_path.replaceAll('_',' ')}} ({{activeChallenge.list_type}})</p>
 <form v-if="store.user&&store.profileUsername" @submit.prevent="enterWeekly"><label>Your video proof</label><input v-model.trim="entryUrl" type="url" required placeholder="https://..." /><button class="hub-fav-button" :disabled="busy">Enter challenge</button></form>
 <p v-else>Log in and claim your player profile to enter.</p></div>
 <div v-else class="admin-empty"><strong>No challenge scheduled this week</strong><p>Staff can publish the next weekly challenge from the admin dashboard.</p></div>
 <h3>Past challenges</h3><div v-for="w in weekly" :key="w.id" class="hub-change"><strong>{{w.title}}</strong><span>{{w.week_start}}</span></div>
 </section>
 </main>`,
 async mounted(){await Promise.all([this.loadFiles(),this.loadWeekly(),this.loadSubmissions()]);},
 methods:{
 async action(fn){this.busy=true;this.error='';this.notice='';try{await fn()}catch(e){this.error=e.message}finally{this.busy=false}},
 async loadFiles(){try{const res=await fetch('/data/'+(this.listType==='normal'?'_list.json':'_platformer.json'));this.levelFiles=await res.json();this.levelPath=''}catch(e){this.error='Could not load levels.'}},
 async loadWeekly(){try{this.weekly=(await api('/api/community/weekly')).challenges||[]}catch(e){this.error='Weekly challenges unavailable. Check the D1 migration.'}},
 async loadSubmissions(){if(!store.user)return;try{this.submissions=(await api('/api/community/submissions')).submissions||[]}catch(e){console.warn(e)}},
 async submitRecord(){await this.action(async()=>{await api('/api/community/submissions',{listType:this.listType,levelPath:this.levelPath,percent:this.percent,videoUrl:this.videoUrl,note:this.note});this.videoUrl='';this.note='';await this.loadSubmissions();this.notice='Record submitted for staff review.'})},
 async enterWeekly(){await this.action(async()=>{await api('/api/community/weekly/enter',{challengeId:this.activeChallenge.id,videoUrl:this.entryUrl});this.entryUrl='';this.notice='Weekly challenge entry submitted.'})}
 }
};