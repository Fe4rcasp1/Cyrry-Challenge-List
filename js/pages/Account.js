import { fetchLeaderboard, fetchCreatorLeaderboard } from '../content.js';
async function api(path, data) {
 const res = await fetch(path, { method: data ? 'POST' : 'GET', credentials: 'same-origin', headers: data ? { 'content-type':'application/json' } : {}, body: data ? JSON.stringify(data) : undefined });
 const result = await res.json();
 if (!res.ok) throw new Error(result.error || 'Request failed.');
 return result;
}
export default {
 data: () => ({ mode:'login', username:'', email:'', password:'', login:'', evidence:'', claimName:'', user:null, claims:[], leaderboardNames:[], busy:false, message:'', error:'' }),
 template: `
 <main class="ccl-hub"><section class="hub-head"><h1>CCL Account</h1><p>Sign in to your account from any device. Leaderboard profile claims require approval.</p></section>
 <section v-if="user" class="hub-card">
  <h2>Welcome, {{ user.username }}</h2><p>Signed in as {{ user.email }}</p>
  <router-link :to="'/player/' + encodeURIComponent(approvedClaim || user.username)" class="hub-profile-link">View player profile →</router-link>
  <button class="hub-fav-button" @click="logout">Log Out</button>
  <h2>Claim a leaderboard profile</h2><p class="hub-muted">Your account username alone does not establish ownership. Provide evidence for review by a CCL admin.</p>
  <form @submit.prevent="claim"><label>Leaderboard username</label><input class="hub-search" v-model.trim="claimName" required maxlength="32" placeholder="Exact leaderboard username" />
  <p v-if="claimName && leaderboardNames.length && !matchesLeaderboard" class="hub-muted">No matching username found in the current normal CCL leaderboard.</p>
  <label>Verification evidence</label><textarea class="hub-search" v-model.trim="evidence" required minlength="15" maxlength="1500" placeholder="Geometry Dash profile, links to your records, or how an admin can verify you"></textarea>
  <button class="hub-fav-button" type="submit" :disabled="busy || !matchesLeaderboard">Submit claim for review</button></form>
  <h2>Profile claims</h2><p v-if="!claims.length">No claims submitted yet.</p>
  <div v-for="claim in claims" :key="claim.leaderboard_username" class="hub-change"><strong>{{ claim.leaderboard_username }}</strong><span>{{ claim.status }}</span></div>
 </section>
 <section v-else class="hub-card">
  <div class="leaderboard-switcher"><button type="button" :class="{ active: mode === 'login' }" @click="mode='login';error='';message=''">Log In</button><button type="button" :class="{ active: mode === 'signup' }" @click="mode='signup';error='';message=''">Sign Up</button></div>
  <form v-if="mode === 'signup'" @submit.prevent="signup">
    <label>Username</label><input class="hub-search" v-model.trim="username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_-]+" autocomplete="username" />
    <label>Email</label><input class="hub-search" type="email" v-model.trim="email" required autocomplete="email" />
    <label>Password (12+ characters)</label><input class="hub-search" type="password" v-model="password" required minlength="12" autocomplete="new-password" />
    <p class="hub-muted">Matching a leaderboard username does not automatically claim that profile. Claims are verified after signup.</p>
    <button class="hub-fav-button" type="submit" :disabled="busy">Create Account</button>
  </form>
  <form v-else @submit.prevent="signIn">
    <label>Username or email</label><input class="hub-search" v-model.trim="login" required autocomplete="username" />
    <label>Password</label><input class="hub-search" type="password" v-model="password" required autocomplete="current-password" />
    <button class="hub-fav-button" type="submit" :disabled="busy">Log In</button>
  </form>
 </section><p v-if="error" class="hub-auth-error" role="alert">{{ error }}</p><p v-if="message" role="status">{{ message }}</p>
 </main>`,
 computed: {
  matchesLeaderboard() { return this.leaderboardNames.some(x => x.toLowerCase() === this.claimName.toLowerCase()); },
  approvedClaim() { return this.claims.find(x => x.status === 'approved')?.leaderboard_username; }
 },
 async mounted() {
  try { const result = await api('/api/auth/me'); this.user=result.user; this.claims=result.claims || []; } catch(e) { this.error = e.message; }
  try { const [[players], [creators]] = await Promise.all([fetchLeaderboard(),fetchCreatorLeaderboard()]); this.leaderboardNames = [...new Set([...players.map(x=>x.user),...creators.map(x=>x.user)])]; } catch(e) { console.error(e); }
 },
 methods: {
  async signup() { await this.action(async()=>{ const result=await api('/api/auth/register',{username:this.username,email:this.email,password:this.password}); this.user=result.user; this.claimName=this.username; this.password=''; this.message='Account created. Claim your leaderboard profile below if applicable.'; }); },
  async signIn() { await this.action(async()=>{ const result=await api('/api/auth/login',{login:this.login,password:this.password}); this.password=''; this.user=result.user; const me=await api('/api/auth/me'); this.claims=me.claims||[]; this.message='Logged in successfully.'; }); },
  async claim() { await this.action(async()=>{ await api('/api/claims',{username:this.claimName,evidence:this.evidence}); const me=await api('/api/auth/me'); this.claims=me.claims||[]; this.evidence=''; this.message='Claim submitted for admin review.'; }); },
  async logout() { await this.action(async()=>{ await api('/api/auth/logout',{}); this.user=null; this.claims=[]; this.message='Logged out.'; }); },
  async action(fn) { this.busy=true; this.error=''; this.message=''; try { await fn(); } catch(e) { this.error=e.message; } finally { this.busy=false; } }
 }
};
