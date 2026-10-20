// Impossible CCL is maintained in a separate repository. Embed its existing
// list so the original levels, records, ratings and list layout remain intact.
export default {
    props: { platformer: { type: Boolean, default: false } },
    template: `
        <main class="impossible-embed-page">
            <div class="impossible-embed-info">
                <strong>{{ platformer ? 'Impossible Platformer List' : 'Impossible List' }}</strong>
                <a :href="sourceUrl" target="_blank" rel="noopener noreferrer">Open standalone ↗</a>
            </div>
            <iframe class="impossible-embed-frame" :src="sourceUrl" :title="platformer ? 'Impossible Platformer List' : 'Impossible Challenge List'" loading="eager"></iframe>
        </main>
    `,
    computed: {
        sourceUrl() {
            return 'https://cclimpossible.ccllcc.workers.dev/#/' + (this.platformer ? 'platformer' : '');
        }
    }
};
