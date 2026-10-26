import initWebNotifications from './background.notifications.js';

initWebNotifications();

const CONTENT_SCRIPT_ID = 'custom-gitlab-domains';

/**
 * Runs the content script on granted custom domains from the start of each page load,
 * like the manifest does for gitlab.com, instead of injecting it once the page completed.
 */
async function syncContentScripts() {
    if (!chrome.scripting?.registerContentScripts) {
        return;
    }

    const { customGitlabDomains } = await chrome.storage.local.get(['customGitlabDomains']);
    const { origins = [] } = await chrome.permissions.getAll();
    const matches = (customGitlabDomains?.split(',') || [])
        .map(url => `${url.trim().replace(/\/$/, '')}/*`)
        .filter(match => origins.includes(match));

    await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] }).catch(() => {});

    if (matches.length) {
        await chrome.scripting.registerContentScripts([{
            id: CONTENT_SCRIPT_ID,
            js: ['content.js'],
            matches,
            runAt: 'document_start',
            persistAcrossSessions: true,
        }]);
    }
}

syncContentScripts();
chrome.runtime.onInstalled.addListener(syncContentScripts);
chrome.runtime.onStartup.addListener(syncContentScripts);
chrome.permissions.onAdded.addListener(syncContentScripts);
chrome.permissions.onRemoved.addListener(syncContentScripts);
chrome.storage.onChanged.addListener((changes) => {
    if (changes.customGitlabDomains) {
        syncContentScripts();
    }
});

// Fallback for pages that loaded before the content script was registered; content.js skips a second run
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') {
        return;
    }

    chrome.storage.local.get(['customGitlabDomains'])
        .then((result) => {
            const instances = (result?.customGitlabDomains?.split(',') || []).map((url) => url.trim()
                .replace(/\/$/, ''));

            if (!tab.url || !instances.length) {
                return
            }

            try {
                const tabUrl = new URL(tab.url);
                const matchingDomain = instances.find((domain) => domain.includes(tabUrl.origin));

                if (matchingDomain) {
                    chrome.permissions.contains({
                        permissions: [
                            'webRequest',
                            'scripting',
                        ],
                        origins: [`${matchingDomain}/*`],
                    })
                        .then((response) => {
                            if (!response) {
                                return;
                            }

                            return chrome.scripting.executeScript({
                                target: { tabId: tabId },
                                files: ['/content.js'],
                            });
                        })
                        // The tab can close or navigate away in the meantime
                        .catch(() => {});

                }
            } catch (_) { /* empty */
            }
        });
});

function postMessage(type, data) {
    window.postMessage({ type, data });
}

function onWebRequestCompleted(details) {
    if (details.tabId < 0) {
        return;
    }

    chrome.tabs.get(details.tabId)
        .then((tab) => {
            if (chrome.runtime.lastError || !tab.active || !tab?.url?.includes('//gitlab.')) {
                return;
            }

            return chrome.scripting.executeScript({
                target: { tabId: details.tabId },
                func: postMessage,
                args: ['browser-request-completed', details],
            });
        })
        // The tab can close or navigate away before the request finished
        .catch(() => {});
}

chrome?.webRequest?.onCompleted?.addListener(onWebRequestCompleted, { urls: ['<all_urls>'] });
