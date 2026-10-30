async function api(path, method = 'GET', payload) {
    const response = await fetch(path, {
        method, credentials: 'same-origin',
        headers: payload ? { 'content-type': 'application/json' } : {},
        body: payload ? JSON.stringify(payload) : undefined,
        cache: 'no-store'
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
}

export default {
    data: () => ({
        role: '', tab: 'claims', claims: [], levelProposals:[], users: [], levelFiles: [], audit: [], submissions: [], weeklyEntries: [], enjoymentRecords: [], enjoymentList:'normal', enjoymentLevel:'', enjoymentFiles:[], enjoymentUsername:'', enjoymentValue:5,
        listType: 'normal', levelPath: '', levelText: '', originalLevelText: '', backupStatus:null, backupLoading:false, reviewFeedback:{}, bulkSelected:[],bulkDrafts:{},bulkOriginals:{},bulkActive:'',bulkLoading:false,
        filter: '', userFilter: '', weeklyWeek: '', weeklyTitle: '', weeklyDescription: '', loading: true, busy: false, error: '', notice: ''
    }),
    computed: {
        canReview() { return ['owner', 'admin', 'moderator'].includes(this.role); },
        canEdit() { return ['owner', 'admin', 'editor'].includes(this.role); },
        canManage() { return this.role === 'owner'; },
        filteredFiles() {
            return this.levelFiles.filter(x => x.toLowerCase().includes(this.filter.toLowerCase()));
        },
        filteredUsers() {
            return this.users.filter(u => u.username.toLowerCase().includes(this.userFilter.toLowerCase()));
        },
        bulkChangedCount(){return Object.keys(this.bulkDrafts).filter(p=>this.bulkDrafts[p]!==this.bulkOriginals[p]).length;},
        bulkErrors(){return Object.entries(this.bulkDrafts).filter(([p,v])=>v!==this.bulkOriginals[p]).flatMap(([p,v])=>{try{JSON.parse(v);return [];}catch(e){return [p+': '+e.message];}});},
        hasUnsavedChanges() { return !!this.levelPath && this.levelText !== this.originalLevelText; },
        jsonError() {
            if (!this.levelText.trim()) return 'JSON cannot be empty.';
            try { JSON.parse(this.levelText); return ''; }
            catch (e) { return e.message; }
        }
    },
    template: `
    <main class="ccl-hub ccl-admin">
      <section class="hub-head admin-heading">
        <div><p class="admin-eyebrow">STAFF WORKSPACE</p><h1>Admin Dashboard</h1>
          <p>Manage claims, level data, and staff access.</p></div>
        <span v-if="role" class="admin-role-pill">{{ role }}</span>
      </section>
      <p v-if="loading" class="admin-status">Checking permissions…</p>
      <section v-else-if="!role" class="hub-card admin-panel">
        <h2>Access restricted</h2>
        <p>Sign in with an authorized staff account to access the dashboard.</p>
        <router-link class="hub-profile-link" to="/account">Account settings →</router-link>
      </section>
      <template v-else>
        <nav class="admin-tabs" aria-label="Admin sections">
          <button v-if="canReview" type="button" :class="{active:tab==='claims'}" @click="switchTab('claims')">
            Profile claims <span class="admin-tab-count">{{claims.length}}</span>
          </button>
          <button v-if="canReview" type="button" :class="{active:tab==='submissions'}" @click="switchTab('submissions')">Record reviews</button>
          <button v-if="canReview" type="button" :class="{active:tab==='proposals'}" @click="switchTab('proposals')">Level / verification proposals</button>
          <button v-if="canEdit || canReview" type="button" :class="{active:tab==='enjoyment'}" @click="switchTab('enjoyment')">Enjoyment ratings</button>
          <button v-if="canReview" type="button" :class="{active:tab==='weekly'}" @click="switchTab('weekly')">Weekly challenges</button>
          <button v-if="canManage || role==='admin'" type="button" :class="{active:tab==='audit'}" @click="switchTab('audit')">Activity log</button>
          <button v-if="canEdit" type="button" :class="{active:tab==='levels'}" @click="switchTab('levels')">Level editor</button>
          <button v-if="canManage" type="button" :class="{active:tab==='users'}" @click="switchTab('users')">Staff roles</button>
        </nav>
        <section v-if="tab==='claims' && canReview" class="hub-card admin-panel">
          <div class="admin-section-head"><div><h2>Profile claims</h2>
            <p class="hub-muted">Verify account ownership before approving a request.</p></div>
            <button class="admin-btn admin-btn-secondary" type="button" :disabled="busy" @click="loadClaims">↻ Refresh</button>
          </div>
          <div v-if="!claims.length" class="admin-empty"><strong>All caught up</strong><p>No pending claims to review.</p></div>
          <div v-else class="admin-claim-list">
            <article class="admin-claim" v-for="c in claims" :key="c.id">
              <div class="admin-claim-top"><div><span class="admin-eyebrow">CLAIMED PROFILE</span>
                <h3>{{c.leaderboard_username}}</h3></div><span class="admin-pending">Pending</span></div>
              <div class="admin-claim-details"><div><small>Account</small><strong>{{c.account_username}}</strong></div>
                <div><small>Email</small><span>{{c.email}}</span></div>
                <div><small>Submitted</small><span>{{c.created_at}}</span></div></div>
              <div class="admin-evidence-label">Verification evidence</div>
              <pre class="admin-evidence">{{c.evidence}}</pre>
              <div class="admin-actions">
                <button class="admin-btn admin-btn-approve" :disabled="busy" @click="review(c,'approved')">✓ Approve</button>
                <button class="admin-btn admin-btn-reject" :disabled="busy" @click="review(c,'rejected')">Reject</button>
              </div>
            </article>
          </div>
        </section>
        <section v-if="tab==='submissions' && canReview" class="hub-card admin-panel">
          <div class="admin-section-head"><h2>Pending record submissions</h2><button class="admin-btn" :disabled="busy" @click="loadSubmissions">Refresh</button></div>
          <p class="hub-muted">Approving a verified submission updates the public list record automatically. Check video proof carefully before approval.</p>
          <p v-if="!submissions.length" class="admin-empty">No pending records.</p>
          <article v-for="s in submissions" :key="s.id" class="admin-claim">
            <h3>{{s.leaderboard_username}} — {{s.level_path.replaceAll('_',' ')}}</h3>
            <p>{{s.list_type}} · {{s.percent}}% · {{s.created_at}}</p>
            <p><strong>Discord:</strong> {{s.discord_name}} · <strong>Enjoyment:</strong> {{s.enjoyment}}/10</p>
            <p v-if="s.note">{{s.note}}</p>
            <a :href="s.video_url" target="_blank" rel="noopener noreferrer">Watch video evidence ↗</a>
            <label :for="'feedback-'+s.id">Staff feedback</label><textarea :id="'feedback-'+s.id" class="hub-search" v-model="reviewFeedback[s.id]" maxlength="1000" rows="2" placeholder="Optional approval notes or rejection reason"></textarea><div class="admin-actions"><button class="admin-btn admin-btn-approve" :disabled="busy" @click="reviewRecord(s,'approved')">Approve</button><button class="admin-btn admin-btn-reject" :disabled="busy" @click="reviewRecord(s,'rejected')">Reject</button></div>
          </article>
        </section>
        <section v-if="tab==='proposals' && canReview" class="hub-card admin-panel">
         <div class="admin-section-head"><h2>Level & verification proposals</h2><button class="admin-btn" @click="loadLevelProposals" :disabled="busy">Refresh</button></div>
         <p class="hub-muted">Review proof and decide whether to accept the suggestion. Approval records the decision but does not automatically change the level list; editors must make those changes separately.</p>
         <p v-if="!levelProposals.length">No pending proposals.</p>
         <article v-for="p in levelProposals" :key="p.id" class="admin-claim">
          <h3>{{p.level_name}} · {{p.kind}}</h3><p>{{p.list_type}} · ID {{p.level_id||'Not provided'}} · Creator {{p.creator}}</p>
          <p>Submitted by {{p.account_username}} on {{p.created_at}}</p><p v-if="p.notes">{{p.notes}}</p>
          <a :href="p.proof_url" target="_blank" rel="noopener noreferrer">View proof ↗</a>
          <div class="admin-actions"><button class="admin-btn admin-btn-approve" :disabled="busy" @click="reviewLevelProposal(p,'approved')">Approve</button><button class="admin-btn admin-btn-reject" :disabled="busy" @click="reviewLevelProposal(p,'rejected')">Reject</button></div>
         </article>
        </section>
        <section v-if="tab==='enjoyment' && (canEdit || canReview)" class="hub-card admin-panel">
          <h2>Manage enjoyment ratings</h2><p class="hub-muted">Add or change a 0–10 enjoyment rating for any existing level record. Changes update the level and Community Enjoyment Rankings immediately after saving.</p>
          <div class="admin-editor">
            <label>List</label><select v-model="enjoymentList" @change="loadEnjoymentFiles"><option value="normal">Normal CCL</option><option value="platformer">Platformer CCL</option></select>
            <label>Level</label><select v-model="enjoymentLevel" @change="loadEnjoymentRecords"><option value="">Select a level</option><option v-for="name in enjoymentFiles" :key="name" :value="name">{{name.replaceAll('_',' ')}}</option></select>
            <template v-if="enjoymentLevel">
              <p v-if="!enjoymentRecords.length" class="hub-muted">No records found on this level.</p>
              <form v-else @submit.prevent="saveEnjoyment">
                <label>Player with an existing record</label><select v-model="enjoymentUsername" @change="syncEnjoymentValue" required><option value="">Select player</option><option v-for="rec in enjoymentRecords" :key="rec.username" :value="rec.username">{{rec.username}} · {{rec.percent}}% · {{rec.enjoyment===null?'Unrated':rec.enjoyment+'/10'}}</option></select>
                <label>Enjoyment (0–10)</label><input v-model.number="enjoymentValue" type="number" min="0" max="10" step="1" required />
                <button class="admin-btn admin-btn-primary" type="submit" :disabled="busy || !enjoymentUsername">Save enjoyment rating</button>
              </form>
            </template>
          </div>
        </section>
        <section v-if="tab==='weekly' && canReview" class="hub-card admin-panel">
          <h2>Weekly challenge entries</h2><p v-if="!weeklyEntries.length" class="admin-empty">No pending entries.</p>
          <article v-for="e in weeklyEntries" :key="e.id" class="admin-claim">
            <h3>{{e.username}} — {{e.title}}</h3><a :href="e.video_url" target="_blank" rel="noopener noreferrer">Watch proof ↗</a>
            <div class="admin-actions"><button class="admin-btn admin-btn-approve" :disabled="busy" @click="reviewWeekly(e,'approved')">Approve</button><button class="admin-btn admin-btn-reject" :disabled="busy" @click="reviewWeekly(e,'rejected')">Reject</button></div>
          </article>
          <div v-if="canEdit" class="admin-editor"><h3>Publish a weekly challenge</h3>
            <p class="hub-muted">Choose a Monday (UTC) and a level. One challenge per week.</p>
            <form @submit.prevent="publishWeekly">
              <label>Week starting Monday (UTC)</label><input v-model="weeklyWeek" type="date" required />
              <label>Title</label><input v-model.trim="weeklyTitle" maxlength="100" required />
              <label>Description</label><textarea v-model.trim="weeklyDescription" maxlength="500" rows="3"></textarea>
              <label>List</label><select v-model="listType" @change="changeList"><option value="normal">Normal CCL</option><option value="platformer">Platformer CCL</option></select>
              <label>Level</label><select v-model="levelPath" required><option value="">Select level</option><option v-for="f in levelFiles" :key="f" :value="f">{{f.replaceAll('_',' ')}}</option></select>
              <button class="admin-btn admin-btn-primary" :disabled="busy">Publish challenge</button>
            </form>
          </div>
        </section>
        <section v-if="tab==='audit' && (canManage || role==='admin')" class="hub-card admin-panel">
          <div class="admin-section-head"><h2>Staff activity log</h2><button class="admin-btn" :disabled="busy" @click="loadAudit">Refresh</button></div>
          <p class="hub-muted">Most recent 200 actions. Entries are preserved for accountability.</p>
          <p v-if="!audit.length" class="admin-empty">No activity recorded yet.</p>
          <div v-for="a in audit" :key="a.id" class="hub-change"><strong>{{a.action.replaceAll('_',' ')}} · {{a.actor||'Deleted account'}}</strong><span>{{a.created_at}}</span><small>{{a.target}}</small></div>
        </section>
        <section v-if="tab==='levels' && canEdit" class="hub-card admin-panel">
          <div class="admin-section-head"><div><h2>Level editor</h2>
            <p class="hub-muted">Edit level data and automatically back up changes to GitHub when configured.</p></div>
            <span class="admin-subtle-pill">{{levelFiles.length}} levels</span></div>
          <div class="hub-card" style="margin-bottom:1rem">
            <h3>GitHub Backup Center</h3>
            <p class="hub-muted">Check the latest backup status for your saved D1 level edits. Backups require a GITHUB_TOKEN runtime secret.</p>
            <div class="admin-actions">
              <button type="button" class="admin-btn" :disabled="backupLoading" @click="loadBackupStatus">Check backup status</button>
              <button type="button" class="admin-btn admin-btn-secondary" :disabled="busy" @click="backupAllLevels">Back up all saved level edits to GitHub</button>
            </div>
            <p v-if="backupLoading">Checking backup status…</p>
            <template v-if="backupStatus">
              <p><strong>{{backupStatus.total}}</strong> saved level overrides · {{backupStatus.levels.filter(x=>x.github_synced).length}} latest changes confirmed backed up</p>
              <p v-if="!backupStatus.configured" class="error">GITHUB_TOKEN is not configured as a Worker runtime secret.</p>
              <div v-for="level in backupStatus.levels.filter(x=>!x.github_synced).slice(0,30)" :key="level.list_type+level.level_path" class="hub-change">
                <strong>{{level.list_type}} / {{level.level_path}}</strong><span>Backup not confirmed · Last edit: {{level.updated_at}}</span>
              </div>
            </template>
          </div>
          <div class="hub-card ccl-bulk-editor">
            <h3>Bulk Level Editor</h3><p class="hub-muted">Select up to 30 levels, edit their JSON, then save all modified levels together.</p>
            <div class="admin-actions"><button class="admin-btn" :disabled="busy||bulkLoading" @click="loadBulkDrafts">Load selected levels</button><button class="admin-btn admin-btn-primary" :disabled="busy||bulkLoading||!bulkChangedCount||bulkErrors.length" @click="saveBulkLevels">Save {{bulkChangedCount}} changed levels</button></div>
            <div class="ccl-bulk-picker"><label v-for="f in filteredFiles" :key="f"><input type="checkbox" :checked="bulkSelected.includes(f)" :disabled="!bulkSelected.includes(f)&&bulkSelected.length>=30" @change="toggleBulk(f,$event.target.checked)"> {{f.replaceAll('_',' ')}}</label></div>
            <p>{{bulkSelected.length}} / 30 selected · {{bulkChangedCount}} modified</p>
            <div v-if="Object.keys(bulkDrafts).length">
              <label for="bulk-active-level">Edit draft</label><select id="bulk-active-level" v-model="bulkActive"><option v-for="p in Object.keys(bulkDrafts)" :key="p" :value="p">{{p.replaceAll('_',' ')}}{{bulkDrafts[p]!==bulkOriginals[p]?' ●':''}}</option></select>
              <textarea v-if="bulkActive" class="admin-json" v-model="bulkDrafts[bulkActive]" spellcheck="false"></textarea>
              <p v-for="e in bulkErrors" :key="e" class="admin-validation" role="alert">{{e}}</p>
              <button class="admin-btn" :disabled="!bulkActive" @click="bulkDrafts[bulkActive]=bulkOriginals[bulkActive]">Reset current draft</button>
            </div>
          </div>
          <div class="admin-editor-controls">
            <div class="admin-field"><label for="admin-list-type">List</label>
              <select id="admin-list-type" v-model="listType" :disabled="busy" @change="changeList">
                <option value="normal">Normal CCL</option><option value="platformer">Platformer CCL</option>
              </select></div>
            <div class="admin-field"><label for="admin-level-search">Search levels</label>
              <input id="admin-level-search" v-model="filter" placeholder="Filter by level name…" /></div>
            <div class="admin-field admin-field-full"><label for="admin-level-select">Select level</label>
              <select id="admin-level-select" v-model="levelPath" :disabled="busy" @change="loadLevel">
                <option value="">Choose a level to edit</option>
                <option v-for="f in filteredFiles" :key="f" :value="f">{{f.replaceAll('_',' ')}}</option>
              </select></div>
          </div>
          <div v-if="levelPath" class="admin-editor">
            <div class="admin-section-head"><div><h3>{{levelPath.replaceAll('_',' ')}}</h3>
              <p class="hub-muted">Edit the JSON below, then save your changes.</p></div>
              <span v-if="hasUnsavedChanges" class="admin-unsaved">● Unsaved changes</span></div>
            <textarea class="admin-json" v-model="levelText" spellcheck="false" aria-label="Level JSON"></textarea>
            <p v-if="jsonError" class="admin-validation" role="alert">{{jsonError}}</p>
            <div class="admin-actions">
              <button class="admin-btn admin-btn-primary" :disabled="busy || !hasUnsavedChanges || !!jsonError" @click="saveLevel">Save changes</button>
              <button class="admin-btn admin-btn-secondary" :disabled="busy || !hasUnsavedChanges" @click="resetLevel">Discard changes</button>
            </div>
            <p class="hub-muted">Saved changes appear on the public list after refresh. GitHub backup status is shown after saving.</p>
          </div>
          <div v-else class="admin-empty"><strong>Select a level to begin</strong><p>Choose a list and level above to load its data.</p></div>
        </section>
        <section v-if="tab==='users' && canManage" class="hub-card admin-panel">
          <div class="admin-section-head"><div><h2>Staff roles</h2>
            <p class="hub-muted">Only owners can change account permissions.</p></div>
            <span class="admin-subtle-pill">{{users.length}} accounts</span></div>
          <div class="admin-field"><label for="admin-user-search">Find an account</label>
            <input id="admin-user-search" v-model="userFilter" placeholder="Search by username…" /></div>
          <div class="admin-users">
            <div class="admin-user admin-user-head"><span>Username</span><span>Current role</span><span>Change role</span><span>Actions</span></div>
            <div v-for="u in filteredUsers" :key="u.id" class="admin-user">
              <strong>{{u.username}}</strong><span class="admin-subtle-pill">{{u.role||'member'}}</span>
              <select :value="u.role||'member'" :disabled="busy"
                @change="setRole(u,$event.target.value);$event.target.value=u.role||'member'">
                <option value="member">Member</option><option value="moderator">Moderator</option>
                <option value="editor">Editor</option><option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
              <button class="admin-btn admin-btn-reject admin-delete-account" type="button"
                :disabled="busy || u.role==='owner'"
                :title="u.role==='owner' ? 'Reassign owner role before deleting' : 'Permanently delete this account'"
                @click="deleteAccount(u)">Delete</button>
            </div>
            <p v-if="!filteredUsers.length" class="admin-empty">No matching accounts.</p>
          </div>
        </section>
      </template>
      <p v-if="error" class="hub-auth-error admin-flash" role="alert">{{error}}</p>
      <p v-if="notice" class="admin-flash admin-success" role="status">{{notice}}</p>
    </main>`,
    async mounted() {
        try {
            const me = await api('/api/admin/me');
            this.role = me.role || '';
            if (this.canReview) await this.loadClaims();
            else if (this.canEdit) { this.tab = 'levels'; await this.loadFiles(); }
        } catch (e) { this.error = e.message; }
        finally { this.loading = false; }
    },
    methods: {
        async run(fn) {
            this.error = ''; this.notice = ''; this.busy = true;
            try { await fn(); } catch (e) { this.error = e.message; }
            finally { this.busy = false; }
        },
        async switchTab(tab) {
            if (tab === this.tab) return;
            if (this.hasUnsavedChanges && !confirm('Discard unsaved level changes?')) return;
            this.tab = tab;
            if (tab === 'claims') await this.loadClaims();
            if (tab === 'levels') await this.loadFiles();
            if (tab === 'users') await this.loadUsers();
            if (tab === 'submissions') await this.loadSubmissions();
            if (tab === 'proposals') await this.loadLevelProposals();
            if (tab === 'enjoyment') await this.loadEnjoymentFiles();
            if (tab === 'weekly') { await Promise.all([this.loadWeeklyEntries(),this.loadFiles()]); }
            if (tab === 'audit') await this.loadAudit();
        },
        async loadLevelProposals(){await this.run(async()=>{this.levelProposals=(await api('/api/admin/level-proposals')).proposals||[];});},
        async reviewLevelProposal(p,status){if(!confirm(status+' proposal for '+p.level_name+'?'))return;await this.run(async()=>{const r=await api('/api/admin/level-proposals/review','POST',{id:p.id,status});this.levelProposals=this.levelProposals.filter(x=>x.id!==p.id);this.notice=r.notice||'Proposal '+status+'.';});},
        async loadClaims() { await this.run(async () => { this.claims = (await api('/api/admin/claims')).claims || []; }); },
        async review(c, status) {
            if (!confirm((status === 'approved' ? 'Approve ' : 'Reject ') + c.leaderboard_username + '?')) return;
            await this.run(async () => {
                await api('/api/admin/claims/review', 'POST', { id: c.id, status });
                this.claims = this.claims.filter(x => x.id !== c.id);
                this.notice = 'Claim ' + status + '.';
            });
        },
        async loadFiles() {
            await this.run(async () => {
                const file = this.listType === 'platformer' ? '_platformer.json' : '_list.json';
                const response = await fetch('/data/' + file);
                if (!response.ok) throw new Error('Could not load level list.');
                this.levelFiles = await response.json();
            });
        },
        async changeList() {
            if (this.hasUnsavedChanges && !confirm('Discard unsaved level changes?')) return;
            this.levelPath = ''; this.levelText = ''; this.originalLevelText = '';
            this.filter = '';this.bulkSelected=[];this.bulkDrafts={};this.bulkOriginals={};this.bulkActive=''; await this.loadFiles();
        },
        async loadLevel() {
            if (!this.levelPath) { this.levelText = ''; this.originalLevelText = ''; return; }
            await this.run(async () => {
                const result = await api('/api/levels/overrides?list=' + this.listType);
                let level = result.levels[this.levelPath];
                if (!level) {
                    const response = await fetch('/data/' + encodeURIComponent(this.levelPath) + '.json');
                    if (!response.ok) throw new Error('Level file not found.');
                    level = await response.json();
                }
                this.levelText = JSON.stringify(level, null, 2);
                this.originalLevelText = this.levelText;
            });
        },
        resetLevel() { if (confirm('Discard unsaved changes?')) this.levelText = this.originalLevelText; },
        backupNotice(message,backup) {
            if(!backup)return message;
            return message+(backup.synced?' GitHub backup completed.':' GitHub backup pending: '+(backup.reason||'Unknown error')+' Use the backup button after fixing the issue.');
        },
        async loadBackupStatus(){
            this.backupLoading=true;this.error='';
            try{this.backupStatus=await api('/api/admin/github-backup/status');}
            catch(e){this.error=e.message;}finally{this.backupLoading=false;}
        },
        async backupAllLevels() {
            if(!confirm('Back up all saved level overrides to GitHub? This updates the corresponding repository JSON files.'))return;
            await this.run(async()=>{
                const result=await api('/api/admin/github-backup','POST',{});
                this.notice=result.synced+' of '+result.total+' level files backed up to GitHub.'+(result.failed?.length?' '+result.failed.length+' failed: '+result.failed.slice(0,3).map(x=>x.path+' ('+x.reason+')').join('; '):'');await this.loadBackupStatus();
            });
        },
        toggleBulk(path,checked){if(checked){if(this.bulkSelected.length<30)this.bulkSelected.push(path);}else{this.bulkSelected=this.bulkSelected.filter(p=>p!==path);delete this.bulkDrafts[path];delete this.bulkOriginals[path];if(this.bulkActive===path)this.bulkActive=Object.keys(this.bulkDrafts)[0]||'';}},
        async loadBulkDrafts(){
            if(!this.bulkSelected.length){this.error='Select levels first.';return;}
            if(this.bulkChangedCount&&!confirm('Discard existing bulk drafts?'))return;
            this.bulkLoading=true;this.error='';
            try{const result=await api('/api/levels/overrides?list='+this.listType),drafts={};
                for(const path of this.bulkSelected){let level=result.levels[path];if(!level){const response=await fetch('/data/'+encodeURIComponent(path)+'.json');if(!response.ok)throw Error('Could not load '+path);level=await response.json();}drafts[path]=JSON.stringify(level,null,2);}
                this.bulkDrafts=drafts;this.bulkOriginals={...drafts};this.bulkActive=this.bulkSelected[0];
            }catch(e){this.error=e.message;}finally{this.bulkLoading=false;}
        },
        async saveBulkLevels(){
            if(this.bulkErrors.length||!this.bulkChangedCount)return;
            const levels=Object.keys(this.bulkDrafts).filter(p=>this.bulkDrafts[p]!==this.bulkOriginals[p]).map(path=>({path,level:JSON.parse(this.bulkDrafts[path])}));
            if(!confirm('Save '+levels.length+' level changes together?'))return;
            await this.run(async()=>{const result=await api('/api/admin/levels/bulk','POST',{listType:this.listType,levels});this.bulkOriginals={...this.bulkDrafts};const failed=result.backups.filter(x=>!x.synced);this.notice=result.saved+' levels saved to D1. '+(failed.length?failed.length+' GitHub backups pending.':'All GitHub backups confirmed.');});
        },
        async saveLevel() {
            if (this.jsonError || !this.hasUnsavedChanges || !confirm('Save changes to ' + this.levelPath + '?')) return;
            await this.run(async () => {
                const result=await api('/api/admin/levels', 'POST', { listType: this.listType, path: this.levelPath, level: JSON.parse(this.levelText) });
                this.originalLevelText = this.levelText;
                this.notice = this.backupNotice('Level changes saved to D1.',result.githubBackup);
            });
        },
        async loadEnjoymentFiles() {
            this.enjoymentLevel='';this.enjoymentRecords=[];this.enjoymentUsername='';
            await this.run(async()=>{const response=await fetch('/data/'+(this.enjoymentList==='normal'?'_list.json':'_platformer.json'));if(!response.ok)throw Error('Could not load level list');this.enjoymentFiles=await response.json()});
        },
        async loadEnjoymentRecords() {
            this.enjoymentUsername='';this.enjoymentRecords=[];
            if(!this.enjoymentLevel)return;
            await this.run(async()=>{const result=await api('/api/admin/enjoyment?list='+encodeURIComponent(this.enjoymentList)+'&level='+encodeURIComponent(this.enjoymentLevel));this.enjoymentRecords=result.records||[]});
        },
        syncEnjoymentValue() {
            const record=this.enjoymentRecords.find(x=>x.username===this.enjoymentUsername);
            this.enjoymentValue=record?.enjoyment??5;
        },
        async saveEnjoyment() {
            if(!Number.isInteger(this.enjoymentValue)||this.enjoymentValue<0||this.enjoymentValue>10){this.error='Enjoyment must be a whole number between 0 and 10.';return;}
            await this.run(async()=>{
                const saved=await api('/api/admin/enjoyment','POST',{listType:this.enjoymentList,levelPath:this.enjoymentLevel,username:this.enjoymentUsername,enjoyment:this.enjoymentValue});
                const result=await api('/api/admin/enjoyment?list='+encodeURIComponent(this.enjoymentList)+'&level='+encodeURIComponent(this.enjoymentLevel));
                this.enjoymentRecords=result.records||[];
                this.notice=this.backupNotice('Enjoyment rating saved for '+this.enjoymentUsername+'.',saved.githubBackup);
            });
        },
        async loadSubmissions() { await this.run(async()=>{this.submissions=(await api('/api/admin/submissions')).submissions||[]}) },
        async reviewRecord(item,status) {
            if(!confirm(status+' record for '+item.leaderboard_username+'?'))return;
            await this.run(async()=>{const result=await api('/api/admin/submissions/review','POST',{id:item.id,status,feedback:this.reviewFeedback[item.id]||''});this.submissions=this.submissions.filter(s=>s.id!==item.id);this.notice=this.backupNotice('Record '+status+'. Approved records are applied to the public list.',result.githubBackup)});
        },
        async loadWeeklyEntries() { await this.run(async()=>{this.weeklyEntries=(await api('/api/admin/weekly/entries')).entries||[]}) },
        async reviewWeekly(item,status) {
            if(!confirm(status+' weekly entry for '+item.username+'?'))return;
            await this.run(async()=>{await api('/api/admin/weekly/review','POST',{id:item.id,status});this.weeklyEntries=this.weeklyEntries.filter(e=>e.id!==item.id);this.notice='Weekly entry '+status+'.'});
        },
        async publishWeekly() {
            await this.run(async()=>{await api('/api/admin/weekly','POST',{weekStart:this.weeklyWeek,listType:this.listType,levelPath:this.levelPath,title:this.weeklyTitle,description:this.weeklyDescription});this.notice='Weekly challenge published.';this.weeklyTitle='';this.weeklyDescription=''});
        },
        async loadAudit() { await this.run(async()=>{this.audit=(await api('/api/admin/audit')).entries||[]}) },
        async loadUsers() { await this.run(async () => { this.users = (await api('/api/admin/users')).users || []; }); },
        async deleteAccount(u) {
            if (u.role === 'owner') return;
            const typed = prompt('Permanently delete account "' + u.username + '"? This removes login access, sessions, and profile claims. Type the exact username to confirm:');
            if (typed === null) return;
            if (typed !== u.username) { this.error = 'Username confirmation did not match. Nothing was deleted.'; return; }
            if (!confirm('FINAL WARNING: Permanently delete ' + u.username + '? This cannot be undone.')) return;
            await this.run(async () => {
                await api('/api/admin/users/delete', 'POST', { userId: u.id, confirmUsername: typed });
                this.users = this.users.filter(account => account.id !== u.id);
                this.notice = 'Account ' + u.username + ' was permanently deleted.';
            });
        },
        async setRole(u, role) {
            if (role === (u.role || 'member') || !confirm('Change ' + u.username + ' to ' + role + '?')) return;
            await this.run(async () => {
                await api('/api/admin/roles', 'POST', { userId: u.id, role });
                this.users = (await api('/api/admin/users')).users || [];
                this.notice = 'Updated role for ' + u.username + '.';
            });
        }
    }
};
