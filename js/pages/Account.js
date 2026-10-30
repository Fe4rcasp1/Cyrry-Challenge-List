import { fetchLeaderboard, fetchCreatorLeaderboard, fetchList } from '../content.js';
import { store } from '../main.js';
async function api(path, data) {
 const res = await fetch(path, { method: data ? 'POST' : 'GET', credentials: 'same-origin', headers: data ? { 'content-type':'application/json' } : {}, body: data ? JSON.stringify(data) : undefined });
 const result = await res.json();
 if (!res.ok) throw new Error(result.error || 'Request failed.');
 return result;
}
export default {
 data: () => ({ mode:'login', username:'', email:'', password:'', confirmPassword:'', showPassword:false, login:'', evidence:'', claimName:'', user:null, claims:[], leaderboardNames:[], busy:false, message:'', error:'', bio:'', avatarUrl:'', bannerUrl:'', accent:'#477bc1',favoriteLevel:'',featuredBadge:'',showcaseLevel:'',backgroundUrl:'',favoriteOptions:[] }),
 template: `
 <main class="ccl-hub"><section class="hub-head"><h1>CCL Account</h1><p>Sign in to your account from any device. Leaderboard profile claims require approval.</p></section>
 <section v-if="user" class="hub-card">
  <h2>Welcome, {{ user.username }}</h2><p>Signed in as {{ user.email }}</p>
  <router-link :to="'/player/' + encodeURIComponent(approvedClaim || user.username)" class="hub-profile-link">View player profile →</router-link>
  <div class="ccl-logout-row"><button type="button" class="hub-fav-button" @click="logout">Log Out</button></div>
  <h2>Customize your profile</h2>
  <p class="hub-muted">Your public bio, avatar and banner appear on your claimed CCL profile after approval. Images must use direct public HTTPS links.</p>
  <form @submit.prevent="saveProfile">
    <label>Bio (up to 500 characters)</label><textarea class="hub-search" v-model="bio" maxlength="500" rows="3"></textarea>
    <label>Avatar image URL</label><input class="hub-search" type="url" v-model.trim="avatarUrl" maxlength="500" placeholder="https://..." />
    <label>Banner image URL</label><input class="hub-search" type="url" v-model.trim="bannerUrl" maxlength="500" placeholder="https://..." />
    <label>Accent color</label><input type="color" v-model="accent" />
    <label for="favorite-level-select">Favorite level</label><select id="favorite-level-select" class="hub-search" v-model="favoriteLevel"><option value="">No favorite selected</option><option v-for="level in favoriteOptions" :key="level.value" :value="level.value">{{level.label}}</option></select>
    <label>Profile background image URL</label><input class="hub-search" type="url" v-model.trim="backgroundUrl" maxlength="500" placeholder="https://..." />
    <button class="hub-fav-button" type="submit" :disabled="busy">Save profile</button>
  </form>
  <h2>Claim a leaderboard profile</h2><p class="hub-muted">Your account username alone does not establish ownership. Provide evidence for review by a CCL admin.</p>
  <form @submit.prevent="claim"><label>Leaderboard username</label><input class="hub-search" v-model.trim="claimName" required maxlength="32" placeholder="Exact leaderboard username" />
  <p v-if="claimName && leaderboardNames.length && !matchesLeaderboard" class="hub-muted">No matching username found in the current normal CCL leaderboard.</p>
  <label>Verification evidence</label><textarea class="hub-search" v-model.trim="evidence" required minlength="15" maxlength="1500" placeholder="Geometry Dash profile, links to your records, or how an admin can verify you"></textarea>
  <button class="hub-fav-button" type="submit" :disabled="busy || !matchesLeaderboard">Submit claim for review</button></form>
  <h2>Profile claims</h2><p v-if="!claims.length">No claims submitted yet.</p>
  <div v-for="claim in claims" :key="claim.leaderboard_username" class="hub-change"><strong>{{ claim.leaderboard_username }}</strong><span>{{ claim.status }}</span></div>
 </section>
 <section v-else class="hub-card ccl-auth-card">
  <div class="ccl-auth-heading"><span class="ccl-auth-eyebrow">CYRRY CHALLENGE LIST</span><h2>{{mode==='signup'?'Create your account':'Welcome back'}}</h2>
  <p class="hub-muted">{{mode==='signup'?'Join the community, track your records and join private clans.':'Log in to manage your profile, records and clan.'}}</p></div>
  <div class="leaderboard-switcher ccl-auth-switcher"><button type="button" :class="{active:mode==='login'}" @click="mode='login';error='';message='';password='';confirmPassword=''">Log In</button><button type="button" :class="{active:mode==='signup'}" @click="mode='signup';error='';message='';password='';confirmPassword=''">Sign Up</button></div>
  <form v-if="mode==='signup'" class="ccl-auth-form" @submit.prevent="signup">
    <div class="ccl-auth-field"><label for="signup-username">Username</label><input id="signup-username" class="hub-search" v-model.trim="username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_-]+" autocomplete="username" placeholder="Your CCL username"><small>3–24 characters · letters, numbers, _ and -</small></div>
    <div class="ccl-auth-field"><label for="signup-email">Email address</label><input id="signup-email" class="hub-search" type="email" v-model.trim="email" required maxlength="254" autocomplete="email" placeholder="you@example.com"></div>
    <div class="ccl-auth-field"><label for="signup-password">Password</label><input id="signup-password" class="hub-search" :type="showPassword?'text':'password'" v-model="password" required minlength="12" maxlength="256" autocomplete="new-password" placeholder="At least 12 characters"><small>Use a unique password of at least 12 characters.</small></div>
    <div class="ccl-auth-field"><label for="signup-confirm">Confirm password</label><input id="signup-confirm" class="hub-search" :type="showPassword?'text':'password'" v-model="confirmPassword" required minlength="12" maxlength="256" autocomplete="new-password" placeholder="Enter password again"></div>
    <label class="ccl-auth-check"><input type="checkbox" v-model="showPassword"> Show passwords</label>
    <p v-if="confirmPassword && password!==confirmPassword" class="hub-auth-error">Passwords do not match.</p>
    <button class="hub-fav-button ccl-auth-submit" type="submit" :disabled="busy || password!==confirmPassword">{{busy?'Creating account…':'Create Account →'}}</button>
    <p class="hub-muted ccl-auth-note">Already on the leaderboard? Claim your profile after creating your account. Claims require staff verification.</p>
  </form>
  <form v-else class="ccl-auth-form" @submit.prevent="signIn">
    <div class="ccl-auth-field"><label for="login-username">Username or email</label><input id="login-username" class="hub-search" v-model.trim="login" required autocomplete="username" placeholder="Username or email"></div>
    <div class="ccl-auth-field"><label for="login-password">Password</label><input id="login-password" class="hub-search" :type="showPassword?'text':'password'" v-model="password" required autocomplete="current-password" placeholder="Your password"></div>
    <label class="ccl-auth-check"><input type="checkbox" v-model="showPassword"> Show password</label>
    <button class="hub-fav-button ccl-auth-submit" type="submit" :disabled="busy">{{busy?'Signing in…':'Log In →'}}</button>
  </form>
 </section><p v-if="error" class="hub-auth-error" role="alert">{{ error }}</p><p v-if="message" role="status">{{ message }}</p>
 </main>`,
 computed: {
  matchesLeaderboard() { return this.leaderboardNames.some(x => x.toLowerCase() === this.claimName.toLowerCase()); },
  approvedClaim() { return this.claims.find(x => x.status === 'approved')?.leaderboard_username; }
 },
 async mounted() {
  try { const result = await api('/api/auth/me'); this.user=result.user; this.claims=result.claims || []; } catch(e) { this.error = e.message; }
  if(this.user)await this.loadProfile();
  try{const [normal,platformer]=await Promise.all([fetchList(),fetchList('_platformer.json')]);this.favoriteOptions=[...(normal||[]).map(x=>x[0]).filter(Boolean).map(x=>({value:x.path,label:'Classic · '+x.name})),...(platformer||[]).map(x=>x[0]).filter(Boolean).map(x=>({value:x.path,label:'Platformer · '+x.name}))];}catch(e){console.warn('Favorite level list unavailable',e);}
  try { const [[players], [creators]] = await Promise.all([fetchLeaderboard(),fetchCreatorLeaderboard()]); this.leaderboardNames = [...new Set([...players.map(x=>x.user),...creators.map(x=>x.user)])]; } catch(e) { console.error(e); }
 },
 methods: {
  async loadProfile() {
    try {
      const name=this.approvedClaim||this.user?.username;
      const res=await api('/api/community/profile?username='+encodeURIComponent(name));
      const p=res.profile||{};this.bio=p.bio||'';this.avatarUrl=p.avatar_url||'';this.bannerUrl=p.banner_url||'';this.accent=p.accent||'#477bc1';this.favoriteLevel=p.favorite_level||'';this.showcaseLevel=p.showcase_level||'';this.featuredBadge=p.featured_badge||'';this.backgroundUrl=p.background_url||'';
    }catch(e){console.warn('Profile customization unavailable',e)}
  },
  async saveProfile(){await this.action(async()=>{await api('/api/community/profile',{bio:this.bio,avatar_url:this.avatarUrl,banner_url:this.bannerUrl,accent:this.accent,favorite_level:this.favoriteLevel,showcase_level:'',featured_badge:'',background_url:this.backgroundUrl});this.message='Profile saved.'})},
  async signup() { if(this.password!==this.confirmPassword){this.error='Passwords do not match.';return;} await this.action(async()=>{ const result=await api('/api/auth/register',{username:this.username,email:this.email,password:this.password}); this.user=result.user; await store.refreshAuth(); this.claimName=this.username; this.password='';this.confirmPassword=''; this.message='Account created. Claim your leaderboard profile below if applicable.'; }); },
  async signIn() { await this.action(async()=>{ const result=await api('/api/auth/login',{login:this.login,password:this.password}); this.password=''; this.user=result.user; await store.refreshAuth(); const me=await api('/api/auth/me'); this.claims=me.claims||[]; await this.loadProfile();this.message='Logged in successfully.'; }); },
  async claim() { await this.action(async()=>{ await api('/api/claims',{username:this.claimName,evidence:this.evidence}); const me=await api('/api/auth/me'); this.claims=me.claims||[]; this.evidence=''; this.message='Claim submitted for admin review.'; }); },
  async logout() { await this.action(async()=>{ await api('/api/auth/logout',{}); this.user=null; await store.refreshAuth(); this.claims=[]; this.message='Logged out.'; }); },
  async action(fn) { this.busy=true; this.error=''; this.message=''; try { await fn(); } catch(e) { this.error=e.message; } finally { this.busy=false; } }
 }
};
