export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const pathname = url.pathname.toLowerCase();

        // ── BLOCK: Serve noindex headers for backup/alternate HTML files ──
        const backupPatterns = [
            'index_dominicrykersite',
            'index_backup',
            'index_backup_'
        ];
        const isBackupFile = backupPatterns.some(p => pathname.includes(p));

        // 1. Fetch the static HTML directly from my Pages assets
        const response = await env.ASSETS.fetch(request);

        // If it's a backup file, add noindex header and return immediately
        if (isBackupFile) {
            const headers = new Headers(response.headers);
            headers.set('X-Robots-Tag', 'noindex, nofollow');
            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers
            });
        }

        // SAFETY CHECK: Only alter HTML. Never touch my complex CSS, JS, or Three.js/React!
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("text/html")) {
            return response;
        }

        try {
            // 2. Pull the master brain from the database
            const kvData = await env.SITT_DAILY_TRENDS.get("current_ecosystem_payload");
            if (!kvData) return response;

            const payload = JSON.parse(kvData);

            // 3. The Switchboard: Figure out which site the visitor is on
            const hostname = url.hostname.toLowerCase();

            let targetNode = null;

            // Route the traffic to the correct AI personality 
            // (works for custom domains AND .pages.dev preview links)
            if (hostname.includes("ethelryker")) {
                targetNode = "ethel";
            } else if (hostname.includes("dominicryker")) {
                targetNode = "dominic";
            } else if (hostname.includes("islaband")) {
                targetNode = "isla";
            } else if (hostname.includes("pixelstortion")) {
                // Path-based routing specifically for Pixelstortion
                if (pathname.includes("/zones/silence")) {
                    targetNode = "silence";
                } else {
                    targetNode = "root";
                }
            }

            // If the database is missing that character, serve the normal page
            if (!targetNode || !payload[targetNode]) return response;

            const siteMeta = payload[targetNode];

            // Track which existing tags to remove so we don't duplicate
            let removedTitle = false;

            // 4. Inject the AI metadata — REPLACE, don't duplicate
            return new HTMLRewriter()
                // Remove existing <title> so we don't get stacked titles
                .on('title', {
                    element(element) {
                        if (siteMeta.title && !removedTitle) {
                            element.remove();
                            removedTitle = true;
                        }
                    }
                })
                // Remove existing meta tags that we're about to replace
                .on('meta', {
                    element(element) {
                        const name = (element.getAttribute('name') || '').toLowerCase();
                        const property = (element.getAttribute('property') || '').toLowerCase();

                        // Remove description-related metas if we have a replacement
                        if (siteMeta.description) {
                            if (name === 'description') { element.remove(); return; }
                            if (property === 'og:description') { element.remove(); return; }
                        }
                        // Remove title-related metas if we have a replacement
                        if (siteMeta.title) {
                            if (property === 'og:title') { element.remove(); return; }
                            if (name === 'twitter:title') { element.remove(); return; }
                        }
                    }
                })
                // Append clean, deduplicated AI metadata
                .on('head', {
                    element(element) {
                        if (siteMeta.title) {
                            element.append(`<title>${siteMeta.title}</title>`, { html: true });
                            element.append(`<meta property="og:title" content="${siteMeta.title}">`, { html: true });
                            element.append(`<meta name="twitter:title" content="${siteMeta.title}">`, { html: true });
                        }
                        if (siteMeta.description) {
                            element.append(`<meta name="description" content="${siteMeta.description}">`, { html: true });
                            element.append(`<meta property="og:description" content="${siteMeta.description}">`, { html: true });
                        }
                        if (siteMeta.schema) {
                            element.append(`<script type="application/ld+json">${JSON.stringify(siteMeta.schema)}</script>`, { html: true });
                        }
                    }
                })
                .transform(response);

        } catch (err) {
            console.error("Worker error:", err);
            return response; // Fail gracefully so the site never breaks
        }
    }
};
