import List from './pages/List.js';
import Leaderboard from './pages/Leaderboard.js';
import Roulette from './pages/Roulette.js';

export default [
    { path: '/', component: List },
    { path: '/platformer', component: List, props: { listFile: '_platformer.json', platformer: true } },
    { path: '/leaderboard', component: Leaderboard },
    { path: '/roulette', component: Roulette },
];
