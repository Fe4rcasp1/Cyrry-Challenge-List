import { store } from '../main.js';
export default {
 data:()=>({items:[],busy:false,error:''}),
 template:`<main class="ccl-hub"><section class="hub-head"><h1>Notifications</h1><p>Updates on your record reviews, claims, and weekly challenges.</p></section><section class="hub-card"><button class="hub-fav-button" :disabled="busy||!items.some(x=>!x.is_read)" @click="markRead('all')">Mark all as read</button><p v-if="error" class="hub-auth-error">{{error}}</p><p v-if="!items.length">No notifications yet.</p><div v-for="n in items" :key="n.id" class="hub-change" :class="{'notification-unread':!n.is_read}"><div><strong>{{n.message}}</strong><p class="hub-muted">{{n.created_at}}</p><a v-if="n.link" :href="n.link">View details →</a></div><button v-if="!n.is_read" class="hub-fav-button" @click="markRead(n.id)">Mark read</button></div></section></main>`,
 async mounted(){await this.load()},
 methods:{
 async load(){try{const r=await fetch('/api/notifications',{credentials:'same-origin',cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'Could not load notifications');this.items=d.notifications||[];store.unreadNotifications=d.unread||0}catch(e){this.error=e.message}},
 async markRead(id){this.busy=true;try{const r=await fetch('/api/notifications/read',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({id})});if(!r.ok)throw Error('Could not update notifications');if(id==='all')this.items.forEach(x=>x.is_read=1);else{const n=this.items.find(x=>x.id===id);if(n)n.is_read=1}store.unreadNotifications=this.items.filter(x=>!x.is_read).length;}catch(e){this.error=e.message}finally{this.busy=false}}
 }
};