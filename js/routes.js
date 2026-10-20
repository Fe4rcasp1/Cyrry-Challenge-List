import List from './pages/List.js';
import Leaderboard from './pages/Leaderboard.js';
import Roulette from './pages/Roulette.js';
import Hub from './pages/Hub.js';
import Profile from './pages/Profile.js';
import Account from './pages/Account.js';
import Admin from './pages/Admin.js';
import Community from './pages/Community.js';
import Impossible from './pages/Impossible.js';

export default [
    { path: '/', component: List },
    { path: '/platformer', component: List, props: { listFile: '_platformer.json', platformer: true } },
    { path: '/leaderboard', component: Leaderboard },
    { path: '/impossible', component: Impossible },
    { path: '/impossible-platformer', component: Impossible, props: { platformer: true } },
    { path: '/roulette', component: Roulette },
    { path: '/hub', component: Hub },
    { path: '/account', component: Account },
    { path: '/admin', component: Admin },
    { path: '/community', component: Community },
    { path: '/player/:username', component: Profile },
];
