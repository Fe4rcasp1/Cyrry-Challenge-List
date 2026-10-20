async function api(path, method='GET', payload) {
 const response = await fetch(path, {method,credentials:'same-origin',headers:payload?{'content-type':'application/json'}:{},body:payload?JSON.stringify(payload):undefined});
 const data=await response.json();
 if(!response.ok) throw new Error(data.error||'Request failed');
 return data;
}
export default {
 data:()=>({role:'',tab:'claims',claims:[],users:[],levelFiles:[],listType:'normal',levelPath:'',levelText:'',filter:'',loading:true,busy:false,error:'',notice:''}),
 template:`
 <main class="ccl-hub"><section class="hub-head"><h1>CCL Admin Dashboard</h1><p>Manage player claims, level data, and account permissions.</p></section>
 <p v-if="loading">Checking your permissions…</p>
 <section v-else-if="!role" class="hub-card"><h2>Access restricted</h2><p>You need an assigned staff role to use this page. <router-link to="/account">Log in</router-link> with an authorized account.</p></section>
 <template v-else>
 <section class="hub-card"><strong>Your role: {{role}}</strong><div class="admin-tabs">
 <button @click="tab='claims';loadClaims()" :class="{active:tab==='claims'}">Profile Claims</button>
 <button v-if="canEdit" @click="tab='levels';loadFiles()" :class="{active:tab==='levels'}">Level Editor</button>
 <button v-if="canManage" @click="tab='users';loadUsers()" :class="{active:tab==='users'}">Staff Roles</button>
 </div></section>
 <section v-if="tab==='claims'" class="hub-card"><h2>Pending profile claims</h2><button @click="loadClaims">Refresh</button><p v-if="!claims.length">No pending claims.</p>
 <article class="admin-claim" v-for="c in claims" :key="c.id"><strong>{{c.leaderboard_username}}</strong><p>Account: {{c.account_username}} ({{c.email}})</p><p>Evidence:</p><pre class="admin-evidence">{{c.evidence}}</pre><small>Submitted {{c.created_at}}</small>
 <div class="admin-actions"><button :disabled="busy" @click="review(c,'approved')">Approve</button><button :disabled="busy" @click="review(c,'rejected')">Reject</button></div></article></section>
 <section v-if="tab==='levels' && canEdit" class="hub-card"><h2>Edit existing level</h2><p>Changes are stored in D1 and immediately reflected in the normal and platformer lists, including leaderboard calculations. GitHub source JSON is preserved.</p>
 <label>List</label><select v-model="listType" @change="levelPath='';levelText='';loadFiles"><option value="normal">Normal CCL</option><option value="platformer">Platformer CCL</option></select>
 <label>Find level</label><input class="hub-search" v-model="filter" placeholder="Search level file…" />
 <select class="admin-level-select" v-model="levelPath" @change="loadLevel"><option value="">Choose a level</option><option v-for="f in filteredFiles" :key="f" :value="f">{{f}}</option></select>
 <template v-if="levelPath"><label>Level JSON</label><textarea class="admin-json" v-model="levelText" spellcheck="false"></textarea><button :disabled="busy" @click="saveLevel">Save level changes</button></template></section>
 <section v-if="tab==='users' && canManage" class="hub-card"><h2>Staff permissions</h2><p>Owner can assign roles; admin can edit levels and review claims; editor can edit levels; moderator can review claims.</p><div v-for="u in users" :key="u.id" class="admin-user"><strong>{{u.username}}</strong><span>{{u.role||'member'}}</span><select :value="u.role||'member'" @change="setRole(u,$event.target.value);$event.target.value=u.role||'member'"><option value="member">Member</option><option value="moderator">Moderator</option><option value="editor">Editor</option><option value="admin">Admin</option><option value="owner">Owner</option></select></div></section>
 </template><p v-if="error" class="hub-auth-error" role="alert">{{error}}</p><p v-if="notice" role="status">{{notice}}</p></main>`,
 computed:{canEdit(){return ['owner','admin','editor'].includes(this.role)},canManage(){return this.role==='owner'},filteredFiles(){return this.levelFiles.filter(x=>x.toLowerCase().includes(this.filter.toLowerCase())).slice(0,300)}},
 async mounted(){try{const me=await api('/api/admin/me');this.role=me.role||'';if(this.role){if(this.role==='editor'){this.tab='levels';await this.loadFiles()}else await this.loadClaims()}}catch(e){this.error=e.message}finally{this.loading=false}},
 methods:{
 async run(fn){this.error='';this.notice='';this.busy=true;try{await fn()}catch(e){this.error=e.message}finally{this.busy=false}},
 async loadClaims(){await this.run(async()=>{this.claims=(await api('/api/admin/claims')).claims})},
 async review(c,status){if(!confirm(status==='approved'?'Approve ownership of '+c.leaderboard_username+'?':'Reject this claim?'))return;await this.run(async()=>{await api('/api/admin/claims/review','POST',{id:c.id,status});this.claims=this.claims.filter(x=>x.id!==c.id);this.notice='Claim '+status+'.'})},
 async loadFiles(){await this.run(async()=>{const file=this.listType==='platformer'?'_platformer.json':'_list.json';const response=await fetch('/data/'+file);if(!response.ok)throw new Error('Could not load list');this.levelFiles=await response.json()})},
 async loadLevel(){if(!this.levelPath)return;await this.run(async()=>{const override=await api('/api/levels/overrides?list='+this.listType);let level=override.levels[this.levelPath];if(!level){const response=await fetch('/data/'+encodeURIComponent(this.levelPath)+'.json');if(!response.ok)throw new Error('Level file not found');level=await response.json()}this.levelText=JSON.stringify(level,null,2)})},
 async saveLevel(){if(!confirm('Save changes to '+this.levelPath+'?'))return;await this.run(async()=>{const level=JSON.parse(this.levelText);await api('/api/admin/levels','POST',{listType:this.listType,path:this.levelPath,level});this.notice='Saved. Changes are live on next list refresh.'})},
 async loadUsers(){await this.run(async()=>{this.users=(await api('/api/admin/users')).users})},
 async setRole(u,role){if(!confirm('Change '+u.username+' to '+role+'?'))return;await this.run(async()=>{await api('/api/admin/roles','POST',{userId:u.id,role});await this.loadUsers();this.notice='Role updated.'})}
 }
};
