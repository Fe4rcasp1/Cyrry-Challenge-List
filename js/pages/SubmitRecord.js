import { store } from '../main.js';
export default {
 data:()=>({normalLevels:[],platformerLevels:[],records:[{key:1,listType:'normal',levelPath:'',levelSearch:'',videoUrl:'',enjoyment:'',percent:100}],nextKey:2,discordName:'',busy:false,error:'',notice:'',submissions:[]}),
 computed:{store(){return store}},
 template:`
 <main class="ccl-hub ccl-record-submit">
  <section class="hub-head"><h1>Submit a level record</h1><p>Send your completion for staff review. Accepted records appear on the CCL list.</p></section>
  <section class="hub-card">
   <p v-if="!store.user">Please <router-link to="/account">log in</router-link> to submit a record.</p>
   <p v-else-if="!store.profileUsername">An <router-link to="/account">approved player profile claim</router-link> is required before submitting.</p>
   <form v-else @submit.prevent="submit">
    <label for="record-discord">Discord username (shared by all records)</label><input id="record-discord" v-model.trim="discordName" required maxlength="64" placeholder="Your Discord username" />
    <p class="hub-muted">Submitting as {{store.profileUsername}}. Add up to 20 records in one batch.</p>
    <div v-for="(record,i) in records" :key="record.key" class="ccl-batch-record">
     <div class="admin-section-head"><h3>Record {{i+1}}</h3><button v-if="records.length>1" type="button" class="admin-btn" :disabled="busy" @click="removeRecord(i)">Remove</button></div>
     <label :for="'record-list-'+record.key">List</label><select :id="'record-list-'+record.key" v-model="record.listType" @change="record.levelPath='';record.levelSearch=''"><option value="normal">Normal CCL</option><option value="platformer">Platformer CCL</option></select>
     <label :for="'record-search-'+record.key">Search levels</label><input :id="'record-search-'+record.key" v-model="record.levelSearch" type="search" autocomplete="off" placeholder="Type a level name…" />
     <label :for="'record-level-'+record.key">Level</label><select :id="'record-level-'+record.key" v-model="record.levelPath" required><option value="">Select a level</option><option v-for="level in matchingLevels(record)" :key="level" :value="level">{{level.replaceAll('_',' ')}}</option></select>
     <p v-if="record.levelSearch && !matchingLevels(record).length" class="hub-muted">No matching levels found.</p>
     <label :for="'record-video-'+record.key">Video proof</label><input :id="'record-video-'+record.key" v-model.trim="record.videoUrl" type="url" required maxlength="500" placeholder="https://youtube.com/..." />
     <label :for="'record-enjoyment-'+record.key">Enjoyment (0–10)</label><input :id="'record-enjoyment-'+record.key" v-model.number="record.enjoyment" type="number" min="0" max="10" step="1" required />
     <label :for="'record-percent-'+record.key">Completion percentage</label><input :id="'record-percent-'+record.key" v-model.number="record.percent" type="number" min="1" max="100" required />
    </div>
    <div class="admin-actions"><button type="button" class="admin-btn" :disabled="busy||records.length>=20" @click="addRecord">+ Add another record</button><button type="submit" class="hub-fav-button" :disabled="busy">{{busy?'Submitting…':'Submit '+records.length+' record'+(records.length===1?'':'s')+' for review'}}</button></div>
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
 async mounted(){await this.loadLevels();if(store.user)await this.loadSubmissions();},
 watch:{'store.user'(user){if(user)this.loadSubmissions()}},
 methods:{
  matchingLevels(record){const levels=record.listType==='normal'?this.normalLevels:this.platformerLevels;const query=(record.levelSearch||'').trim().toLowerCase();return levels.filter(level=>!query||level.replaceAll('_',' ').toLowerCase().includes(query)||level.toLowerCase().includes(query)||level===record.levelPath);},
  addRecord(){if(this.records.length<20)this.records.push({key:this.nextKey++,listType:'normal',levelPath:'',videoUrl:'',enjoyment:'',percent:100});},
  removeRecord(i){if(this.records.length>1)this.records.splice(i,1);},
  async loadLevels(){try{const responses=await Promise.all(['/data/_list.json','/data/_platformer.json'].map(x=>fetch(x)));if(responses.some(r=>!r.ok))throw Error('Unable to load level lists');[this.normalLevels,this.platformerLevels]=await Promise.all(responses.map(r=>r.json()));}catch(e){this.error=e.message;}},
  async loadSubmissions(){try{const r=await fetch('/api/community/submissions',{credentials:'same-origin',cache:'no-store'});if(r.ok)this.submissions=(await r.json()).submissions||[];}catch(e){console.warn(e);}},
  async submit(){
   this.error='';this.notice='';
   if(new Set(this.records.map(r=>r.listType+':'+r.levelPath)).size!==this.records.length){this.error='Each level can only appear once in a batch.';return;}
   this.busy=true;
   try{
    const payload=this.records.map(r=>({listType:r.listType,levelPath:r.levelPath,videoUrl:r.videoUrl,enjoyment:Number(r.enjoyment),percent:Number(r.percent),discordName:this.discordName,username:store.profileUsername}));
    const response=await fetch('/api/community/submissions/bulk',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({records:payload})});
    const data=await response.json();if(!response.ok)throw Error(data.error||'Submission failed');
    this.notice=data.submitted+' record'+(data.submitted===1?'':'s')+' submitted for review!';
    this.records=[{key:this.nextKey++,listType:'normal',levelPath:'',videoUrl:'',enjoyment:'',percent:100}];
    await this.loadSubmissions();
   }catch(e){this.error=e.message;}finally{this.busy=false;}
  }
 }

};