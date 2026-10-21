import { fetchLeaderboard } from '../content.js';
async function api(path,method='GET',data){
 const res=await fetch(path,{method,credentials:'same-origin',headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined,cache:'no-store'});
 const result=await res.json();if(!res.ok)throw Error(result.error||'Request failed');return result;
}
export default {
 data:()=>({teams:[],members:[],selected:null,name:'',tag:'',description:'',busy:false,error:'',notice:'',rankings:[],me:null}),
 template:`
 <main class="ccl-hub">
  <section class="hub-head"><h1>Teams & Clans</h1><p>Create a clan, join another team, and compete together on CCL.</p></section>
  <section class="hub-card"><h2>Team rankings</h2><p class="hub-muted">Points are calculated from claimed leaderboard profiles. Players without approved profile claims do not contribute points yet.</p>
   <div v-for="(team,i) in rankedTeams" :key="team.id" class="hub-change">
    <strong>#{{i+1}} [{{team.tag}}] {{team.name}} · {{team.points.toLocaleString()}} points</strong>
    <span>{{team.members}} members · Owner: {{team.owner}}</span>
    <small>{{team.description}}</small>
    <div class="admin-actions"><button class="admin-btn" @click="selectTeam(team)">View members</button><button v-if="me && !myTeam" class="admin-btn" :disabled="busy" @click="join(team)">Join team</button></div>
   </div>
   <p v-if="!teams.length">No teams created yet.</p>
  </section>
  <section v-if="selected" class="hub-card"><h2>[{{selected.tag}}] {{selected.name}} members</h2>
   <div v-for="member in members" :key="member.username" class="hub-change"><router-link :to="'/player/'+encodeURIComponent(member.username)">{{member.username}}</router-link><span v-if="member.owner">Owner</span></div>
  </section>
  <section v-if="me && !myTeam" class="hub-card"><h2>Create a team</h2>
   <div class="admin-editor-controls"><div class="admin-field"><label>Team name</label><input v-model="name" maxlength="36" placeholder="3–36 characters"></div>
   <div class="admin-field"><label>Tag</label><input v-model="tag" maxlength="6" placeholder="2–6 letters or numbers"></div>
   <div class="admin-field admin-field-full"><label>Description</label><textarea v-model="description" maxlength="250"></textarea></div></div>
   <button class="admin-btn admin-btn-primary" :disabled="busy" @click="create">Create team</button>
  </section>
  <section v-if="myTeam" class="hub-card"><h2>Your team: {{myTeam.name}}</h2>
   <button class="admin-btn" :disabled="busy" @click="myTeam.owner===me.username?disband():leave()">{{myTeam.owner===me.username?'Disband team':'Leave team'}}</button>
  </section>
  <p v-if="!me" class="hub-muted">Log in to create or join a team.</p>
  <p v-if="error" class="error">{{error}}</p><p v-if="notice" class="hub-muted">{{notice}}</p>
 </main>`,
 computed:{
  myTeam(){return this.teams.find(t=>t.memberNames?.includes(this.me?.username))||null;},
  rankedTeams(){return [...this.teams].sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name));}
 },
 async mounted(){
  try{const [t,auth,board]=await Promise.all([api('/api/teams'),api('/api/auth/me'),fetchLeaderboard()]);
   this.me=auth.user;this.rankings=board[0];this.teams=t.teams;
   await Promise.all(this.teams.map(async team=>{
    const r=await api('/api/teams/members?id='+encodeURIComponent(team.id));
    team.memberNames=r.members.map(m=>m.username);
    team.points=0;
   }));
   await this.loadScores();
  }catch(e){this.error=e.message;}
 },
 methods:{
  async loadScores(){try{const r=await api('/api/teams/scores');const points=new Map(this.rankings.map(x=>[x.user.toLowerCase(),x.total]));for(const team of this.teams)team.points=r.members.filter(x=>x.team_id===team.id).reduce((sum,x)=>sum+(points.get(x.leaderboard_username.toLowerCase())||0),0);}catch(e){console.warn('Team scores unavailable',e);}},
  async refresh(){const r=await api('/api/teams');this.teams=r.teams;await Promise.all(this.teams.map(async t=>{const m=await api('/api/teams/members?id='+t.id);t.memberNames=m.members.map(x=>x.username);}));await this.loadScores();},
  async selectTeam(team){this.selected=team;try{this.members=(await api('/api/teams/members?id='+team.id)).members;}catch(e){this.error=e.message;}},
  async perform(path,data){this.busy=true;this.error='';this.notice='';try{await api(path,'POST',data);await this.refresh();this.notice='Team updated.';}catch(e){this.error=e.message;}finally{this.busy=false;}},
  async create(){await this.perform('/api/teams/create',{name:this.name,tag:this.tag,description:this.description});},
  async join(team){await this.perform('/api/teams/join',{id:team.id});},
  async leave(){if(confirm('Leave your team?'))await this.perform('/api/teams/leave',{});},
  async disband(){if(confirm('Permanently disband your team?'))await this.perform('/api/teams/disband',{});}
 }
};
