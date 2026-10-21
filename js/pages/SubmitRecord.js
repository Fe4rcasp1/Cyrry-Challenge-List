import { store } from '../main.js';
export default {
 data:()=>({listType:'normal',levels:[],levelPath:'',username:'',discordName:'',enjoyment:'',percent:100,videoUrl:'',busy:false,error:'',notice:'',submissions:[]}),
 computed:{store(){return store}},
 template:`
 <main class="ccl-hub ccl-record-submit">
  <section class="hub-head"><h1>Submit a level record</h1><p>Send your completion for staff review. Accepted records appear on the CCL list.</p></section>
  <section class="hub-card">
   <p v-if="!store.user">Please <router-link to="/account">log in</router-link> to submit a record.</p>
   <p v-else-if="!store.profileUsername">An <router-link to="/account">approved player profile claim</router-link> is required before submitting.</p>
   <form v-else @submit.prevent="submit">
    <label for="record-list">List</label><select id="record-list" v-model="listType" @change="loadLevels"><option value="normal">Normal CCL</option><option value="platformer">Platformer CCL</option></select>
    <label for="record-level">Level</label><select id="record-level" v-model="levelPath" required><option value="">Select a level</option><option v-for="level in levels" :key="level" :value="level">{{level.replaceAll('_',' ')}}</option></select>
    <label for="record-username">CCL username</label><input id="record-username" v-model.trim="username" required maxlength="32" autocomplete="username" placeholder="Your approved player username" />
    <label for="record-discord">Discord username</label><input id="record-discord" v-model.trim="discordName" required maxlength="64" placeholder="Your Discord username" />
    <label for="record-video">Video proof link</label><input id="record-video" v-model.trim="videoUrl" type="url" required maxlength="500" placeholder="https://youtube.com/..." />
    <label for="record-enjoyment">Enjoyment (0–10)</label><input id="record-enjoyment" v-model="enjoyment" type="number" min="0" max="10" step="1" required />
    <label for="record-percent">Completion percentage</label><input id="record-percent" v-model.number="percent" type="number" min="1" max="100" required />
    <button type="submit" class="hub-fav-button" :disabled="busy">{{busy?'Submitting…':'Submit for review'}}</button>
   </form>
   <p v-if="error" role="alert" class="hub-auth-error">{{error}}</p><p v-if="notice" role="status">{{notice}}</p>
  </section>
  <section v-if="store.user" class="hub-card"><div class="admin-section-head"><h2>Record Submission Tracker</h2><button type="button" class="admin-btn" @click="loadSubmissions">Refresh status</button></div><p class="hub-muted">Track each submission from review to decision. Staff feedback appears here after review.</p>
   <p v-if="!submissions.length">No submissions yet.</p>
   <div v-for="s in submissions" :key="s.id" class="hub-change">
    <strong>{{s.level_path.replaceAll('_',' ')}} · {{s.percent}}% <span :class="'ccl-submission-status ccl-status-'+s.status">{{s.status}}</span></strong>
    <span>{{s.list_type==='platformer'?'Platformer':'Normal'}} · Submitted: {{s.created_at}}</span>
    <span v-if="s.reviewed_at">Reviewed: {{s.reviewed_at}}</span>
    <p v-if="s.review_feedback"><strong>Staff feedback:</strong> {{s.review_feedback}}</p>
    <a v-if="s.video_url" :href="s.video_url" target="_blank" rel="noopener noreferrer">View submitted proof ↗</a>
   </div>
  </section>
 </main>`,
 async mounted(){this.username=store.profileUsername||'';await this.loadLevels();if(store.user)await this.loadSubmissions();},
 watch:{'store.profileUsername'(name){if(name&&!this.username)this.username=name},'store.user'(user){if(user)this.loadSubmissions()}},
 methods:{
  async loadLevels(){this.levelPath='';try{const r=await fetch('/data/'+(this.listType==='normal'?'_list.json':'_platformer.json'));if(!r.ok)throw Error('Unable to load levels');this.levels=await r.json()}catch(e){this.error=e.message}},
  async loadSubmissions(){try{const r=await fetch('/api/community/submissions',{credentials:'same-origin',cache:'no-store'});if(r.ok)this.submissions=(await r.json()).submissions||[]}catch(e){console.warn(e)}},
  async submit(){this.error='';this.notice='';this.busy=true;try{
    const r=await fetch('/api/community/submissions',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({listType:this.listType,levelPath:this.levelPath,username:this.username,discordName:this.discordName,videoUrl:this.videoUrl,enjoyment:Number(this.enjoyment),percent:this.percent})});
    const data=await r.json();if(!r.ok)throw Error(data.error||'Submission failed');
    this.notice='Record submitted! Staff can now review your video.';this.videoUrl='';this.enjoyment='';await this.loadSubmissions();
  }catch(e){this.error=e.message}finally{this.busy=false}}
 }
};