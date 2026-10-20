import { store } from '../main.js';
async function api(path,payload) {
 const res=await fetch(path,{method:payload?'POST':'GET',credentials:'same-origin',headers:payload?{'content-type':'application/json'}:{},body:payload?JSON.stringify(payload):undefined,cache:'no-store'});
 const data=await res.json();if(!res.ok)throw new Error(data.error||'Request failed');return data;
}
export default {
 data:()=>({weekly:[],completions:[],entryUrl:'',busy:false,error:'',notice:''}),
 computed:{store(){return store},currentWeek(){const d=new Date();d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10)},activeChallenge(){return this.weekly.find(x=>x.week_start===this.currentWeek)},completionsForActive(){return this.completions.filter(x=>x.challenge_id===this.activeChallenge?.id)},},
 template:`
 <main class="ccl-hub ccl-community">
 <section class="hub-head"><h1>CCL Community</h1><p>Take on this week's challenge and see verified finishers.</p></section>
 <p v-if="error" class="hub-auth-error" role="alert">{{error}}</p><p v-if="notice" role="status">{{notice}}</p>
 <section class="hub-card"><h2>Weekly challenge</h2>
 <div v-if="activeChallenge"><span class="admin-subtle-pill">Week of {{activeChallenge.week_start}}</span><h3>{{activeChallenge.title}}</h3>
 <p>{{activeChallenge.description}}</p><p><strong>Level:</strong> {{activeChallenge.level_path.replaceAll('_',' ')}} ({{activeChallenge.list_type}})</p>
 <form v-if="store.user&&store.profileUsername" @submit.prevent="enterWeekly"><label>Your video proof</label><input v-model.trim="entryUrl" type="url" required placeholder="https://..." /><button class="hub-fav-button" :disabled="busy">Enter challenge</button></form>
 <p v-else>Log in and claim your player profile to enter.</p></div>
 <div v-else class="admin-empty"><strong>No challenge scheduled this week</strong><p>Staff can publish the next weekly challenge from the admin dashboard.</p></div>
 <h3>Verified finishers</h3><p v-if="!completionsForActive.length">No verified finishers yet.</p><div v-for="(e,i) in completionsForActive" :key="i" class="hub-change"><strong>{{e.username}}</strong><span>✓ Completed</span></div><h3>Past challenges</h3><div v-for="w in weekly" :key="w.id" class="hub-change"><strong>{{w.title}}</strong><span>{{w.week_start}}</span></div>
 </section>
 </main>`,
 async mounted(){await this.loadWeekly();},
 methods:{
 async action(fn){this.busy=true;this.error='';this.notice='';try{await fn()}catch(e){this.error=e.message}finally{this.busy=false}},
 async loadWeekly(){try{const result=await api('/api/community/weekly');this.weekly=result.challenges||[];this.completions=result.completions||[]}catch(e){this.error='Weekly challenges unavailable. Check the D1 migration.'}},
 async enterWeekly(){await this.action(async()=>{await api('/api/community/weekly/enter',{challengeId:this.activeChallenge.id,videoUrl:this.entryUrl});this.entryUrl='';this.notice='Weekly challenge entry submitted.'})}
 }
};