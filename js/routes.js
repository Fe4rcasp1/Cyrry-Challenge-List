import List from './pages/List.js';
import Leaderboard from './pages/Leaderboard.js';
import Roulette from './pages/Roulette.js';

export default [
    { path: '/', redirect: '/ccl' },
    {
        path: '/ccl',
        component: List,
        props: { dataDir: '/data' },
    },
    {
        path: '/cyrry-list',
        component: List,
        props: { dataDir: '/cyrry-data' },
    },
    { path: '/leaderboard', component: Leaderboard },
    { path: '/roulette', component: Roulette },
];
