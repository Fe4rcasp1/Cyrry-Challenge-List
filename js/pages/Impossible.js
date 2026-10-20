// Impossible CCL is maintained in a separate repository. Embed its existing
// list so the original levels, records, ratings and list layout remain intact.
export default {
    props: { platformer: { type: Boolean, default: false } },
    template: `
        <main class="impossible-embed-page">
            <iframe class="impossible-embed-frame" :src="sourceUrl" :title="platformer ? 'Impossible Platformer List' : 'Impossible Challenge List'" loading="eager"></iframe>
        </main>
    `,
    computed: {
        sourceUrl() {
            return 'https://cclimpossible.ccllcc.workers.dev/?embed=1#/' + (this.platformer ? 'platformer' : '');
        }
    }
};
