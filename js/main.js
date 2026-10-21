import routes from './routes.js';

export const store = Vue.reactive({
    user: null,
    profileUsername: null,
    role: '',
    authReady: false,
    unreadNotifications: 0,
    async refreshNotifications(){
        if(!this.user){this.unreadNotifications=0;return;}
        try{const r=await fetch('/api/notifications',{credentials:'same-origin',cache:'no-store'});if(r.ok)this.unreadNotifications=(await r.json()).unread||0;}catch(e){console.warn('Notification refresh failed',e);}
    },
    async refreshAuth() {
        try {
            const response = await fetch('/api/auth/me', { credentials:'same-origin', cache:'no-store' });
            if (!response.ok) throw new Error('Authentication unavailable');
            const result = await response.json();
            this.user = result.user || null;
            this.profileUsername = result.claims?.find(claim => claim.status === 'approved')?.leaderboard_username || null;
            this.role = '';
            if (this.user) {
                const staffResponse = await fetch('/api/admin/me', { credentials:'same-origin', cache:'no-store' });
                if (staffResponse.ok) this.role = (await staffResponse.json()).role || '';
            }
        } catch (error) { this.user = null; this.profileUsername = null; this.role = ''; console.warn('Could not refresh account status',error); }
        finally { this.authReady = true; await this.refreshNotifications(); }
    },
    dark: JSON.parse(localStorage.getItem('dark')) || false,
    toggleDark() {
        this.dark = !this.dark;
        localStorage.setItem('dark', JSON.stringify(this.dark));
    },
});

const app = Vue.createApp({
    data: () => ({ store }),
});
const router = VueRouter.createRouter({
    history: VueRouter.createWebHashHistory(),
    routes,
});

app.use(router);

app.mount('#app');
store.refreshAuth();
window.addEventListener('focus', () => store.refreshAuth());
router.afterEach(() => { if(store.user)store.refreshNotifications(); });
window.setInterval(() => { if(store.user && document.visibilityState==='visible')store.refreshNotifications(); },60000);
