document.addEventListener('DOMContentLoaded', () => {
    try {
    // START FOCUS MODE
    document.body.classList.add('zen-mode');

    // DOM Elements
    const chatInput = document.getElementById('businessIdea'); // Dual purpose: Idea or Edit
    const sendBtn = document.getElementById('generateBtn');
    const chatCounter = document.getElementById('chatCounter');
    const chatTypingIndicator = document.getElementById('chatTypingIndicator');
    const chatWrap = document.querySelector('.chat-input-wrap');
    const inputGlass = document.querySelector('.input-glass');
    const CHAT_MAX_CHARS = 2000;
    const terminalContent = document.getElementById('terminalLog'); // UPDATED ID to match Dashboard HTML structure wrapper
    const resultSection = document.getElementById('resultSection'); // Container for Build Btn
    const buildBtn = document.getElementById('buildBtn');
    const resetContextBtn = document.getElementById('resetContextBtn');
    const livePreviewFrame = document.getElementById('livePreviewFrame');
    const userTokensEl = document.getElementById('userPlanBadge');
    const modeStrategyBtn = document.getElementById('modeStrategyBtn');
    const modeEditBtn = document.getElementById('modeEditBtn');
    const engineSelector = document.getElementById('engineSelector');
    const projectsFolderGrid = document.getElementById('projectsFolderGrid');
    const uploadImageBtn = document.getElementById('uploadImageBtn');
    const imageUploadInput = document.getElementById('imageUploadInput');
    const attachmentStatus = document.getElementById('attachmentStatus');
    const voiceInputBtn = document.getElementById('voiceInputBtn');
    const profileNameEl = document.getElementById('profileName');
    const profileEmailEl = document.getElementById('profileEmail');
    const profileMemberSinceEl = document.getElementById('profileMemberSince');
    const profileCreditsEl = document.getElementById('profileCredits');
    const logoutBtn = document.getElementById('logoutBtn');
    const briefScoreText = document.getElementById('briefScoreText');
    const briefScoreBar = document.getElementById('briefScoreBar');
    const briefMissingList = document.getElementById('briefMissingList');
    const briefSummaryText = document.getElementById('briefSummaryText');
    const blueprintNowBtn = document.getElementById('blueprintNowBtn');
    const statusTimeline = document.getElementById('status-timeline');
    const emptyState = document.getElementById('emptyState');
    const togglePreviewBtn = document.getElementById('togglePreviewBtn');
    const previewPanel = document.getElementById('previewPanel');
    const buildSection = document.getElementById('section-build');
    const marketingPreviewContainer = document.getElementById('marketingPreviewContainer');
    const notifBtn = document.getElementById('notifBtn');
    const notifBadge = document.getElementById('notifBadge');
    const notifToast = document.getElementById('notifToast');
    const notifToastBtn = document.getElementById('notifToastBtn');
    const notifPanel = document.getElementById('notifPanel');
    const notifList = document.getElementById('notifList');
    const notifCloseBtn = document.getElementById('notifCloseBtn');
    const paywallBanner = document.getElementById('paywallBanner');
    const paywallBtn = document.getElementById('paywallBtn');
    const paywallEmailGate = document.getElementById('paywallEmailGate');
    const paywallEmailInput = document.getElementById('paywallEmailInput');
    const paywallEmailBtn = document.getElementById('paywallEmailBtn');
    const welcomeScreen = document.getElementById('welcomeScreen');
    const welcomeType = document.getElementById('welcomeType');
    const welcomeInput = document.getElementById('welcomeProjectInput');
    const welcomeStartBtn = document.getElementById('welcomeStartBtn');
    const welcomePhoneStep = document.getElementById('welcomePhoneStep');
    const welcomePhoneInput = document.getElementById('welcomePhoneInput');
    const welcomePhoneBtn = document.getElementById('welcomePhoneBtn');
    const welcomeStatus = document.getElementById('welcomeStatus');
    const welcomeCloseBtn = document.getElementById('welcomeCloseBtn');
    const newProjectPhoneInput = document.getElementById('newProjectPhoneInput');

    // Pre-init state used by early UI handlers
    let activeChannel = 'build'; // build | marketing | organic | capital
    let interactionMode = 'strategy'; // strategy | edit
    let pendingImageDataUrl = '';
    let pendingImageName = '';
    const VALID_CHANNELS = ['build', 'marketing', 'organic', 'capital'];
    function isMarketingChannel() { return activeChannel === 'marketing'; }
    function isOrganicChannel() { return activeChannel === 'organic'; }
    function isCapitalChannel() { return activeChannel === 'capital'; }
    function isBuildChannel() { return activeChannel === 'build'; }
    function isContentChannel() { return activeChannel === 'marketing' || activeChannel === 'organic'; }

    // --- Session Management ---
    let currentUser = null;
    try {
        const rawUser = localStorage.getItem('currentUser');
        currentUser = rawUser ? JSON.parse(rawUser) : null;
    } catch (e) {
        console.warn('Invalid currentUser in localStorage. Resetting session.');
        localStorage.removeItem('currentUser');
        currentUser = null;
    }

    const isGuestEmail = (email) => {
        const lower = String(email || '').toLowerCase();
        return lower.startsWith('guest_') || lower.endsWith('@guest.anmar') || lower.endsWith('@guest.local');
    };

    if (!currentUser || isGuestEmail(currentUser.email)) {
        window.location.href = 'login.html';
        return;
    }

    const setCurrentUserEmail = (email) => {
        if (!email || typeof email !== 'string') return;
        currentUser = currentUser || {};
        currentUser.email = email.trim().toLowerCase();
        if (!currentUser.name || currentUser.name === 'Invitado') {
            currentUser.name = email.split('@')[0] || 'Client';
        }
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        localStorage.removeItem('guest_user');
    };

    const showEmailGate = () => {
        if (paywallEmailGate) {
            paywallEmailGate.style.display = 'block';
        }
        if (paywallEmailInput) {
            paywallEmailInput.focus();
        }
    };

    const ensureCheckoutIdentity = () => {
        if (!currentUser || isGuestEmail(currentUser.email)) {
            window.location.href = 'login.html';
            return false;
        }
        return true;
    };
    // Guest sessions are disabled for the strict flow.

    let pendingPlanId = null;

    // --- Human Chat Polling ---
    let humanChatInterval = null;
    let lastHumanChatCount = 0;
    let lastHumanMsgId = ''; // Track last message ID for dedup
    const notifiedBlueprintIds = new Set();
    const blueprintAudio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
    blueprintAudio.volume = 0.4;

    async function pollHumanChat() {
        if (!currentUser?.email || !currentProjectName) return;
        try {
            const res = await fetch(`/api/human-chat/history?project_name=${encodeURIComponent(getActiveProjectKey())}&client_email=${encodeURIComponent(currentUser.email)}`, {
                credentials: 'include'
            });
            if (!res.ok) return;
            const data = await res.json();
            const history = data.history || [];
            updateBlueprintNotifications(history);
            // Compare by last message ID instead of count — survives page reload
            const newestId = history.length ? (history[history.length - 1].id || '') : '';
            if (history.length !== lastHumanChatCount || newestId !== lastHumanMsgId) {
                lastHumanChatCount = history.length;
                lastHumanMsgId = newestId;
                renderHumanChat(history);
            }
        } catch (e) { console.error('Error polling human chat:', e); }
    }

    function updateBlueprintNotifications(history) {
        if (!notifBtn || !notifBadge) return;
        const pendingBlueprints = (history || []).filter(msg => msg.kind === 'blueprint' && !msg.accepted);
        const count = pendingBlueprints.length;
        if (count > 0) {
            notifBadge.textContent = count > 9 ? '9+' : String(count);
            notifBtn.classList.add('active');
        } else {
            notifBtn.classList.remove('active');
        }

        const fresh = pendingBlueprints.filter(msg => msg.id && !notifiedBlueprintIds.has(msg.id));
        if (fresh.length > 0) {
            fresh.forEach(msg => notifiedBlueprintIds.add(msg.id));
            blueprintAudio.play().catch(() => {});
            showBlueprintToast();
        }
        renderNotificationList(history || []);
    }

    function renderNotificationList(history) {
        if (!notifList) return;
        const blueprints = (history || [])
            .filter(msg => msg.kind === 'blueprint')
            .map(msg => ({
                id: msg.id,
                title: (msg.payload && msg.payload.title) || msg.content || 'Blueprint',
                accepted: !!msg.accepted,
                timestamp: msg.timestamp || ''
            }))
            .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

        if (!blueprints.length) {
            notifList.innerHTML = '<div style="color:rgba(255,255,255,0.6); font-size:0.85rem;">No notifications.</div>';
            return;
        }

        notifList.innerHTML = '';
        blueprints.forEach(item => {
            const el = document.createElement('div');
            el.className = 'notif-item';
            const time = item.timestamp ? new Date(item.timestamp) : null;
            const timeLabel = time ? time.toLocaleString() : '';
            el.innerHTML = `
                <div class="notif-item-title">${escapeHtml(item.title)}</div>
                <div class="notif-item-meta">${item.accepted ? 'Blueprint approved' : 'Blueprint pending'} ${timeLabel ? '• ' + timeLabel : ''}</div>
            `;
            el.addEventListener('click', () => {
                if (notifPanel) notifPanel.classList.remove('open');
                if (typeof switchTab === 'function') switchTab('build');
                if (typeof switchChatTab === 'function') switchChatTab('Human');
            });
            notifList.appendChild(el);
        });
    }

    function showBlueprintToast() {
        if (!notifToast) return;
        notifToast.classList.add('show');
        clearTimeout(window.__notifToastTimer);
        window.__notifToastTimer = setTimeout(() => {
            notifToast.classList.remove('show');
        }, 6000);
    }

    function addHumanSystemMessage(text) {
        const container = document.getElementById('humanChatContent');
        if (!container) return;
        const msgRow = document.createElement('div');
        msgRow.className = 'msg-row ai';
        msgRow.innerHTML = `<div class="ai-msg">${escapeHtml(text)}</div>`;
        container.appendChild(msgRow);
        const log = document.getElementById('humanLog');
        if (log) log.scrollTop = log.scrollHeight;
        return msgRow;
    }

    function escapeHtml(text) {
        return String(text || '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char]));
    }

    function normalizeLines(value) {
        if (Array.isArray(value)) {
            return value.map(item => String(item || '').trim()).filter(Boolean);
        }
        if (typeof value === 'string') {
            return value.split('\n').map(line => line.trim()).filter(Boolean);
        }
        return [];
    }

    function positionChatWelcome() {
        const welcome = document.getElementById('humanChatWelcome');
        const log = document.getElementById('humanLog');
        if (!welcome || !log) return;
        const r = log.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        welcome.style.position = 'fixed';
        welcome.style.top  = Math.round(r.top + r.height * 0.45) + 'px';
        welcome.style.left = Math.round(r.left + r.width / 2) + 'px';
        welcome.style.transform = 'translate(-50%, -50%)';
        welcome.style.width = '220px';
        welcome.style.display = 'flex';
        welcome.style.flexDirection = 'column';
        welcome.style.alignItems = 'center';
        welcome.style.textAlign = 'center';
        welcome.style.pointerEvents = 'none';
        welcome.style.zIndex = '5';
    }

    function renderHumanChat(history) {
        const container = document.getElementById('humanChatContent');
        if (!container) return;
        container.innerHTML = '';
        // Hide welcome when there are messages
        const welcomeEl = document.getElementById('humanChatWelcome');
        if (welcomeEl) {
            const hasMessages = history && history.length > 0;
            welcomeEl.style.display = hasMessages ? 'none' : 'flex';
            if (!hasMessages) { positionChatWelcome(); updateChannelWelcome(activeChannel); }
        }
        history.forEach(msg => {
            const isClient = msg.role === 'client';
            const row = document.createElement('div');
            row.className = `msg-row ${isClient ? 'user' : 'ai'}`;

            if (msg.kind === 'blueprint') {
                const wrap = document.createElement('div');
                wrap.className = isClient ? 'user-msg' : 'ai-msg';
                const card = document.createElement('div');
                card.className = 'blueprint-card';

                const payload = msg.payload || {};
                const title = payload.title || msg.content || 'Blueprint';
                const summary = payload.summary || '';
                const steps = normalizeLines(payload.steps);
                const deliverables = normalizeLines(payload.deliverables);

                card.innerHTML = `
                    <h4>${escapeHtml(title)}</h4>
                    ${summary ? `<div class="blueprint-meta">${escapeHtml(summary)}</div>` : ''}
                `;

                if (steps.length) {
                    const ul = document.createElement('ul');
                    steps.forEach(step => {
                        const li = document.createElement('li');
                        li.textContent = step;
                        ul.appendChild(li);
                    });
                    const label = document.createElement('div');
                    label.className = 'blueprint-meta';
                    label.textContent = 'Alcance';
                    card.appendChild(label);
                    card.appendChild(ul);
                }

                if (deliverables.length) {
                    const ul = document.createElement('ul');
                    deliverables.forEach(item => {
                        const li = document.createElement('li');
                        li.textContent = item;
                        ul.appendChild(li);
                    });
                    const label = document.createElement('div');
                    label.className = 'blueprint-meta';
                    label.textContent = 'Entregables';
                    card.appendChild(label);
                    card.appendChild(ul);
                }

                const actions = document.createElement('div');
                actions.className = 'blueprint-actions';
                if (msg.accepted) {
                    const badge = document.createElement('span');
                    badge.className = 'blueprint-tag';
                    badge.textContent = 'Blueprint approved';
                    actions.appendChild(badge);
                } else if (!isClient) {
                    const btn = document.createElement('button');
                    btn.className = 'blueprint-btn';
                    btn.textContent = 'Accept blueprint';
                    btn.addEventListener('click', () => acceptBlueprint(msg.id));
                    actions.appendChild(btn);
                }
                if (actions.childNodes.length) card.appendChild(actions);

                wrap.appendChild(card);
                row.appendChild(wrap);
                container.appendChild(row);
                return;
            }

            if (msg.kind === 'preview') {
                const wrap = document.createElement('div');
                wrap.className = isClient ? 'user-msg' : 'ai-msg';
                const card = document.createElement('div');
                card.className = 'blueprint-card';
                const payload = msg.payload || {};
                const url = payload.url || msg.content || '';
                card.innerHTML = `
                    <h4>Preview updated</h4>
                    <div class="blueprint-meta">Your engineer shared a new preview.</div>
                `;
                if (url) {
                    const actions = document.createElement('div');
                    actions.className = 'blueprint-actions';
                    const btn = document.createElement('button');
                    btn.className = 'blueprint-btn';
                    btn.textContent = 'Open preview';
                    btn.addEventListener('click', () => window.open(url, '_blank'));
                    actions.appendChild(btn);
                    card.appendChild(actions);
                }
                wrap.appendChild(card);
                row.appendChild(wrap);
                container.appendChild(row);
                return;
            }

            const contentDiv = document.createElement('div');
            contentDiv.className = isClient ? 'user-msg' : 'ai-msg';
            if (isClient) {
                contentDiv.textContent = msg.content || '';
            } else {
                const defaultActor = isMarketingChannel() ? 'Marketing' : 'Ingeniero';
                const actor = escapeHtml(msg.actor || defaultActor);
                const content = escapeHtml(msg.content || '');
                contentDiv.innerHTML = `<strong>[${actor}]</strong><br>${content}`;
            }
            row.appendChild(contentDiv);
            container.appendChild(row);
        });
        const log = document.getElementById('humanLog');
        if (log) log.scrollTop = log.scrollHeight;
        updateBlueprintNotifications(history);
    }

    async function acceptBlueprint(blueprintId) {
        if (!currentProjectName || !blueprintId) return;
        try {
            await fetch('/api/human-chat/accept-blueprint', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    project_name: getActiveProjectKey(),
                    blueprint_id: blueprintId,
                    actor: currentUser?.name || 'Cliente',
                    client_email: currentUser?.email || ''
                })
            });
            pollHumanChat();
        } catch (e) {
            console.error('Error accepting blueprint:', e);
        }
    }

    if (notifBtn) {
        notifBtn.addEventListener('click', () => {
            if (notifPanel) {
                notifPanel.classList.toggle('open');
            }
            switchTab('build');
            if (typeof switchChatTab === 'function') {
                switchChatTab('Human');
            }
            const log = document.getElementById('humanLog');
            if (log) {
                setTimeout(() => {
                    log.scrollTop = log.scrollHeight;
                }, 120);
            }
        });
    }

    if (notifToastBtn) {
        notifToastBtn.addEventListener('click', () => {
            if (notifToast) notifToast.classList.remove('show');
            if (typeof switchTab === 'function') switchTab('build');
            if (typeof switchChatTab === 'function') switchChatTab('Human');
        });
    }

    if (notifCloseBtn) {
        notifCloseBtn.addEventListener('click', () => {
            if (notifPanel) notifPanel.classList.remove('open');
        });
    }

    let welcomeTyped = false;
    const chatHelper = document.getElementById('chatHelperText');

    const resizeChatInput = () => {
        if (!chatInput) return;
        chatInput.style.height = 'auto';
        const maxHeight = 160;
        const nextHeight = Math.min(chatInput.scrollHeight, maxHeight);
        chatInput.style.height = `${nextHeight}px`;
        chatInput.style.overflowY = chatInput.scrollHeight > maxHeight ? 'auto' : 'hidden';
    };

    const updateSendState = () => {
        if (!chatInput || !sendBtn) return;
        const len = chatInput.value.length;
        const hasText = chatInput.value.trim().length > 0;
        const hasAttachment = !!pendingImageDataUrl;
        const overLimit = len > CHAT_MAX_CHARS;
        const canSend = (hasText || hasAttachment) && !isProcessing && !overLimit;
        if (sendBtn) sendBtn.disabled = !canSend;
        if (sendBtn) sendBtn.classList.toggle('active', canSend);
        if (chatWrap) chatWrap.classList.toggle('typing', len > 0);
        if (chatCounter) {
            chatCounter.textContent = `${len}/${CHAT_MAX_CHARS}`;
            chatCounter.classList.toggle('over', overLimit);
        }
    };
    function updateChatCopy() {
        if (!chatInput) return;

        // Channel-specific placeholders (team chat only)
        const channelCopy = {
            build: {
                placeholder: "Write your message to the team...",
                helper: "Tell us what you need. We assign an engineer in minutes."
            },
            marketing: {
                placeholder: "Tell us the marketing goal and the product.",
                helper: "Define the campaign. We assign a marketing strategist."
            },
            organic: {
                placeholder: "Tell us about your brand and content goals.",
                helper: "Define your strategy. We assign a content creator."
            },
            capital: {
                placeholder: "Tell us about your business and investment needs.",
                helper: "Define your needs. We connect you with capital advisors."
            }
        };

        const copy = channelCopy[activeChannel] || channelCopy.build;
        chatInput.placeholder = copy.placeholder;
        if (chatHelper) chatHelper.textContent = copy.helper;
    }

    function setPreviewMode(mode) {
        const isContentMode = mode === 'marketing' || mode === 'organic';
        if (livePreviewFrame) livePreviewFrame.style.display = isContentMode ? 'none' : 'block';
        if (marketingPreviewContainer) marketingPreviewContainer.style.display = isContentMode ? 'block' : 'none';
        if (emptyState) {
            if (isContentMode) {
                emptyState.style.display = 'none';
            } else if (!livePreviewFrame || !livePreviewFrame.src || livePreviewFrame.src === 'about:blank') {
                emptyState.style.display = 'flex';
            }
        }
        const urlBar = document.querySelector('.url-bar');
        if (urlBar) urlBar.textContent = isContentMode ? 'ads.anmar.ai/preview' : (currentProjectName ? `anmar.app/projects/${currentProjectName}` : 'preview.anmar.ai');
        const mobileBtnEl = document.getElementById('mobileViewBtn');
        const desktopBtnEl = document.getElementById('desktopViewBtn');
        if (mobileBtnEl) mobileBtnEl.style.display = isContentMode ? 'none' : 'inline-flex';
        if (desktopBtnEl) desktopBtnEl.style.display = isContentMode ? 'none' : 'inline-flex';
    }

    function setActiveChannel(channel) {
        activeChannel = VALID_CHANNELS.includes(channel) ? channel : 'build';
        updateChatCopy();
        setPreviewMode(activeChannel);

        // Channel badge — visual indicator of active channel
        const channelBadge = document.getElementById('activeChannelBadge');
        if (channelBadge) {
            const badgeConfig = {
                build:     { label: 'Build',     bg: 'rgba(16,185,129,0.15)', color: '#10b981', border: 'rgba(16,185,129,0.3)' },
                marketing: { label: 'Marketing', bg: 'rgba(59,130,246,0.15)', color: '#3b82f6', border: 'rgba(59,130,246,0.3)' },
                organic:   { label: 'Organic',   bg: 'rgba(168,85,247,0.15)', color: '#a855f7', border: 'rgba(168,85,247,0.3)' },
                capital:   { label: 'Capital',   bg: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: 'rgba(245,158,11,0.3)' }
            };
            const cfg = badgeConfig[activeChannel] || badgeConfig.build;
            channelBadge.textContent = cfg.label;
            channelBadge.style.background = cfg.bg;
            channelBadge.style.color = cfg.color;
            channelBadge.style.borderColor = cfg.border;
        }

        // Preview button
        const previewLabels = { build: 'Preview', marketing: 'Preview Marketing', organic: 'Organic Preview', capital: 'Capital Preview' };
        if (togglePreviewBtn) togglePreviewBtn.textContent = previewLabels[activeChannel] || 'Preview';

        // Marketing preview only for marketing/organic
        if (isMarketingChannel() || isOrganicChannel()) renderMarketingPreview(currentMarketingAssets);

        // Hide result section for non-build channels
        if (resultSection && !isBuildChannel()) resultSection.style.display = 'none';

        // Update welcome content + lock state per channel
        updateChannelWelcome(activeChannel);
    }

    function updateChannelWelcome(channel) {
        const welcome = document.getElementById('humanChatWelcome');
        const inputArea = document.querySelector('.chat-input-area');
        const sendBtnEl = document.getElementById('generateBtn');
        const chatInputEl = document.getElementById('businessIdea');
        if (!welcome) return;

        const hasMessages = document.getElementById('humanChatContent')?.children.length > 0;
        if (hasMessages) { welcome.style.display = 'none'; return; }

        const configs = {
            build: {
                icon: 'fa-hammer',
                iconColor: '#10b981',
                iconBg: 'rgba(16,185,129,0.1)',
                iconBorder: 'rgba(16,185,129,0.2)',
                title: 'Your idea is validated. Now let\'s build it.',
                desc: 'Turn your business model into an actionable product roadmap — tech stack, MVP scope, timeline, and team structure.',
                chips: ['What should my MVP include?', 'Help me define my tech stack', 'How long will it take to build?'],
                chipsColor: '#10b981',
                chipsBorder: 'rgba(16,185,129,0.25)',
                chipsBg: 'rgba(16,185,129,0.07)',
                locked: false
            },
            marketing: {
                icon: 'fa-bullhorn',
                iconColor: '#3b82f6',
                iconBg: 'rgba(59,130,246,0.1)',
                iconBorder: 'rgba(59,130,246,0.2)',
                title: 'A great product without distribution is invisible.',
                desc: 'Get a custom go-to-market strategy — channels, messaging, launch sequence, and paid vs organic breakdown.',
                chips: ['What\'s my best acquisition channel?', 'Write my launch strategy', 'Who should I target first?'],
                chipsColor: '#3b82f6',
                chipsBorder: 'rgba(59,130,246,0.25)',
                chipsBg: 'rgba(59,130,246,0.07)',
                locked: false
            },
            organic: {
                icon: 'fa-seedling',
                iconColor: '#a855f7',
                iconBg: 'rgba(168,85,247,0.1)',
                iconBorder: 'rgba(168,85,247,0.2)',
                title: 'Your audience is out there. Let\'s make them find you.',
                desc: 'Build a content engine — platform strategy, post formats, content calendar, and SEO keywords tailored to your idea.',
                chips: ['Create a 30-day content calendar', 'What should I post on Instagram?', 'Give me 10 SEO keywords for my idea'],
                chipsColor: '#a855f7',
                chipsBorder: 'rgba(168,85,247,0.25)',
                chipsBg: 'rgba(168,85,247,0.07)',
                locked: false
            },
            capital: {
                icon: 'fa-lock',
                iconColor: '#f59e0b',
                iconBg: 'rgba(245,158,11,0.08)',
                iconBorder: 'rgba(245,158,11,0.2)',
                title: 'Capital comes after proof.',
                desc: 'This section unlocks once your idea has validated traction — real users, revenue, or market signals. Keep building. The investors will come.',
                chips: [],
                locked: true
            }
        };

        const cfg = configs[channel] || configs.build;

        // Build chips HTML
        let chipsHTML = '';
        if (cfg.chips && cfg.chips.length > 0) {
            chipsHTML = `<div style="display:flex;flex-direction:column;gap:7px;margin-top:18px;width:100%;max-width:320px;">` +
                cfg.chips.map(c => `<button onclick="document.getElementById('businessIdea').value=this.dataset.prompt;document.getElementById('businessIdea').dispatchEvent(new Event('input'));document.getElementById('businessIdea').focus();" data-prompt="${c.replace(/"/g,'&quot;')}" style="background:${cfg.chipsBg};border:1px solid ${cfg.chipsBorder};color:${cfg.chipsColor};border-radius:8px;padding:8px 14px;font-size:0.75rem;font-weight:500;cursor:pointer;text-align:left;letter-spacing:0.1px;transition:opacity 0.15s;" onmouseover="this.style.opacity='0.75'" onmouseout="this.style.opacity='1'">${c}</button>`).join('') +
                `</div>`;
        }

        welcome.style.display = 'flex';
        welcome.style.width = '320px';
        welcome.innerHTML = `
            <div style="width:42px;height:42px;border-radius:12px;background:${cfg.iconBg};border:1px solid ${cfg.iconBorder};display:flex;align-items:center;justify-content:center;margin-bottom:14px;flex-shrink:0;">
                <i class="fas ${cfg.icon}" style="color:${cfg.iconColor};font-size:0.95rem;"></i>
            </div>
            <div style="font-weight:600;font-size:0.88rem;color:rgba(255,255,255,0.8);margin-bottom:8px;letter-spacing:-0.01em;line-height:1.4;">${cfg.title}</div>
            <div style="color:rgba(255,255,255,0.35);font-size:0.76rem;line-height:1.6;">${cfg.desc}</div>
            ${chipsHTML}
        `;

        // Lock/unlock input for capital
        if (inputArea) inputArea.style.opacity = cfg.locked ? '0.35' : '1';
        if (inputArea) inputArea.style.pointerEvents = cfg.locked ? 'none' : 'auto';
        if (sendBtnEl) sendBtnEl.disabled = cfg.locked;
    }

    async function fetchConstructionContext() {
        if (!currentUser?.email || !currentProjectName) return null;
        try {
            const res = await fetch(`/api/chat-memory?email=${encodeURIComponent(currentUser.email)}&project_name=${encodeURIComponent(currentProjectName)}`, { credentials: 'include' });
            if (!res.ok) return null;
            const data = await res.json();
            const memory = data.memory || {};
            const agent = memory.agent_memory || {};
            const summary = String(memory.summary || '').trim();
            const audience = String(memory.audience || agent.audience || '').trim();
            const businessModel = String(memory.business_model || agent.business_model || '').trim();
            const timeline = String(memory.timeline || agent.timeline || '').trim();
            const features = Array.isArray(agent.features) ? agent.features.join(', ') : '';
            const ticketId = String(memory.current_ticket_project_id || '').trim();
            const pendingTicket = String(localStorage.getItem('pending_ticket_project') || '').trim();
            const hasConversation = Array.isArray(memory.conversation_history) && memory.conversation_history.length > 0;

            const hasContext = !!(summary || audience || businessModel || timeline || features || ticketId || hasConversation || (pendingTicket && pendingTicket === currentProjectName));
            if (!hasContext) return null;

            return {
                summary,
                audience,
                businessModel,
                timeline,
                features,
                ticketId
            };
        } catch (e) {
            console.warn('Construction context lookup failed', e);
            return null;
        }
    }

    function formatConstructionContext(ctx) {
        if (!ctx) return '';
        const lines = [
            ctx.summary ? `Producto: ${ctx.summary}` : '',
            ctx.audience ? `Audience: ${ctx.audience}` : '',
            ctx.businessModel ? `Modelo: ${ctx.businessModel}` : '',
            ctx.timeline ? `Timeline: ${ctx.timeline}` : '',
            ctx.features ? `Features: ${ctx.features}` : ''
        ].filter(Boolean);
        return lines.join(' | ');
    }

    async function bootstrapMarketingPhase() {
        if (!isMarketingChannel()) return;
        if (!currentProjectName) return;
        if (conversationHistory.length) return;
        if (currentMarketingBrief || (currentMarketingAssets && currentMarketingAssets.length)) return;

        const ctx = await fetchConstructionContext();
        if (ctx) {
            // CASE A: Use construction context to propose immediately.
            showThinking("Analyzing build context...");
            try {
                const res = await fetch('/api/continue-marketing', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        history: [],
                        message: '',
                        user_email: currentUser.email,
                        project_name: getActiveProjectKey(),
                        construction_context: formatConstructionContext(ctx),
                        bootstrap: true
                    })
                });
                const { data } = await safeReadJson(res);
                stopThinking();
                if (!data) {
                    throw new Error(`Server returned HTML (status ${res.status}).`);
                }
                if (!res.ok) {
                    throw new Error(data.error || 'Marketing error');
                }
                if (data.ai_reply) {
                    await addSystemMessage(data.ai_reply);
                    conversationHistory.push({ role: "ai", content: data.ai_reply });
                }
                if (Array.isArray(data.preview_assets)) {
                    currentMarketingAssets = data.preview_assets;
                    renderMarketingPreview(currentMarketingAssets);
                }
                if (data.marketing_brief) {
                    currentMarketingBrief = data.marketing_brief;
                }
                if (Array.isArray(data.missing_fields)) {
                    latestMissingFields = data.missing_fields.slice();
                }
                if (typeof data.brief_score === 'number') {
                    latestBriefScore = data.brief_score;
                }
                renderBriefState({
                    missing_fields: latestMissingFields,
                    memory_summary: (data.marketing_brief && (data.marketing_brief.key_message || data.marketing_brief.offer)) || ''
                });
                queueMemorySave();
                return;
            } catch (e) {
                stopThinking();
                console.warn('Marketing bootstrap failed', e);
            }
        }

        // CASE B: Ask one clean question when no construction context exists.
        const question = "Tell me about your business or project -- what are you looking to promote or grow?";
        await addSystemMessage(question);
        conversationHistory.push({ role: "ai", content: question });
        queueMemorySave();
    }

    // Initialize welcome screen greeting once user is known
    typeWelcomeText();

    // Team chat is always active — ensure humanLog is visible
    (function initTeamChat() {
        const logIA = document.getElementById('terminalLog');
        const logHuman = document.getElementById('humanLog');
        if (logIA) logIA.style.display = 'none';
        if (logHuman) logHuman.style.display = 'flex';
    })();

    if (togglePreviewBtn && previewPanel && buildSection) {
        if (previewPanel.classList.contains('preview-hidden')) {
            buildSection.classList.add('expand-chat');
        }
        togglePreviewBtn.addEventListener('click', () => {
            const hidden = previewPanel.classList.toggle('preview-hidden');
            buildSection.classList.toggle('expand-chat', hidden);
            togglePreviewBtn.textContent = hidden ? 'Show Preview' : 'Hide Preview';
        });
    }

    function formatPlanLabel(plan) {
        const key = (plan || '').toLowerCase();
        if (key.includes('marketing + build') || key.includes('marketing + build')) {
            return 'Marketing + Build';
        }
        if (key.includes('marketing')) return 'Marketing';
        return 'Plan required';
    }

    async function refreshSubscriptionStatus(showMessage = false) {
        try {
            const res = await fetch(`/api/user-stats?email=${currentUser.email}`, { credentials: 'include' });
            const data = await res.json();
            if (data.subscription_active !== undefined) {
                subscriptionActive = !!data.subscription_active;
                subscriptionPlan = data.subscription_plan || 'none';

                // Update plan badge in header
                updatePlanBadge(data);

                if (profileCreditsEl) {
                    profileCreditsEl.textContent = subscriptionActive ? formatPlanLabel(subscriptionPlan) : 'Free';
                }
                if (subscriptionActive && chatLockedForSubscription) {
                    setChatLocked(false);
                }
                syncChatLockWithPendingTicket();
            }
        } catch (e) {
            console.error("Auth Error", e);
        }
    }

    function updatePlanBadge(data) {
        const planDisplay = document.getElementById('planNameDisplay');
        if (!planDisplay) return;
        if (subscriptionActive) {
            planDisplay.textContent = formatPlanLabel(subscriptionPlan);
        } else {
            planDisplay.textContent = 'Free';
        }
    }

    function setChatLocked(locked, message) {
        chatLockedForSubscription = !!locked;
        if (chatInput) chatInput.disabled = chatLockedForSubscription;
        if (sendBtn) sendBtn.disabled = chatLockedForSubscription || !chatInput?.value?.trim();
        if (chatWrap) chatWrap.classList.toggle('locked', chatLockedForSubscription);
        if (locked && message) {
            addLog(message, 'system');
        }
    }

    function syncChatLockWithPendingTicket() {
        // Don't lock the input — we use the modal gate on send instead
        setChatLocked(false);
    }

    async function checkUserCredits() {
        await refreshSubscriptionStatus();
    }

    function showValidateGate() {
        const overlay = document.getElementById('validateGateOverlay');
        if (overlay) overlay.classList.add('active');
    }

    function hideValidateGate() {
        const overlay = document.getElementById('validateGateOverlay');
        if (overlay) overlay.classList.remove('active');
    }

    // Wire up gate modal buttons
    const validateGateBtn = document.getElementById('validateGateBtn');
    const validateGateDismiss = document.getElementById('validateGateDismiss');
    if (validateGateBtn) {
        validateGateBtn.addEventListener('click', async () => {
            if (!currentUser || !currentUser.email) {
                window.location.href = 'login.html';
                return;
            }
            validateGateBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Redirecting...';
            validateGateBtn.disabled = true;
            try {
                const res = await fetch('/api/stripe/create-checkout-session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ email: currentUser.email, plan: 'validate' })
                });
                const data = await res.json();
                if (data.url) {
                    window.location.href = data.url;
                } else {
                    throw new Error(data.error || 'Error starting payment');
                }
            } catch (err) {
                validateGateBtn.innerHTML = '<i class="fas fa-bolt"></i> Start Validating';
                validateGateBtn.disabled = false;
                addLog('Payment error. Please try again.', 'system');
            }
        });
    }
    if (validateGateDismiss) {
        validateGateDismiss.addEventListener('click', hideValidateGate);
    }

    async function requireSubscription() {
        if (subscriptionActive) return true;
        // Refresh once to make sure we have latest status
        await refreshSubscriptionStatus();
        if (subscriptionActive) return true;
        // Not subscribed — show validate gate
        showValidateGate();
        return false;
    }

    if (paywallBtn) {
        paywallBtn.addEventListener('click', () => {
            const modal = document.getElementById('pricing-modal');
            if (modal) modal.style.display = 'flex';
            if (!ensureCheckoutIdentity()) {
                showEmailGate();
            }
        });
    }

    if (paywallEmailBtn) {
        paywallEmailBtn.addEventListener('click', () => {
            const email = (paywallEmailInput?.value || '').trim().toLowerCase();
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!email || !emailRegex.test(email)) {
                addLog('Enter a valid email to continue.', 'warning');
                return;
            }
            setCurrentUserEmail(email);
            hydrateProfile();
            refreshSubscriptionStatus(true);
            if (paywallEmailGate) paywallEmailGate.style.display = 'none';
            const pendingPlan = localStorage.getItem('pendingPlan');
            if (pendingPlan) {
                localStorage.removeItem('pendingPlan');
                setTimeout(() => window.purchasePlan(pendingPlan), 500);
            }
        });
    }

    // State
    let currentProjectName = '';
    let currentPlanContent = '';
    let currentTicketProjectId = '';
    let isProcessing = false;
    let projectLimitReached = false;
    let previewLoadTimer = null;
    let pendingMemorySave = null;
    let selectedEngine = 'antigravity';
    let latestMissingFields = [];
    let latestBriefScore = 0;
    let speechRecognition = null;
    let isVoiceRecording = false;
    let reviewOverlayTimer = null;
    let previewLockedByReview = false;
    let subscriptionActive = false;
    let subscriptionPlan = 'none';
    let chatLockedForSubscription = false;

    const BUILD_REQUIRED_FIELDS = ['summary', 'audience', 'business_model', 'timeline', 'features'];
    const MARKETING_REQUIRED_FIELDS = ['goal', 'audience', 'offer', 'channels', 'budget', 'timeline', 'brand_voice', 'key_message'];
    const ORGANIC_REQUIRED_FIELDS = ['goal', 'audience', 'platforms', 'content_pillars', 'posting_frequency', 'brand_voice', 'key_topics'];
    const CAPITAL_REQUIRED_FIELDS = ['funding_stage', 'amount_needed', 'business_model', 'revenue', 'traction', 'use_of_funds', 'timeline'];
    let currentMarketingBrief = null;
    let currentMarketingAssets = [];

    const CHANNEL_SUFFIXES = { build: '', marketing: '__marketing', organic: '__organic', capital: '__capital' };

    function getActiveProjectKey() {
        if (!currentProjectName) return '';
        const suffix = CHANNEL_SUFFIXES[activeChannel] || '';
        return currentProjectName + suffix;
    }

    function getRequiredFields() {
        if (isMarketingChannel()) return MARKETING_REQUIRED_FIELDS;
        if (isOrganicChannel()) return ORGANIC_REQUIRED_FIELDS;
        if (isCapitalChannel()) return CAPITAL_REQUIRED_FIELDS;
        return BUILD_REQUIRED_FIELDS;
    }

    latestMissingFields = getRequiredFields().slice();

    // Init chat input UI after state is ready
    resizeChatInput();
    updateSendState();

    // Conversation State
    let chatStage = 'initial'; // 'initial', 'refinement', 'ready', 'blueprint', 'building'
    let originalIdea = '';

    // Run on Load
    checkUserCredits().then(() => submitPendingTicketIfAny()).then(() => syncChatLockWithPendingTicket());
    hydrateProfile();
    // ── Welcome modal logic ──
    function showWelcomeModal() {
        const overlay = document.getElementById('welcomeOverlay');
        if (overlay) overlay.classList.add('active');
    }
    function hideWelcomeModal() {
        const overlay = document.getElementById('welcomeOverlay');
        if (overlay) overlay.classList.remove('active');
    }
    // welcomeStartBtn already declared at top — reuse it (no redeclaration)
    if (welcomeStartBtn) {
        welcomeStartBtn.addEventListener('click', () => {
            hideWelcomeModal();
            // Inject team welcome message in chat
            injectTeamWelcomeMessage();
            // Make sure we're on the build tab with chat visible
            if (typeof switchTab === 'function') switchTab('build');
        });
    }

    function injectTeamWelcomeMessage() {
        const container = document.getElementById('humanChatContent');
        if (!container) return;
        const msgRow = document.createElement('div');
        msgRow.className = 'msg-row assistant';
        const msgDiv = document.createElement('div');
        msgDiv.className = 'ai-msg';
        msgDiv.innerHTML = '<strong>Anmar Team</strong><br><br>' +
            'Welcome! Your Validate plan is now active. We\'re excited to work with you.<br><br>' +
            'To get started, tell us about your idea — what are you building and who is it for? ' +
            'The more detail you share, the better roadmap we can create for you.<br><br>' +
            '<span style="color:rgba(255,255,255,0.45); font-size:0.82rem;">A team member will review your message and respond shortly.</span>';
        msgRow.appendChild(msgDiv);
        container.appendChild(msgRow);
        const log = document.getElementById('humanLog');
        if (log) log.scrollTop = log.scrollHeight;
    }

    (function handleCheckoutReturn() {
        const params = new URLSearchParams(window.location.search);
        const status = params.get('checkout');
        const sessionId = params.get('session_id');
        if (!status) return;
        // Clean URL params so they don't persist on refresh
        window.history.replaceState({}, '', window.location.pathname);
        if (status === 'success') {
            localStorage.removeItem('pendingPlan');
            const activateAndWelcome = () => {
                refreshSubscriptionStatus(true)
                    .then(() => submitPendingTicketIfAny())
                    .then(() => {
                        // Show welcome modal after subscription is confirmed
                        showWelcomeModal();
                    });
            };
            if (sessionId) {
                fetch(`/api/stripe/verify-session?session_id=${encodeURIComponent(sessionId)}`, { credentials: 'include' })
                    .then(() => activateAndWelcome())
                    .catch(() => activateAndWelcome());
            } else {
                setTimeout(activateAndWelcome, 1200);
            }
        }
        if (status === 'cancel') {
            addLog("Payment cancelled. You can try again whenever you're ready.", "system");
        }
    })();

    // pendingPlan is consumed later, after window.purchasePlan is defined (see bottom of file)

    async function submitPendingTicketIfAny() {
        const pendingProject = localStorage.getItem('pending_ticket_project') || '';
        if (!pendingProject || !currentUser?.email) return;
        try {
            const res = await fetch('/api/tickets/submit-pending', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ user_email: currentUser.email, project_name: pendingProject })
            });
            const data = await res.json();
            if (data && data.status === 'ok' && Array.isArray(data.tickets) && data.tickets.length) {
                localStorage.removeItem('pending_ticket_project');
                setChatLocked(false);
                addLog("✅ Ticket sent automatically to the team.", "success");
            }
        } catch (e) {
            console.warn('Pending ticket submit failed', e);
        }
    }

    function setInteractionMode(mode) {
        interactionMode = mode === 'edit' ? 'edit' : 'strategy';
        if (!modeStrategyBtn || !modeEditBtn) return;

        if (interactionMode === 'strategy') {
            modeStrategyBtn.style.background = '#10b981';
            modeStrategyBtn.style.color = '#001b12';
            modeStrategyBtn.style.border = 'none';
            modeEditBtn.style.background = 'rgba(255,255,255,0.08)';
            modeEditBtn.style.color = '#cbd5e1';
            modeEditBtn.style.border = '1px solid rgba(255,255,255,0.15)';
        } else {
            modeEditBtn.style.background = '#3b82f6';
            modeEditBtn.style.color = '#eff6ff';
            modeEditBtn.style.border = 'none';
            modeStrategyBtn.style.background = 'rgba(255,255,255,0.08)';
            modeStrategyBtn.style.color = '#cbd5e1';
            modeStrategyBtn.style.border = '1px solid rgba(255,255,255,0.15)';
        }
        renderBriefState();
    }

    function getWelcomeDismissKey() {
        const email = (currentUser?.email || '').toLowerCase();
        return `anmar:welcome_done:${email}`;
    }

    function markWelcomeDone() {
        try {
            localStorage.setItem(getWelcomeDismissKey(), '1');
        } catch (_) { }
    }

    let forceWelcome = true;
    let _wizGoToStep = null;   // exposed so openWelcomeNewProject can reach it
    let _wizClearData = null;  // exposed to clear wizard state from outside

    function initWelcomeScreen() {
        if (!welcomeScreen) return;
        try {
            const alreadyDone = localStorage.getItem(getWelcomeDismissKey());
            forceWelcome = !alreadyDone;
        } catch (_) {
            forceWelcome = true;
        }

        const welcomeFormStep = document.getElementById('welcomeFormStep');
        const welcomeConsultingStep = document.getElementById('welcomeConsultingStep');
        const welcomeSubmitBtn = document.getElementById('welcomeSubmitBtn');
        const welcomeDescInput = document.getElementById('welcomeDescInput');
        const welcomeStatus = document.getElementById('welcomeStatus');

        // No close button — onboarding is mandatory for new users

        // ===================== WIZARD STATE =====================
        let wizCurrentStep = 1;
        const wizData = {};
        _wizClearData = () => { Object.keys(wizData).forEach(k => delete wizData[k]); };

        const wizTitles = [
            'Tell us about your project.',
            'What type of project is this?',
            'What\'s your business model?',
            'Where are you right now?',
            'What do you need help with?'
        ];

        function wizGoToStep(newStep) {
            // Hide all panels
            for (let i = 1; i <= 5; i++) {
                const panel = document.getElementById(`wizPanel${i}`);
                if (panel) panel.style.display = i === newStep ? '' : 'none';
            }
            // Update main heading with the step question
            const titleEl = document.getElementById('welcomeType');
            if (titleEl) {
                titleEl.style.transition = 'opacity 0.2s';
                titleEl.style.opacity = '0';
                setTimeout(() => {
                    titleEl.textContent = wizTitles[newStep - 1];
                    titleEl.style.opacity = '1';
                }, 180);
            }
            // Update progress dots
            document.querySelectorAll('.wiz-dot-wrap').forEach(el => {
                const s = parseInt(el.dataset.step);
                el.classList.toggle('active', s === newStep);
                el.classList.toggle('done', s < newStep);
            });
            // Back button visibility
            const backBtn = document.getElementById('wizBackBtn');
            if (backBtn) backBtn.style.display = newStep > 1 ? '' : 'none';
            // Continue button label
            if (welcomeSubmitBtn) {
                welcomeSubmitBtn.innerHTML = newStep === 5
                    ? 'Launch &ensp;<i class="fas fa-rocket"></i>'
                    : 'Continue &ensp;<i class="fas fa-arrow-right"></i>';
            }
            wizCurrentStep = newStep;
            wizValidateStep(newStep);
            if (welcomeStatus) welcomeStatus.textContent = '';
        }
        _wizGoToStep = wizGoToStep; // expose to outer scope

        function wizValidateStep(step) {
            if (!welcomeSubmitBtn) return;
            if (step === 1) {
                const name = (welcomeInput?.value || '').trim();
                const phone = (welcomePhoneInput?.value || '').trim();
                const desc = (welcomeDescInput?.value || '').trim();
                welcomeSubmitBtn.disabled = !(name && phone && desc);
            } else if (step === 5) {
                // Multi-select: at least 1 card must be selected
                const panel = document.getElementById('wizPanel5');
                welcomeSubmitBtn.disabled = !panel?.querySelector('.wiz-card.selected');
            } else {
                const panel = document.getElementById(`wizPanel${step}`);
                welcomeSubmitBtn.disabled = !panel?.querySelector('.wiz-card.selected');
            }
        }

        // Card click logic for steps 2-4 (single select)
        document.querySelectorAll('#wizPanel2 .wiz-card, #wizPanel3 .wiz-card, #wizPanel4 .wiz-card').forEach(card => {
            card.addEventListener('click', () => {
                // Deselect siblings
                card.closest('.wiz-cards-grid, .wiz-cards-grid-2')?.querySelectorAll('.wiz-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                wizValidateStep(wizCurrentStep);
            });
        });

        // Card click logic for step 5 (multi-select — toggle)
        document.querySelectorAll('#wizPanel5 .wiz-card').forEach(card => {
            card.addEventListener('click', () => {
                card.classList.toggle('selected');
                wizValidateStep(5);
            });
        });

        // Select All button for step 5
        const wizSelectAllBtn = document.getElementById('wizSelectAll');
        if (wizSelectAllBtn) {
            wizSelectAllBtn.addEventListener('click', () => {
                const cards = document.querySelectorAll('#wizPanel5 .wiz-card');
                const allSelected = [...cards].every(c => c.classList.contains('selected'));
                cards.forEach(c => allSelected ? c.classList.remove('selected') : c.classList.add('selected'));
                // Toggle button label
                wizSelectAllBtn.innerHTML = allSelected
                    ? '<i class="fas fa-check-double" style="margin-right:5px;"></i>Select All'
                    : '<i class="fas fa-times" style="margin-right:5px;"></i>Deselect All';
                wizValidateStep(5);
            });
        }

        // Back button
        const wizBackBtn = document.getElementById('wizBackBtn');
        if (wizBackBtn) {
            wizBackBtn.addEventListener('click', () => {
                if (wizCurrentStep > 1) wizGoToStep(wizCurrentStep - 1);
            });
        }

        // Phone format validation
        function isValidPhone(raw) {
            if (!raw) return false;
            const digits = raw.replace(/[\s\-\(\)\+]/g, '');
            if (!/^\d+$/.test(digits)) return false;
            if (digits.length < 7 || digits.length > 15) return false;
            if (/^(\d)\1+$/.test(digits)) return false; // all same digit
            return true;
        }

        // Count real words (≥2 letters) in a string
        function countRealWords(text) {
            return (text.match(/[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ]{2,}/g) || []).length;
        }

        // Validate all 3 fields to enable submit on step 1
        function checkFormValid() {
            if (wizCurrentStep !== 1) return;
            const name = (welcomeInput?.value || '').trim();
            const phone = (welcomePhoneInput?.value || '').trim();
            const desc = (welcomeDescInput?.value || '').trim();
            const descWords = countRealWords(desc);
            const phoneOk = !phone || isValidPhone(phone);
            const valid = !!(name && phone && phoneOk && descWords >= 5);
            if (welcomeSubmitBtn) welcomeSubmitBtn.disabled = !valid;

            // Live hint under phone field
            const phoneHint = document.getElementById('phoneValidHint');
            if (phoneHint) {
                if (!phone) {
                    phoneHint.textContent = '';
                } else if (!phoneOk) {
                    phoneHint.textContent = 'Please enter a valid phone number (e.g. +1 555 123 4567).';
                    phoneHint.style.color = 'rgba(251,146,60,0.85)';
                } else {
                    phoneHint.textContent = '✓ Valid phone number';
                    phoneHint.style.color = 'rgba(52,211,153,0.85)';
                }
            }

            // Live hint under description while typing
            const descHint = document.getElementById('wizDescHint');
            if (descHint) {
                if (!desc) {
                    descHint.textContent = '';
                } else if (descWords < 5) {
                    descHint.textContent = `${descWords}/5 words — describe what your idea does, who it's for, and what problem it solves.`;
                    descHint.style.color = 'rgba(251,146,60,0.85)';
                } else {
                    descHint.textContent = '✓ Good description';
                    descHint.style.color = 'rgba(52,211,153,0.85)';
                }
            }
            if (welcomeStatus) welcomeStatus.textContent = '';
        }

        if (welcomeInput) welcomeInput.addEventListener('input', checkFormValid);
        if (welcomePhoneInput) welcomePhoneInput.addEventListener('input', checkFormValid);
        if (welcomeDescInput) welcomeDescInput.addEventListener('input', checkFormValid);

        // Submit → wizard step advance OR consulting animation → create project → chat
        if (welcomeSubmitBtn) {
            welcomeSubmitBtn.addEventListener('click', async () => {

                // Steps 1-4: collect data and advance
                if (wizCurrentStep < 5) {
                    if (wizCurrentStep === 1) {
                        const name = (welcomeInput?.value || '').trim();
                        const phone = (welcomePhoneInput?.value || '').trim();
                        const desc = (welcomeDescInput?.value || '').trim();
                        if (!name) { if (welcomeStatus) welcomeStatus.textContent = 'Enter a project name.'; return; }
                        if (!phone) { if (welcomeStatus) welcomeStatus.textContent = 'Enter your phone number.'; return; }
                        if (!isValidPhone(phone)) {
                            if (welcomeStatus) welcomeStatus.textContent = 'Please enter a valid phone number (e.g. +1 555 123 4567).';
                            if (welcomePhoneInput) welcomePhoneInput.focus();
                            return;
                        }
                        if (!desc) { if (welcomeStatus) welcomeStatus.textContent = 'Describe your project briefly.'; return; }
                        const descWordCount = countRealWords(desc);
                        if (descWordCount < 5) {
                            if (welcomeStatus) welcomeStatus.textContent = `Please add more detail — describe what your idea does, who it's for, and what problem it solves (${descWordCount}/5 words).`;
                            if (welcomeDescInput) welcomeDescInput.focus();
                            return;
                        }
                        wizData.name = name;
                        wizData.phone = phone;
                        wizData.desc = desc;
                    } else {
                        const panel = document.getElementById(`wizPanel${wizCurrentStep}`);
                        const sel = panel?.querySelector('.wiz-card.selected');
                        if (!sel) return;
                        if (wizCurrentStep === 2) wizData.project_type = sel.dataset.value;
                        if (wizCurrentStep === 3) wizData.business_model = sel.dataset.value;
                        if (wizCurrentStep === 4) {
                            wizData.stage = sel.dataset.value;
                        }
                    }
                    wizGoToStep(wizCurrentStep + 1);
                    return;
                }

                // Step 5: collect help areas → fire animation
                const panel5 = document.getElementById('wizPanel5');
                const selectedHelpCards = panel5?.querySelectorAll('.wiz-card.selected');
                if (!selectedHelpCards || selectedHelpCards.length === 0) return;
                wizData.help_areas = [...selectedHelpCards].map(c => c.dataset.value);

                const name = wizData.name;
                const phone = wizData.phone;
                const desc = wizData.desc;

                // === FUTURISTIC SOUND ENGINE (Web Audio API) ===
                const SFX = (() => {
                    let ctx;
                    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch(_) { ctx = null; }
                    function whoosh(freq = 400, dur = 0.6) {
                        if (!ctx) return;
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        const filter = ctx.createBiquadFilter();
                        osc.type = 'sine';
                        osc.frequency.setValueAtTime(freq * 0.5, ctx.currentTime);
                        osc.frequency.exponentialRampToValueAtTime(freq, ctx.currentTime + dur * 0.3);
                        osc.frequency.exponentialRampToValueAtTime(freq * 0.3, ctx.currentTime + dur);
                        filter.type = 'lowpass';
                        filter.frequency.setValueAtTime(2000, ctx.currentTime);
                        filter.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + dur);
                        gain.gain.setValueAtTime(0, ctx.currentTime);
                        gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + dur * 0.15);
                        gain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + dur * 0.5);
                        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + dur);
                        osc.connect(filter);
                        filter.connect(gain);
                        gain.connect(ctx.destination);
                        osc.start(ctx.currentTime);
                        osc.stop(ctx.currentTime + dur);
                    }
                    function stepComplete() {
                        if (!ctx) return;
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        osc.type = 'sine';
                        osc.frequency.setValueAtTime(880, ctx.currentTime);
                        osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.1);
                        gain.gain.setValueAtTime(0.1, ctx.currentTime);
                        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);
                        osc.connect(gain);
                        gain.connect(ctx.destination);
                        osc.start(ctx.currentTime);
                        osc.stop(ctx.currentTime + 0.25);
                    }
                    function ambient() {
                        if (!ctx) return;
                        // Soft low hum
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        osc.type = 'sine';
                        osc.frequency.setValueAtTime(85, ctx.currentTime);
                        gain.gain.setValueAtTime(0, ctx.currentTime);
                        gain.gain.linearRampToValueAtTime(0.04, ctx.currentTime + 1);
                        gain.gain.setValueAtTime(0.04, ctx.currentTime + 10);
                        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 12);
                        osc.connect(gain);
                        gain.connect(ctx.destination);
                        osc.start(ctx.currentTime);
                        osc.stop(ctx.currentTime + 12);
                        return { stop: () => { try { gain.gain.cancelScheduledValues(ctx.currentTime); gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5); osc.stop(ctx.currentTime + 0.5); } catch(_){} } };
                    }
                    function finalSuccess() {
                        if (!ctx) return;
                        [0, 0.12, 0.24].forEach((delay, i) => {
                            const osc = ctx.createOscillator();
                            const gain = ctx.createGain();
                            osc.type = 'sine';
                            osc.frequency.setValueAtTime([660, 880, 1100][i], ctx.currentTime + delay);
                            gain.gain.setValueAtTime(0, ctx.currentTime + delay);
                            gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + delay + 0.05);
                            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + delay + 0.4);
                            osc.connect(gain);
                            gain.connect(ctx.destination);
                            osc.start(ctx.currentTime + delay);
                            osc.stop(ctx.currentTime + delay + 0.4);
                        });
                    }
                    return { whoosh, stepComplete, ambient, finalSuccess };
                })();

                // Switch to consulting animation
                if (welcomeFormStep) welcomeFormStep.style.display = 'none';
                if (welcomeConsultingStep) welcomeConsultingStep.style.display = 'block';
                if (welcomeCloseBtn) welcomeCloseBtn.style.display = 'none';
                const wizTypeHeading = document.getElementById('welcomeType');
                if (wizTypeHeading) wizTypeHeading.textContent = "We're setting everything up.";

                // Start ambient hum
                const ambientHum = SFX.ambient();
                SFX.whoosh(300, 0.8);

                // Animate steps progressively
                const steps = [
                    document.getElementById('consultStep1'),
                    document.getElementById('consultStep2'),
                    document.getElementById('consultStep3'),
                    document.getElementById('consultStep4')
                ];
                const titles = [
                    'Setting up your workspace...',
                    'Analyzing project requirements...',
                    'Matching you with the right engineer...',
                    'Almost ready — preparing your consultation...'
                ];
                const titleEl = document.getElementById('consultingTitle');
                const progressBar = document.getElementById('consultingProgressBar');

                // Crear proyecto en background — skipNavigation:true evita que
                // setWelcomeVisible(false) y switchTab() interrumpan la animación
                let _createError = '';
                const createPromise = createProjectByName(name, {
                    showAlert: false,
                    skipNavigation: true,
                    phone,
                    description: desc,
                    project_type: wizData.project_type || '',
                    business_model: wizData.business_model || '',
                    stage: wizData.stage || '',
                    onError: (msg) => {
                        _createError = msg || 'Error creating project.';
                    }
                });

                // Set initial progress
                if (progressBar) progressBar.style.width = '15%';

                // Animate through steps — SLOWER for premium feel
                const stepDelays = [2800, 3200, 2600]; // Time before each new step
                for (let i = 1; i < steps.length; i++) {
                    await new Promise(r => setTimeout(r, stepDelays[i-1]));
                    // Sound: whoosh for transition + chime for completion
                    SFX.whoosh(350 + i * 80, 0.5);
                    SFX.stepComplete();
                    // Mark previous step as done
                    if (steps[i-1]) {
                        steps[i-1].classList.remove('active');
                        steps[i-1].classList.add('done');
                        steps[i-1].querySelector('i').className = 'fas fa-check-circle';
                    }
                    // Activate current step
                    if (steps[i]) {
                        steps[i].classList.add('active');
                        steps[i].querySelector('i').className = 'fas fa-circle-notch fa-spin';
                    }
                    if (titleEl) titleEl.textContent = titles[i];
                    // Update progress bar
                    if (progressBar) progressBar.style.width = `${25 + i * 22}%`;
                }

                // Wait for project creation to finish
                const created = await createPromise;

                // Mark last step done
                await new Promise(r => setTimeout(r, 1200));
                SFX.stepComplete();
                if (steps[3]) {
                    steps[3].classList.remove('active');
                    steps[3].classList.add('done');
                    steps[3].querySelector('i').className = 'fas fa-check-circle';
                }
                if (progressBar) progressBar.style.width = '100%';

                // Stop ambient, play success
                if (ambientHum) ambientHum.stop();
                await new Promise(r => setTimeout(r, 400));
                SFX.finalSuccess();
                if (titleEl) titleEl.textContent = 'Your team is ready!';

                await new Promise(r => setTimeout(r, 600));

                if (created) {
                    forceWelcome = false;
                    markWelcomeDone();

                    // ── NEW FLOW: close wizard → switch to Business Model tab → stream AI analysis ──
                    if (welcomeScreen) welcomeScreen.classList.add('fade-out');
                    setTimeout(async () => {
                        setWelcomeVisible(false);

                        // Switch to Business Model tab
                        switchTab('business');

                        // Collect wizard data for the AI
                        const projectInfo = {
                            project_name: name,
                            description: desc || '',
                            project_type: wizData.project_type || '',
                            business_model: wizData.business_model || '',
                            stage: wizData.stage || ''
                        };

                        await generateBusinessModelStream(projectInfo);
                    }, 350);
                } else {
                    // Error — go back to wizard step 1 showing the real error
                    if (welcomeFormStep) welcomeFormStep.style.display = 'block';
                    if (welcomeConsultingStep) welcomeConsultingStep.style.display = 'none';
                    if (welcomeCloseBtn) welcomeCloseBtn.style.display = '';
                    wizGoToStep(1);
                    if (welcomeStatus) welcomeStatus.textContent = _createError || 'Something went wrong. Please try again.';
                }
            });
        }

        // Only hide welcome if user already completed onboarding
        // If forceWelcome is true (new user), keep it visible — session restore will handle showing it
        if (!forceWelcome) {
            setWelcomeVisible(false);
        }
    }

    // Inject chat message after onboarding is complete
    function injectOnboardingChatMessage(projectName) {
        const container = document.getElementById('humanChatContent');
        const welcomeDiv = document.getElementById('humanChatWelcome');
        if (welcomeDiv) welcomeDiv.style.display = 'none';
        if (container) {
            const msgRow = document.createElement('div');
            msgRow.className = 'msg-row ai';
            msgRow.innerHTML = `
                <div class="ai-msg" style="padding:16px 20px;">
                    <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                        <div style="width:36px; height:36px; border-radius:10px; background:linear-gradient(135deg,#3b82f6,#8b5cf6); display:flex; align-items:center; justify-content:center;">
                            <i class="fas fa-user-tie" style="color:#fff; font-size:0.85rem;"></i>
                        </div>
                        <div>
                            <div style="font-weight:700; font-size:0.85rem; color:#e2e8f0;">Anmar Engineering Team</div>
                            <div style="font-size:0.72rem; color:#64748b;">Just now</div>
                        </div>
                    </div>
                    <div style="color:#cbd5e1; font-size:0.9rem; line-height:1.6;">
                        Hi! We've reviewed your project <strong style="color:#60a5fa;">${escapeHtml(projectName)}</strong> and an engineer is being assigned to you. Tell us more about your idea — what problem does it solve and who is it for?
                    </div>
                </div>
            `;
            container.appendChild(msgRow);
        }
    }

    window.openWelcomeNewProject = function () {
        forceWelcome = true;
        const welcomeFormStep = document.getElementById('welcomeFormStep');
        const welcomeConsultingStep = document.getElementById('welcomeConsultingStep');
        if (welcomeFormStep) welcomeFormStep.style.display = 'block';
        if (welcomeConsultingStep) welcomeConsultingStep.style.display = 'none';
        if (welcomeInput) welcomeInput.value = '';
        if (welcomePhoneInput) welcomePhoneInput.value = '';
        const descInput = document.getElementById('welcomeDescInput');
        if (descInput) descInput.value = '';
        // Reset all wizard card selections
        document.querySelectorAll('.wiz-card.selected').forEach(c => c.classList.remove('selected'));
        // Clear wizard data collected in previous runs
        if (_wizClearData) _wizClearData();
        // Go back to step 1 (resets dots, back btn, button label)
        if (_wizGoToStep) {
            _wizGoToStep(1);
        } else {
            const submitBtn = document.getElementById('welcomeSubmitBtn');
            if (submitBtn) submitBtn.disabled = true;
        }
        const welcomeStatus = document.getElementById('welcomeStatus');
        if (welcomeStatus) welcomeStatus.textContent = '';
        setWelcomeVisible(true);
        // Do NOT call switchTab here — it triggers loadProjects which hides the welcome
    }

    initWelcomeScreen();

    window.addEventListener('error', (event) => {
        try {
            if (welcomeStatus) {
                welcomeStatus.textContent = `Internal error: ${event.message || 'Check the console.'}`;
            }
        } catch (e) {}
    });

    function typeWelcomeText() {
        if (!welcomeType || welcomeTyped) return;
        welcomeTyped = true;
        const rawName = (currentUser?.name || '').trim();
        const displayName = rawName || 'there';
        const isReturning = !forceWelcome;
        const text = isReturning
            ? `Welcome back, ${displayName}! What are we building today?`
            : `Welcome, ${displayName}! Let's turn your idea into a business.`;
        let idx = 0;
        welcomeType.textContent = '';
        const tick = () => {
            if (!welcomeType) return;
            if (idx <= text.length) {
                welcomeType.textContent = text.slice(0, idx);
                idx += 1;
                setTimeout(tick, 24);
            } else {
                welcomeType.innerHTML = `${text}<span class="caret">|</span>`;
            }
        };
        tick();
    }

    function setWelcomeVisible(show) {
        if (!welcomeScreen) return;
            if (show) {
                welcomeScreen.style.display = '';
                welcomeScreen.classList.add('visible');
                welcomeScreen.classList.remove('fade-out');
                document.body.classList.add('welcome-mode');
                if (welcomeInput) {
                    welcomeInput.value = '';
                }
                if (welcomePhoneInput) {
                    welcomePhoneInput.value = '';
                }
                const descInput = document.getElementById('welcomeDescInput');
                if (descInput) descInput.value = '';
                const submitBtn = document.getElementById('welcomeSubmitBtn');
                if (submitBtn) submitBtn.disabled = true;
                const formStep = document.getElementById('welcomeFormStep');
                const consultStep = document.getElementById('welcomeConsultingStep');
                if (formStep) formStep.style.display = 'block';
                if (consultStep) consultStep.style.display = 'none';
                if (welcomeCloseBtn) welcomeCloseBtn.style.display = '';
                typeWelcomeText();
            } else {
                welcomeScreen.classList.remove('visible');
                document.body.classList.remove('welcome-mode');
            }
    }

    function setSelectedEngine(engine, logChange = false) {
        const normalized = (engine === 'openai_codex') ? 'openai_codex' : 'antigravity';
        selectedEngine = normalized;
        if (engineSelector) engineSelector.value = normalized;
        if (logChange) {
            const label = normalized === 'openai_codex' ? 'Codex' : 'Antigravity';
            addLog(`Active engine: ${label}`, 'system');
        }
    }

    function getLastProjectStorageKey() {
        const email = (currentUser?.email || '').toLowerCase();
        return `anmar:last_project:${email}`;
    }

    function persistCurrentProject() {
        try {
            const key = getLastProjectStorageKey();
            if (!key) return;
            if (currentProjectName) {
                localStorage.setItem(key, currentProjectName);
            } else {
                localStorage.removeItem(key);
            }
        } catch (_) { }
    }

    function clearChatMessages() {
        if (!terminalContent) return;
        const messages = terminalContent.querySelectorAll('.msg-row');
        messages.forEach((node) => {
            if (!resultSection || !resultSection.contains(node)) node.remove();
        });
    }

    function appendUserMessageFromMemory(text) {
        if (!terminalContent) return;
        const msgRow = document.createElement('div');
        msgRow.className = 'msg-row user';
        const bubble = document.createElement('div');
        bubble.className = 'user-msg';
        bubble.textContent = String(text || '');
        msgRow.appendChild(bubble);
        terminalContent.insertBefore(msgRow, resultSection);
    }

    function appendAiMessageFromMemory(text) {
        if (!terminalContent) return;
        const msgRow = document.createElement('div');
        msgRow.className = 'msg-row ai';
        const bubble = document.createElement('div');
        bubble.className = 'ai-msg';
        bubble.style.whiteSpace = 'pre-wrap';
        bubble.textContent = String(text || '');
        msgRow.appendChild(bubble);
        terminalContent.insertBefore(msgRow, resultSection);
    }

    function renderConversationHistory(savedHistory) {
        const history = Array.isArray(savedHistory) ? savedHistory.slice(-28) : [];
        if (!history.length) return false;
        history.forEach((msg) => {
            const role = String(msg?.role || '').toLowerCase();
            const content = msg?.content || '';
            if (!content) return;
            if (role === 'user') appendUserMessageFromMemory(content);
            else appendAiMessageFromMemory(content);
        });
        terminalContent.scrollTop = terminalContent.scrollHeight;
        return true;
    }

    if (modeStrategyBtn) {
        modeStrategyBtn.addEventListener('click', () => {
            setInteractionMode('strategy');
            addLog("Strategy mode active: briefing, refinement, and handoff.", "system");
        });
    }

    if (modeEditBtn) {
        modeEditBtn.addEventListener('click', () => {
            setInteractionMode('edit');
            addLog("Edit mode active: direct changes to the project.", "system");
        });
    }

    if (engineSelector) {
        engineSelector.addEventListener('change', () => {
            setSelectedEngine(engineSelector.value, true);
            queueMemorySave();
        });
    }
    setSelectedEngine('antigravity');

    if (blueprintNowBtn) {
        blueprintNowBtn.addEventListener('click', async () => {
            if (interactionMode !== 'strategy') {
                addLog("Switch to Strategy mode to generate the blueprint.", "warning");
                return;
            }
            if (!currentProjectName) {
                addLog("First create or select a project.", "warning");
                switchTab('projects');
                return;
            }
            const seed = (briefSummaryText?.textContent || originalIdea || '').trim();
            if (!seed) {
                addLog("Still missing context to build. Better describe the idea in the chat.", "warning");
                return;
            }
            setLoading(true);
            try {
                addLog("Generating blueprint and building initial version...", "system");
                await handleGeneratePlan(seed);
            } catch (e) {
                addLog(`Build failed: ${e.message}`, "error");
            } finally {
                setLoading(false);
            }
        });
    }

    // --- Terminal & Log Logic ---

    async function hydrateProfile() {
        if (!currentUser) return;
        if (profileNameEl) profileNameEl.textContent = currentUser.name || 'Anmar User';
        if (profileEmailEl) profileEmailEl.textContent = currentUser.email || '';
        if (profileMemberSinceEl) {
            profileMemberSinceEl.textContent = `Active in Anmar`;
        }
        await checkUserCredits();
    }

    function openSubscriptionModal(message) {
        if (message) addLog(message, 'warning');
        const modal = document.getElementById('pricing-modal');
        if (modal) modal.style.display = 'flex';
        if (!ensureCheckoutIdentity()) {
            showEmailGate();
        }
    }

    function renderBriefState(meta = {}) {
        // No-op: brief state panel removed from UI
        if (Array.isArray(meta.missing_fields)) {
            latestMissingFields = meta.missing_fields.slice();
        }
    }

    function setTimelineVisible(visible) {
        // No-op: timeline removed from UI
    }

    function addLog(text, type = 'info') {
        if (!terminalContent) return; // guard: terminal not in DOM yet
        const msgRow = document.createElement('div');
        msgRow.className = 'msg-row ai';

        let color = '#ccc'; // default
        let prefix = '>';

        if (type === 'design') { color = '#d946ef'; prefix = '[George // DESIGN]'; }
        if (type === 'eng') { color = '#3b82f6'; prefix = '[Julian // DEV]'; }
        if (type === 'system') { color = '#10b981'; prefix = '[ANMAR // CORE]'; }
        if (type === 'success') { color = '#22c55e'; prefix = '[OK]'; }
        if (type === 'warning') { color = '#f59e0b'; prefix = '[WARN]'; }
        if (type === 'error') { color = '#ef4444'; prefix = '[ERROR]'; }

        msgRow.innerHTML = `<div class="ai-msg" style="font-family:'JetBrains Mono'; font-size: 0.85rem; color:${color}; opacity:0.9;">
            <span style="opacity:0.6; margin-right:8px;">${prefix}</span> ${text}
        </div>`;

        terminalContent.insertBefore(msgRow, resultSection || null);
        terminalContent.scrollTop = terminalContent.scrollHeight;
    }
    window.addLog = addLog; // Expose globally

    async function addSystemMessage(htmlContent) {
        if (!terminalContent) return; // guard: terminal not in DOM yet
        const msgRow = document.createElement('div');
        msgRow.className = 'msg-row ai';

        // Container for text
        const contentDiv = document.createElement('div');
        contentDiv.className = 'ai-msg';
        contentDiv.style.whiteSpace = 'pre-wrap';
        msgRow.appendChild(contentDiv);

        terminalContent.insertBefore(msgRow, resultSection || null);

        // COMPLEX HTML (Cards, lists, buttons) -> Render instant with fade
        if (htmlContent.includes('<div') || htmlContent.includes('<ul') || htmlContent.includes('<button')) {
            contentDiv.innerHTML = htmlContent;
            contentDiv.style.animation = 'fadeIn 0.5s ease';
            terminalContent.scrollTop = terminalContent.scrollHeight;
            return;
        }

        // TEXT STREAMING (Gemini Style)
        const speed = 15; // ms per char
        // Regex to split by tags so we don't type "<", "b", "r", ">"
        const chunks = htmlContent.split(/(<[^>]*>)/g).filter(x => x);

        for (const chunk of chunks) {
            if (chunk.startsWith('<')) {
                contentDiv.innerHTML += chunk; // Add tag instantly
            } else {
                for (let char of chunk) {
                    contentDiv.innerHTML += char;
                    terminalContent.scrollTop = terminalContent.scrollHeight;
                    await new Promise(r => setTimeout(r, speed));
                }
            }
        }
    }
    window.addSystemMessage = addSystemMessage; // Expose globally

    async function safeReadJson(res) {
        const text = await res.text();
        try {
            return { data: JSON.parse(text), text };
        } catch (_) {
            return { data: null, text };
        }
    }

    function addUserMessage(text) {
        if (!terminalContent) return;
        const msgRow = document.createElement('div');
        msgRow.className = 'msg-row user';
        msgRow.innerHTML = `<div class="user-msg">${text}</div>`;
        terminalContent.insertBefore(msgRow, resultSection || null);
        terminalContent.scrollTop = terminalContent.scrollHeight;
    }

    function formatMetricValue(value, suffix = '') {
        if (value === null || value === undefined || value === '') return '--';
        const num = Number(value);
        if (Number.isNaN(num)) return String(value);
        if (suffix === '%') return `${num.toFixed(1)}%`;
        if (suffix === '$') return `$${num.toFixed(2)}`;
        if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
        if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
        return String(Math.round(num));
    }

    function normalizePlatformLabel(raw) {
        const name = String(raw || '').toLowerCase().trim();
        if (!name) return '';
        if (name.includes('instagram')) return 'Instagram';
        if (name.includes('tiktok')) return 'TikTok';
        if (name.includes('youtube')) return 'YouTube';
        if (name.includes('facebook') || name.includes('meta')) return 'Facebook';
        if (name.includes('google') || name.includes('search') || name.includes('ads')) return 'Google Ads';
        if (name.includes('linkedin')) return 'LinkedIn';
        if (name.includes('twitter') || name === 'x') return 'X';
        if (name.includes('pinterest')) return 'Pinterest';
        return raw;
    }

    function findPlatformCard(platformLabel) {
        if (!marketingPreviewContainer) return null;
        const cards = Array.from(marketingPreviewContainer.querySelectorAll('.social-card'));
        const normalized = String(platformLabel || '').toLowerCase();
        return cards.find(card => String(card.dataset.platform || '').toLowerCase() === normalized) || null;
    }

    function renderMarketingPreview(assets = []) {
        if (!marketingPreviewContainer) return;
        const list = Array.isArray(assets) ? assets : [];
        if (!list.length) return;
        list.forEach(asset => {
            const platformLabel = normalizePlatformLabel(asset.platform || '');
            const card = findPlatformCard(platformLabel);
            if (!card) return;
            const format = card.querySelector('.social-format');
            const hook = card.querySelector('[data-role="hook"]');
            const caption = card.querySelector('[data-role="caption"]');
            const cta = card.querySelector('[data-role="cta"]');
            const tags = card.querySelector('[data-role="hashtags"]');
            if (format && asset.format) format.textContent = asset.format;
            if (hook && asset.hook) hook.textContent = asset.hook;
            if (caption && asset.caption) caption.textContent = asset.caption;
            if (cta && asset.cta) cta.textContent = `CTA: ${asset.cta}`;
            if (tags && Array.isArray(asset.hashtags) && asset.hashtags.length) tags.textContent = asset.hashtags.join(' ');

            const metrics = asset.metrics || asset.metric_hint || {};
            const viewsEl = card.querySelector('[data-metric="views"]');
            const ctrEl = card.querySelector('[data-metric="ctr"]');
            const cpcEl = card.querySelector('[data-metric="cpc"]');
            if (viewsEl) viewsEl.textContent = formatMetricValue(metrics.views || metrics.reach || metrics.impressions || '');
            if (ctrEl) ctrEl.textContent = formatMetricValue(metrics.ctr || metrics.engagement_rate || '', '%');
            if (cpcEl) cpcEl.textContent = formatMetricValue(metrics.cpc || metrics.cpa || '', '$');
        });
    }

    function updateAttachmentStatus() {
        if (!attachmentStatus) return;
        if (!pendingImageDataUrl) {
            attachmentStatus.style.display = 'none';
            attachmentStatus.textContent = '';
            return;
        }
        attachmentStatus.style.display = 'block';
        attachmentStatus.textContent = `Attached image: ${pendingImageName || 'archivo'} (will be sent with the message)`;
    }

    function clearPendingAttachment() {
        pendingImageDataUrl = '';
        pendingImageName = '';
        if (imageUploadInput) imageUploadInput.value = '';
        updateAttachmentStatus();
        updateSendState();
    }

    function initVoiceInput() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition || !voiceInputBtn) {
            if (voiceInputBtn) {
                voiceInputBtn.disabled = true;
                voiceInputBtn.title = 'Tu navegador no soporta dictado por voz';
                voiceInputBtn.style.opacity = '0.5';
                voiceInputBtn.style.cursor = 'not-allowed';
            }
            return;
        }
        speechRecognition = new SpeechRecognition();
        speechRecognition.lang = 'es-ES';
        speechRecognition.interimResults = true;
        speechRecognition.continuous = false;

        speechRecognition.onstart = () => {
            isVoiceRecording = true;
            voiceInputBtn.style.background = 'rgba(239,68,68,0.2)';
            voiceInputBtn.style.color = '#fecaca';
            addLog('Microphone active. Speak now...', 'system');
        };

        speechRecognition.onresult = (event) => {
            let transcript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript || '';
            }
            if (transcript.trim()) {
                chatInput.value = transcript.trim();
                resizeChatInput();
                updateSendState();
            }
        };

        speechRecognition.onend = () => {
            isVoiceRecording = false;
            voiceInputBtn.style.background = 'rgba(16,185,129,0.15)';
            voiceInputBtn.style.color = '#a7f3d0';
        };

        speechRecognition.onerror = () => {
            isVoiceRecording = false;
            voiceInputBtn.style.background = 'rgba(16,185,129,0.15)';
            voiceInputBtn.style.color = '#a7f3d0';
            addLog('Could not use microphone this time.', 'warning');
        };
    }

    // --- SIMULATION ENGINE ---
    async function simulateTeamExecution() {
        // 1. System Analysis
        addLog("Analizando requerimientos del cliente...", "system");
        await new Promise(r => setTimeout(r, 800));

        addLog("Architecture validated. Deploying expert team.", "system");
        await new Promise(r => setTimeout(r, 1000));

        // 2. Dispatch to Experts
        // 2. Dispatch to Experts (THEATER V2 - High Latency)
        addLog("Ticket #4092 asignado a: George (Lead Designer)", "info");
        await new Promise(r => setTimeout(r, 2000));

        addLog("George: Escaneando patrones de UI competitivos...", "design");
        await new Promise(r => setTimeout(r, 2500));

        addLog("George: Definiendo paleta de colores (Deep Dark Mode)...", "design");
        await new Promise(r => setTimeout(r, 2500));

        addLog("Ticket #4093 asignado a: Julian (Senior FullStack)", "info");
        await new Promise(r => setTimeout(r, 2000));

        addLog("Julian: Initializing development environment (Python/React)...", "eng");
        await new Promise(r => setTimeout(r, 2500));

        // 3. Work Simulation
        addLog("George: Aplicando principios de Glassmorphism v2.0...", "design");
        await new Promise(r => setTimeout(r, 3000));

        addLog("Julian: Structuring semantic HTML with Tailwind CDN...", "eng");
        await new Promise(r => setTimeout(r, 2500));

        addLog("Julian: Injecting interactivity scripts...", "eng");
        await new Promise(r => setTimeout(r, 2000));

        addLog("Synchronizing Frontend and Backend modules...", "system");
        await new Promise(r => setTimeout(r, 1000));

        // FINAL SUCCESS MESSAGE WITH "HUMAN CRAFTSMANSHIP" UPSELL
        const successMsg = `
            <div style="border-left: 3px solid #10b981; padding-left: 10px; margin-top: 10px;">
                <div style="color:#10b981; font-weight:bold;">✨ Preview Generated by Anmar Engine</div>
                <div style="color:#ccc; font-size:0.85rem; margin-top:5px;">
                    This is a functional prototype automatically generated at 10x speed.
                </div>
                <div style="background:rgba(255,255,255,0.05); padding:8px; margin-top:8px; border-radius:4px; font-size:0.8rem; color:#aaa;">
                    <i class="fas fa-hammer" style="color:#fbbf24; margin-right:5px;"></i>
                    <strong>Next Level:</strong> Our elite engineering team (George & Julian) is ready to polish, secure, and scale this code with human craftsmanship.
                </div>
                <button onclick="triggerHumanRefinement()" style="background: linear-gradient(90deg, #10b981 0%, #059669 100%); border:none; color:white; padding:8px 16px; border-radius:4px; margin-top:10px; cursor:pointer; font-weight:bold; font-size:0.8rem; box-shadow:0 4px 12px rgba(16,185,129,0.3);">
                    💎 Request Human Refinement
                </button>
            </div>
        `;
        addSystemMessage(successMsg);
    }

    // New Function for the Button
    window.triggerHumanRefinement = function () {
        if (typeof switchChatTab === 'function') {
            switchChatTab('Human');
            const chatBox = document.getElementById('chatInput');
            if (chatBox) chatBox.focus();
        } else {
            const instruction = prompt("Describe what aspects you want our team to polish or improve (e.g: 'Improve animations', 'Integrate payment gateway', 'Optimize SEO'):");
            if (instruction) {
                handleEditProject(instruction); // Reuses the hybrid ticket logic
            }
        }
    }

    async function handleMarketingChat(userInput, imageDataUrl = '') {
        if (!currentProjectName) {
            addLog("First create or select a project in the Projects module.", "system");
            switchTab('projects');
            return;
        }
        if (isResetIntent(userInput)) {
            try {
                await fetch('/api/chat-memory/reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        user_email: currentUser.email,
                        email: currentUser.email,
                        project_name: getActiveProjectKey()
                    })
                });
            } catch (_) { }
            await resetContext();
            return;
        }

        conversationHistory.push({ role: "user", content: userInput });
        queueMemorySave();

        showThinking("Analyzing market and assets...");
        try {
            const res = await fetch('/api/continue-marketing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    history: conversationHistory.slice(-28),
                    message: userInput,
                    image_data_url: imageDataUrl,
                    user_email: currentUser.email,
                    project_name: getActiveProjectKey(),
                    channel: activeChannel
                })
            });
            const { data } = await safeReadJson(res);
            stopThinking();
            if (!data) {
                throw new Error(`Server returned HTML (status ${res.status}).`);
            }
            if (!res.ok) {
                throw new Error(data.error || 'Marketing error');
            }
            if (data.ai_reply) {
                await addSystemMessage(data.ai_reply);
                conversationHistory.push({ role: "ai", content: data.ai_reply });
            }
            if (Array.isArray(data.preview_assets)) {
                currentMarketingAssets = data.preview_assets;
                renderMarketingPreview(currentMarketingAssets);
            }
            if (data.marketing_brief) {
                currentMarketingBrief = data.marketing_brief;
            }
            if (Array.isArray(data.missing_fields)) {
                latestMissingFields = data.missing_fields.slice();
            }
            if (typeof data.brief_score === 'number') {
                latestBriefScore = data.brief_score;
            }
            renderBriefState({
                missing_fields: latestMissingFields,
                memory_summary: (data.marketing_brief && (data.marketing_brief.key_message || data.marketing_brief.offer)) || ''
            });
            if (data.ready_for_handoff) {
                addSystemMessage(`
                    <div style="background:rgba(56,189,248,0.1); border:1px solid rgba(56,189,248,0.35); padding:16px; border-radius:12px; margin-top:12px;">
                        <h3 style="color:#38bdf8; margin:0 0 8px 0;">Brief ready for marketing team</h3>
                        <p style="color:#cbd5f5; font-size:0.85rem; margin:0 0 10px 0;">Do you want to send this to the human team for production and launch?</p>
                        <button onclick="window.sendMarketingBrief()" style="background:#38bdf8; color:#0f172a; border:none; padding:10px 16px; border-radius:8px; font-weight:700; cursor:pointer; width:100%;">
                            Send to Marketing
                        </button>
                    </div>
                `);
            }
            if (data.auto_handoff) {
                await window.sendMarketingBrief();
            }
            queueMemorySave();
        } catch (e) {
            stopThinking();
            addLog(`Error marketing: ${e.message}`, "error");
        }
    }

    window.sendMarketingBrief = async function () {
        if (!currentProjectName || !currentUser?.email) {
            addLog("Select a project before sending the brief.", "warning");
            return;
        }
        const okSubscription = await requireSubscription();
        if (!okSubscription) return;
        const brief = currentMarketingBrief || {};
        const assets = Array.isArray(currentMarketingAssets) ? currentMarketingAssets : [];
        const summary = [
            `Marketing Brief: ${brief.key_message || brief.goal || 'Campaign'}`,
            brief.audience ? `Audience: ${brief.audience}` : '',
            brief.offer ? `Offer: ${brief.offer}` : '',
            brief.channels ? `Channels: ${Array.isArray(brief.channels) ? brief.channels.join(', ') : brief.channels}` : '',
            brief.timeline ? `Timeline: ${brief.timeline}` : '',
            brief.budget ? `Budget: ${brief.budget}` : ''
        ].filter(Boolean).join('\n');

        const assetLines = assets.map(item => {
            const platform = item.platform || 'Social';
            const hook = item.hook || '';
            const caption = item.caption || '';
            return `- ${platform}: ${hook} ${caption}`.trim();
        }).join('\n');

        const payloadText = `${summary}\n\nSuggested assets:\n${assetLines || 'Pending definition.'}`;
        try {
            await fetch('/api/human-chat/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    project_name: getActiveProjectKey(),
                    role: 'client',
                    content: payloadText,
                    actor: currentUser.name || 'Client',
                    client_email: currentUser.email || ''
                })
            });
            addLog("Brief sent to marketing team.", "success");
            if (typeof switchChatTab === 'function') switchChatTab('Human');
            pollHumanChat();
        } catch (e) {
            addLog(`Could not send brief: ${e.message}`, "warning");
        }
    }

    // --- 1. Main Chat Handler (Team Chat Only) ---
    if (sendBtn) sendBtn.addEventListener('click', async () => {
        if (window.__sendDebounce) return;
        window.__sendDebounce = true;
        setTimeout(() => { window.__sendDebounce = false; }, 1500);

        const text = chatInput.value.trim();
        if (!text && !pendingImageDataUrl) return;
        if (isProcessing) return;

        // --- VALIDATE GATE: check subscription before allowing chat ---
        const hasAccess = await requireSubscription();
        if (!hasAccess) {
            window.__sendDebounce = false;
            return;
        }

        // If no project yet after subscription check, force onboarding
        if (!currentProjectName) {
            window.openWelcomeNewProject();
            window.__sendDebounce = false;
            return;
        }

        // --- TEAM CHAT FLOW (always active) ---
        const messageToSend = text;
        chatInput.value = '';
        resizeChatInput();
        const msgRow = document.createElement('div');
        msgRow.className = 'msg-row user';
        const msgDiv = document.createElement('div');
        msgDiv.className = 'user-msg';
        msgDiv.textContent = messageToSend;
        msgRow.appendChild(msgDiv);
        const container = document.getElementById('humanChatContent');
        if (container) container.appendChild(msgRow);
        const log = document.getElementById('humanLog');
        if (log) log.scrollTop = log.scrollHeight;
        lastHumanChatCount++; // optimistic update
        updateSendState();

        if (!window.__humanAssignedOnce) {
            window.__humanAssignedOnce = true;
            const startAt = Date.now();
            const channelLabels = {
                build: { searching: 'Looking for available engineer', assigning: 'Assigning engineer and reviewing your request', done: 'Engineer found', connected: 'William is connected and ready to help you.' },
                marketing: { searching: 'Looking for marketing strategist', assigning: 'Assigning strategist and reviewing your brief', done: 'Strategist found', connected: 'Marketing team connected and ready to help you.' },
                organic: { searching: 'Looking for content creator', assigning: 'Assigning creator and reviewing your goals', done: 'Creator found', connected: 'Content team connected and ready to help you.' },
                capital: { searching: 'Looking for capital advisor', assigning: 'Assigning advisor and reviewing your needs', done: 'Advisor found', connected: 'Capital team connected and ready to help you.' }
            };
            const labels = channelLabels[activeChannel] || channelLabels.build;
            const searchRow = addHumanSystemMessage(`${labels.searching}... 0s`);
            const searchEl = searchRow ? searchRow.querySelector('.ai-msg') : null;
            if (window.__humanSearchTimer) clearInterval(window.__humanSearchTimer);
            window.__humanSearchTimer = setInterval(() => {
                const elapsed = Math.max(0, Math.floor((Date.now() - startAt) / 1000));
                if (searchEl) searchEl.textContent = `${labels.searching}... ${elapsed}s`;
            }, 1000);
            setTimeout(() => {
                addHumanSystemMessage(`${labels.assigning}...`);
            }, 2600);
            setTimeout(() => {
                if (window.__humanSearchTimer) clearInterval(window.__humanSearchTimer);
                const total = Math.max(0, Math.floor((Date.now() - startAt) / 1000));
                if (searchEl) searchEl.textContent = `${labels.done} in ${total}s.`;
                addHumanSystemMessage(`${labels.connected}`);
            }, 5200);
        }

        try {
            const response = await fetch('/api/human-chat/send', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    project_name: getActiveProjectKey(),
                    role: 'client',
                    content: messageToSend,
                    actor: currentUser.name || 'Client',
                    client_email: currentUser.email || ''
                })
            });
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                addHumanSystemMessage('Error sending message. Try again.');
                console.error('Human chat send error:', errData);
                return;
            }
            pollHumanChat();
        } catch (e) {
            addHumanSystemMessage('Connection error. Check your internet.');
            console.error('Human chat send failed:', e);
        }
        return;
    });

    // Chat stays open until the ticket submission step. No paywall on focus.

    // --- Logic: Generate Blueprint ---
    async function handleBlueprintGeneration(fullContext) {
        showThinking("Architecting solution...");
        await new Promise(r => setTimeout(r, 2000));

        try {
            const response = await fetch('/create-blueprint', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ idea: fullContext })
            });
            const data = await response.json();

            stopThinking();
            chatStage = 'blueprint';

            // Store plan for handleBuildClick fallback
            window.lastGeneratedPlan = data.blueprint || fullContext;

            // Show Blueprint + Action Button (Clean Layout)
            const bpHtml = `
                <div style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); padding:1rem; font-family:'JetBrains Mono', monospace; font-size:0.8rem; color:#ccc; max-height:300px; overflow-y:auto; border-radius:6px; margin-bottom:10px;">
                    ${data.blueprint.replace(/\n/g, '<br>')}
                </div>
                <div>Approve this architecture?</div>
            `;
            addSystemMessage(bpHtml);

            // Show the Build Button Container
            resultSection.style.display = 'block';

            // Bind the Build Button inside resultSection
            if (buildBtn) {
                buildBtn.onclick = async () => {
                    buildBtn.disabled = true;
                    buildBtn.innerHTML = '<i class="fas fa-cog fa-spin"></i> Building...';
                    chatStage = 'building';

                    try {
                        await handleGeneratePlan(originalIdea);

                        buildBtn.innerHTML = '<i class="fas fa-check-circle"></i> Build Complete';
                        buildBtn.style.background = '#10b981';
                        buildBtn.style.color = '#000';

                        // Hide button after a moment
                        setTimeout(() => { resultSection.style.display = 'none'; }, 2000);

                    } catch (err) {
                        buildBtn.disabled = false;
                        buildBtn.innerHTML = `<i class="fas fa-redo"></i> Reintentar`;
                        addLog(`Build Error: ${err.message}`, 'error');
                    }
                };
            }

            // Placeholder on right
            const previewDoc = livePreviewFrame.contentDocument || livePreviewFrame.contentWindow.document;
            previewDoc.body.innerHTML = `
                <div style="display:flex; height:100vh; align-items:center; justify-content:center; color:#555; background:#000; font-family:sans-serif; flex-direction:column; gap:10px;">
                    <div style="font-size:3rem; opacity:0.5;">🏗️</div>
                    <div style="color:#fff;">Waiting for Blueprint Execution...</div>
                </div>
            `;

        } catch (e) {
            stopThinking();
            addLog("Blueprint logic error, proceeding to build...", "warning");
            chatStage = 'building';
            await handleGeneratePlan(originalIdea);
        }
    }

    // --- UI Helpers ---
    let loadDiv = null;

    function showThinking(text) {
        if (!terminalContent) return;
        if (loadDiv) loadDiv.remove();
        loadDiv = document.createElement('div');
        loadDiv.className = 'msg-row ai';
        loadDiv.innerHTML = `<div class="ai-msg" style="opacity:0.7;"><i class="fas fa-circle-notch fa-spin"></i> ${text}</div>`;
        terminalContent.insertBefore(loadDiv, resultSection || null);
        terminalContent.scrollTop = terminalContent.scrollHeight;
    }
    window.showThinking = showThinking; // Expose globally

    function stopThinking() {
        if (loadDiv) {
            loadDiv.remove();
            loadDiv = null;
        }
        // Force reset button state always
        if (typeof setLoading === 'function') setLoading(false);
    }
    window.stopThinking = stopThinking; // Expose globally

    let conversationHistory = [];
    // Per-channel history cache to avoid re-fetching when switching tabs
    const channelHistoryCache = { build: null, marketing: null, organic: null, capital: null };

    function buildMemorySnapshot() {
        // Extract a lightweight summary from user messages for continuity.
        const userMsgs = conversationHistory.filter(m => m.role === 'user').map(m => m.content || '');
        const joined = userMsgs.join('\n').toLowerCase();
        const summary = userMsgs.find(msg => msg && msg.length > 20) || userMsgs[userMsgs.length - 1] || '';
        const audience = userMsgs.find(msg => /users?|customers?|audience|target|persona|usuarios?|clientes?|audiencia/i.test(msg)) || '';
        const business_model = userMsgs.find(msg => /subscri|commission|freemium|payment|fee|fit|per video|per event|monetiz|suscrip|comisi|pago|por video|por evento|monet/i.test(msg)) || '';
        const timeline = userMsgs.find(msg => /week|month|deadline|date|today|24h|48h|semana|mes|fecha|hoy/i.test(msg)) || '';

        const snapshot = {
            version: 1,
            chat_stage: chatStage,
            active_channel: activeChannel,
            engine_preference: selectedEngine,
            current_project_name: currentProjectName,
            current_ticket_project_id: currentTicketProjectId,
            summary: summary,
            audience: audience,
            business_model: business_model,
            timeline: timeline,
            domain_hint: joined.includes('pet shop') || joined.includes('mascota') ? 'pet_shop' : 'general',
            conversation_history: conversationHistory.slice(-40)
        };
        if (isMarketingChannel()) {
            snapshot.marketing_brief = currentMarketingBrief || {};
            snapshot.marketing_preview_assets = Array.isArray(currentMarketingAssets) ? currentMarketingAssets.slice(0, 8) : [];
        }
        return snapshot;
    }

    async function saveMemoryNow() {
        if (!currentUser?.email || !currentProjectName) return;
        try {
            await fetch('/api/chat-memory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    email: currentUser.email,
                    project_name: getActiveProjectKey(),
                    memory: buildMemorySnapshot()
                })
            });
        } catch (e) {
            console.warn('Memory save failed', e);
        }
    }

    function queueMemorySave() {
        if (pendingMemorySave) clearTimeout(pendingMemorySave);
        pendingMemorySave = setTimeout(() => { saveMemoryNow(); }, 350);
    }

    async function loadChatMemory() {
        if (!currentUser?.email) return;
        if (!currentProjectName) {
            conversationHistory = [];
            chatStage = 'initial';
            resetChatView();
            latestMissingFields = getRequiredFields().slice();
            latestBriefScore = 0;
            renderBriefState();
            return;
        }
        try {
            const res = await fetch(`/api/chat-memory?email=${encodeURIComponent(currentUser.email)}&project_name=${encodeURIComponent(getActiveProjectKey())}`, { credentials: 'include' });
            if (!res.ok) return;
            const data = await res.json();
            const memory = data.memory || {};
            clearChatMessages();
            conversationHistory = [];
            if (Array.isArray(memory.conversation_history) && memory.conversation_history.length) {
                conversationHistory = memory.conversation_history.slice(-40);
            }
            chatStage = memory.chat_stage || (conversationHistory.length ? 'conversing' : 'initial');
            setSelectedEngine(memory.engine_preference || selectedEngine);
            setTimelineVisible(chatStage === 'construction_mode' || chatStage === 'building');
            if (memory.current_ticket_project_id) currentTicketProjectId = memory.current_ticket_project_id;
            const rendered = renderConversationHistory(conversationHistory);
            if (!rendered) {
                const intro = document.createElement('div');
                intro.className = 'msg-row ai';
                const defaultMessages = {
                    build: 'No previous build conversation. Describe your idea and let\'s start.',
                    marketing: 'No previous marketing conversation. Describe your goal and let\'s start.',
                    organic: 'No previous organic content conversation. Tell me about your brand and let\'s start.',
                    capital: 'No previous investment conversation. Describe your business and capital needs.'
                };
                const defaultMsg = defaultMessages[activeChannel] || 'Describe tu idea y empezamos.';
                const summaryMsg = memory.summary ? `Retomando contexto: ${escapeHtml(memory.summary)}` : defaultMsg;
                intro.innerHTML = `
                    <div class="ai-msg">
                        > Project loaded: ${escapeHtml(currentProjectName)}<br><br>
                        ${summaryMsg}
                    </div>
                `;
                if (terminalContent) terminalContent.insertBefore(intro, resultSection || null);
            }
            if (isMarketingChannel()) {
                const brief = memory.marketing_brief || {};
                currentMarketingBrief = brief;
                currentMarketingAssets = Array.isArray(memory.marketing_preview_assets) ? memory.marketing_preview_assets : [];
                renderMarketingPreview(currentMarketingAssets);
                const inferredMissing = getRequiredFields().filter(field => {
                    if (field === 'channels') return !Array.isArray(brief.channels) || brief.channels.length === 0;
                    return !brief[field];
                });
                renderBriefState({
                    missing_fields: inferredMissing,
                    memory_summary: brief.key_message || brief.offer || memory.summary || ''
                });
            } else {
                const inferredMissing = [];
                if (!memory.summary) inferredMissing.push('summary');
                if (!memory.audience) inferredMissing.push('audience');
                if (!memory.business_model) inferredMissing.push('business_model');
                if (!memory.timeline) inferredMissing.push('timeline');
                if (!Array.isArray(memory.features) || memory.features.length < 2) inferredMissing.push('features');
                latestMissingFields = inferredMissing;
                renderBriefState({
                    missing_fields: inferredMissing,
                    memory_summary: memory.summary || ''
                });
            }
            if (currentTicketProjectId) {
                startPolling();
            }
            persistCurrentProject();
            syncChatLockWithPendingTicket();
            if (isMarketingChannel()) {
                await bootstrapMarketingPhase();
            }
        } catch (e) {
            console.warn('Memory load failed', e);
        }
    }

    function updatePhase(text) {
        const el = document.getElementById('phase-indicator');
        if (el) el.innerText = text;
    }
    window.updatePhase = updatePhase; // Expose globally

    function isResetIntent(text) {
        const t = (text || '').toLowerCase().trim();
        const phrases = [
            'empecemos de cero', 'empezar de cero', 'desde cero',
            'reset', 'reinicia', 'reiniciar', 'borrar contexto',
            'olvida todo', 'nuevo proyecto', 'start over', 'from scratch', 'clear context',
            'forget everything', 'new project', 'restart', 'clean slate'
        ];
        return phrases.some(p => t.includes(p));
    }

    function resetChatView() {
        if (!terminalContent) return;
        const messages = terminalContent.querySelectorAll('.msg-row');
        messages.forEach((node) => {
            if (!resultSection.contains(node)) node.remove();
        });
        const intro = document.createElement('div');
        intro.className = 'msg-row ai';
        intro.innerHTML = `
            <div class="ai-msg">
                > Context reset successfully.<br><br>
                ${isMarketingChannel()
                    ? 'Starting fresh. Define your marketing goal and we\'ll structure it together.'
                    : 'Starting fresh. Describe your new idea and we\'ll structure it together.'}
            </div>
        `;
        if (terminalContent) terminalContent.insertBefore(intro, resultSection || null);
    }

    async function resetContext(clearProject = false) {
        if (pendingMemorySave) {
            clearTimeout(pendingMemorySave);
            pendingMemorySave = null;
        }
        conversationHistory = [];
        chatStage = 'initial';
        setInteractionMode('strategy');
        setTimelineVisible(false);
        originalIdea = '';
        if (clearProject) currentProjectName = '';
        persistCurrentProject();
        currentTicketProjectId = '';
        currentPlanContent = '';
        lastStatus = '';
        lastDeployedUrl = '';
        previewLockedByReview = false;
        currentMarketingBrief = null;
        currentMarketingAssets = [];
        latestMissingFields = getRequiredFields().slice();
        latestBriefScore = 0;
        if (pollInterval) clearInterval(pollInterval);
        resetChatView();
        renderBriefState({ missing_fields: latestMissingFields, memory_summary: '' });
        await saveMemoryNow();
    }

    if (resetContextBtn) {
        resetContextBtn.addEventListener('click', async () => {
            setLoading(true);
            try {
                await fetch('/api/chat-memory/reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        user_email: currentUser.email,
                        email: currentUser.email,
                        project_name: getActiveProjectKey()
                    })
                });
                await resetContext();
            } catch (e) {
                addLog("Could not reset the context.", "error");
            } finally {
                setLoading(false);
            }
        });
    }

    // --- Logic: Analyze Idea (Synthesis Flow) ---
    async function handleIdeaAnalysis(userInput, imageDataUrl = '') {
        if (isResetIntent(userInput)) {
            try {
                await fetch('/api/chat-memory/reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        user_email: currentUser.email,
                        email: currentUser.email,
                        project_name: getActiveProjectKey()
                    })
                });
            } catch (_) { }
            await resetContext();
            return;
        }
        conversationHistory.push({ role: "user", content: userInput });
        queueMemorySave();

        if (chatStage === 'initial') {
            originalIdea = userInput;
            showThinking("Consulting Supra Core...");

            try {
                const res = await fetch('/analyze-idea', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ idea: userInput, image_data_url: imageDataUrl, engine: selectedEngine, user_email: currentUser.email, project_name: currentProjectName })
                });
                const data = await res.json();
                if (!res.ok) {
                    if (res.status === 402 && (data.code === 'subscription_required_after_preview' || data.requires_subscription)) {
                        openSubscriptionModal(data.error || 'You must subscribe to continue after the preview.');
                        return;
                    }
                    if (res.status === 402) {
                        addLog(`⛔ ${data.error || 'Insufficient credits.'}`, 'error');
                        checkUserCredits();
                        return;
                    }
                    throw new Error(data.error || `Status ${res.status}`);
                }

                stopThinking();
                addSystemMessage(data.message);
                renderBriefState({
                    brief_score: data.brief_score,
                    missing_fields: data.missing_fields || [],
                    memory_summary: data.memory_summary || ''
                });

                conversationHistory.push({ role: "ai", content: data.message });
                queueMemorySave();
                // Update token display from response
                if (typeof data.remaining_tokens === 'number') {
                    updateTokenDisplay(data.remaining_tokens);
                }
                // NEW: Go to conversation mode first
                chatStage = 'conversing';
                updatePhase("STEP 1.5: STRATEGIC DEFINITION");
                queueMemorySave();

            } catch (e) {
                stopThinking();
                addLog("Error: " + e.message, "error");
            }
        }
        else if (chatStage === 'conversing') {
            // Normal Conversation (Robust)
            showThinking("Writing...");

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 35000);

            try {
                const res = await fetch('/api/continue-chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        history: conversationHistory,
                        message: userInput,
                        image_data_url: imageDataUrl,
                        engine: selectedEngine,
                        user_email: currentUser.email,
                        project_name: currentProjectName
                    }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                const data = await res.json();
                if (!res.ok) {
                    if (res.status === 402 && (data.code === 'subscription_required_after_preview' || data.requires_subscription)) {
                        openSubscriptionModal(data.error || 'You must subscribe to continue after the preview.');
                        return;
                    }
                    if (res.status === 402) {
                        addLog(`${data.error || 'Insufficient credits.'}`, 'error');
                        if (typeof data.remaining_tokens === 'number') updateTokenDisplay(data.remaining_tokens);
                        checkUserCredits();
                        // Show pricing modal automatically
                        const modal = document.getElementById('pricing-modal');
                        if (modal) modal.style.display = 'block';
                        return;
                    }
                    throw new Error(data.error || `Status ${res.status}`);
                }
                stopThinking();

                const reply = data.ai_reply || "There was an error processing your response.";
                addSystemMessage(reply);
                renderBriefState({
                    brief_score: data.brief_score,
                    missing_fields: data.missing_fields || [],
                    memory_summary: data.memory_summary || ''
                });
                conversationHistory.push({ role: "ai", content: reply });
                queueMemorySave();

                // Update token display from response
                if (typeof data.remaining_tokens === 'number') {
                    updateTokenDisplay(data.remaining_tokens);
                }

                // AI SIGNALS READINESS
                if (data.ready_to_build) {
                    addLog("AI detected readiness. Starting build...", "system");
                    chatStage = 'analyzing';
                    queueMemorySave();
                    await executeSynthesis();
                }

            } catch (e) {
                stopThinking();
                clearTimeout(timeoutId);
                console.error("Chat Error", e);
                const msg = e.name === 'AbortError' ? "The server took too long." : "Connection error (" + e.message + ").";
                addLog(msg, "error");
                addSystemMessage(`<span style="color:#ef4444; font-size:0.9rem;">⚠️ ${msg} Please try sending your message again.</span>`);
            }
        }
        else if (chatStage === 'analyzing') {
            await executeSynthesis();
        }
    }

    // Helper to run synthesis (reused by both stages)
    // Helper to run synthesis (reused by both stages)
    async function executeSynthesis() {
        // AI detected readiness. Show Confirmation Button.
        addSystemMessage(`
            <div style="background:rgba(59, 130, 246, 0.1); border:1px solid #3b82f6; padding:20px; border-radius:12px; margin-top:15px; text-align:center;">
                <h3 style="color:#fff; margin-top:0;">🚀 Proposal Ready for Engineering</h3>
                <p style="color:#ccc; font-size:0.9rem;">I've structured the technical plan. Should we send this to the development team?</p>
                <button id="sendTicketBtn" style="background:#3b82f6; color:#fff; border:none; padding:12px 24px; border-radius:6px; font-weight:bold; cursor:pointer; margin-top:10px; width:100%; transition:0.3s;">
                    <i class="fas fa-paper-plane"></i> Confirm and Send to Engineering
                </button>
            </div>
        `);

        // Bind click event after render
        setTimeout(() => {
            const btn = document.getElementById('sendTicketBtn');
            if (btn) btn.onclick = submitTicket;
        }, 500);
    }

    async function submitTicket() {
        const btn = document.getElementById('sendTicketBtn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...'; }

        showThinking("Transmitiendo a Central Anmar...");

        try {
            if (!ensureCheckoutIdentity()) {
                if (btn) { btn.disabled = false; btn.innerHTML = 'Confirm and Send to Engineering'; }
                return;
            }
            const res = await fetch('/api/create-ticket', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ history: conversationHistory, user_email: currentUser.email, project_name: currentProjectName })
            });
            const data = await res.json();

            stopThinking();

            if (data.requires_subscription) {
                const modal = document.getElementById('pricing-modal');
                if (modal) modal.style.display = 'flex';
                localStorage.setItem('pending_ticket_project', currentProjectName || '');
                setChatLocked(true, "🔒 Your project is ready. Choose a plan to send it to our team.");
                if (btn) { btn.disabled = false; btn.innerHTML = 'Confirm and Send to Engineering'; }
                stopThinking();
                return;
            }
            if (data.error) throw new Error(data.error);

            // Update Chat UI
            chatStage = 'construction_mode';
            setInteractionMode('edit');
            setTimelineVisible(true);
            updatePhase("STEP 3: BUILD (IN PROGRESS)");
            currentTicketProjectId = data.project_id || '';
            lastStatus = '';
            lastDeployedUrl = '';
            renderBriefState({ brief_score: 100, missing_fields: [], memory_summary: (briefSummaryText?.textContent || '') });
            queueMemorySave();

            addSystemMessage(`
                <div style="background:rgba(16, 185, 129, 0.1); border:1px solid #10b981; padding:15px; border-radius:8px;">
                    <h3 style="color:#10b981; margin:0;">✅ Ticket #${data.project_id} Created</h3>
                    <p style="color:#ddd; font-size:0.9rem;">The team has received your request.</p>
                    <div class="progress-container" style="background:#333; height:6px; border-radius:3px; margin-top:10px;">
                        <div id="projectProgressBar" style="width:10%; height:100%; background:#10b981; border-radius:3px; transition:width 0.5s;"></div>
                    </div>
                    <div id="projectStatusText" style="color:#aaa; font-size:0.8rem; margin-top:5px;">Estado: Recibido</div>
                </div>
            `);

            showReviewOverlay('Request received', 'Our team is reviewing your project to start execution.', 18);

            // Start Polling
            startPolling();

        } catch (e) {
            stopThinking();
            addLog("Error: " + e.message, "error");
            if (btn) { btn.disabled = false; btn.innerHTML = 'Reintentar'; }
        }
    }

    let pollInterval;
    let lastStatus = '';
    let lastDeployedUrl = '';

    function startPolling() {
        if (pollInterval) clearInterval(pollInterval);
        pollInterval = setInterval(async () => {
            try {
                const statusUrl = currentTicketProjectId
                    ? `/api/project-status?project_id=${encodeURIComponent(currentTicketProjectId)}`
                    : '/api/project-status';
                const res = await fetch(statusUrl, { credentials: 'include' });
                const status = await res.json();
                const deployedUrl = status.deployed_url || '';

                // Update Progress Bar
                const bar = document.getElementById('projectProgressBar');
                const text = document.getElementById('projectStatusText');

                if (bar && text) {
                    bar.style.width = status.progress + '%';
                    text.innerText = 'Estado: ' + (status.message || status.status);
                }

                // Chat Notification on Change
                if (status.status !== lastStatus) {
                    // Only notify if it's a new status
                    if (status.status !== 'received') {
                        addLog(`📢 Update: ${status.message}`, 'info');
                    }

                    // SPECIAL HANDLING: COMPLETED
                    if (status.status === 'completed' && lastStatus !== 'completed') {
                        clearReviewOverlayTimer();
                        // 1. Unlock Preview
                        const iframe = document.getElementById('livePreviewFrame');
                        const emptyState = document.getElementById('emptyState');

                        if (iframe && deployedUrl) {
                            if (emptyState) emptyState.style.display = 'none';
                            iframe.src = deployedUrl;
                            iframe.style.background = '#fff';
                        }

                        // 2. Final Message
                        addSystemMessage(`
                            <div style="background:rgba(16, 185, 129, 0.15); border:1px solid #10b981; padding:20px; border-radius:12px; margin-top:20px; text-align:center;">
                                <h2 style="color:#10b981; margin:0 0 10px 0;">🎉 ¡Felicidades!</h2>
                                <p style="color:#eee; font-size:1rem; line-height:1.5;">
                                    Your vision has been materialized by the Anmar team.<br>
                                    <strong>Check the preview now in the right panel.</strong>
                                </p>
                                <button onclick="window.open('${deployedUrl}', '_blank')" style="background:#10b981; color:#000; border:none; padding:10px 20px; border-radius:6px; font-weight:bold; cursor:pointer; margin-top:15px; transition:0.2s;">
                                    <i class="fas fa-external-link-alt"></i> Open in New Tab
                                </button>
                            </div>
                         `);

                        // Stop polling after completion? Or keep for updates? 
                        // Usually safe to keep or slow down.
                    }

                    lastStatus = status.status;
                }

                if (status.status === 'accepted') {
                    if (!deployedUrl) ensureBlankPreview();
                    showReviewOverlay('Order accepted', 'A specialist took your project and prepared the work environment.', 25);
                } else if (status.status === 'pending') {
                    if (!deployedUrl) ensureBlankPreview();
                    showReviewOverlay('In internal queue', 'Your request is under initial review by our team.', status.progress || 15);
                } else if (status.status === 'developing') {
                    if (!deployedUrl) ensureBlankPreview();
                    showReviewOverlay('Build in progress', 'Our team is implementing changes in real time.', status.progress || 60);
                } else if (status.status === 'blocked') {
                    if (!deployedUrl) ensureBlankPreview();
                    showReviewOverlay('Temporarily blocked', 'There is a pending dependency. Your team is already working to resolve it.', status.progress || 45);
                }

                // If internal team sets preview during developing, show it immediately.
                if (deployedUrl && deployedUrl !== lastDeployedUrl) {
                    const iframe = document.getElementById('livePreviewFrame');
                    const emptyState = document.getElementById('emptyState');
                    if (iframe) {
                        previewLockedByReview = false;
                        clearReviewOverlayTimer();
                        if (emptyState) emptyState.style.display = 'none';
                        iframe.src = deployedUrl;
                        iframe.style.background = '#fff';
                    }
                    addLog(`Preview actualizada desde panel interno (${status.status || 'developing'}).`, 'success');
                    lastDeployedUrl = deployedUrl;
                }

            } catch (e) { console.error("Polling error", e); }
        }, 3000);
    }
    // ConfirmBuild removed (legacy)
    // Support Enter key (Shift+Enter = newline)
    if (chatInput) chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            if (sendBtn) sendBtn.click();
        }
    });

    if (chatInput) {
        chatInput.addEventListener('input', () => {
            resizeChatInput();
            updateSendState();
        });
        chatInput.addEventListener('focus', () => {
            if (inputGlass) inputGlass.classList.add('focused');
        });
        chatInput.addEventListener('blur', () => {
            if (inputGlass && !chatInput.value.trim()) inputGlass.classList.remove('focused');
        });
    }

    // --- Logic: Generate Plan & Build ---
    async function handleGeneratePlan(idea) {
        addLog(`Initializing build sequence...`, 'info');

        const response = await fetch('/generate-plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ idea: idea })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error);

        currentPlanContent = data.plan;

        // Sanitize project name
        currentProjectName = data.project_name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
        currentTicketProjectId = data.project_id || '';

        // Reset and trigger human chat polling 
        lastHumanChatCount = 0;
        if (humanChatInterval) clearInterval(humanChatInterval);
        humanChatInterval = setInterval(pollHumanChat, 3000);
        queueMemorySave();

        addLog(`Plan generado: ${currentProjectName}`, 'success');

        // Trigger Actual Build
        await performBuild();
    }

    async function performBuild() {
        showReviewOverlay('Initial build', 'Our team is creating your first preview.', 35);
        showThinking("Writing backend code (Flask)...");
        const theme = 'Modern Startup';

        // Simulate steps
        await new Promise(r => setTimeout(r, 1000));
        showThinking("Designing interface (Tailwind)...");

        const response = await fetch('/create-project', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                project_name: currentProjectName,
                plan: currentPlanContent,
                theme: theme,
                user_email: currentUser.email // Send Email for Token Deduction
            })
        });

        const data = await response.json();
        stopThinking();

        // PAYWALL HANDLER
        if (response.status === 402) {
            addLog(`⛔ ${data.error}`, 'error');
            addLog(data.message, 'system');

            // Visual Shake on Tokens
            if (userTokensEl) {
                userTokensEl.style.transform = 'scale(1.2)';
                setTimeout(() => userTokensEl.style.transform = 'scale(1)', 300);
            }
            throw new Error("Payment required to continue.");
        }

        if (data.error) throw new Error(data.error);

        // Success - Refresh Tokens
        checkUserCredits();

        addLog(`Despliegue Exitoso. Accediendo a instancia viva...`, 'success');
        logBuildReport(data);
        currentTicketProjectId = currentTicketProjectId || currentProjectName;
        lastDeployedUrl = '';
        ensureBlankPreview();
        showReviewOverlay('Under internal review', 'Your request was sent. You\'ll see the preview here when the internal team publishes it.', 18);
        startPolling();
    }

    // --- Logic: Edit Project ---
    // --- Logic: Edit Project & Hybrid Ticket ---
    async function handleEditProject(instruction, imageDataUrl = '') {
        showReviewOverlay('Request under review', 'Our team is evaluating the requested changes.', 42);
        showThinking(`IA intentando aplicar: "${instruction}"...`);

        try {
            const response = await fetch('/edit-project', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    project_name: currentProjectName,
                    instruction: instruction,
                    user_email: currentUser?.email || '',
                    history: conversationHistory.slice(-30),
                    image_data_url: imageDataUrl,
                    engine: selectedEngine
                })
            });
            const data = await response.json();

            if (!response.ok) {
                if (response.status === 402 && (data.code === 'subscription_required_after_preview' || data.requires_subscription)) {
                    openSubscriptionModal(data.error || 'You must subscribe to continue after the preview.');
                    return;
                }
                if (response.status === 402) {
                    addLog(`⛔ ${data.error || 'Insufficient credits to edit.'}`, 'error');
                    checkUserCredits();
                    return;
                }
                throw new Error(data.error || `Status ${response.status}`);
            }
            if (data.error) throw new Error(data.error);

            if (data.summary) {
                await addSystemMessage(`### Cambio aplicado\n${data.summary}`);
            }
            if (data.engine_used) {
                const label = data.engine_used === 'openai_codex' ? 'Codex' : 'Antigravity';
                addLog(`Engine used in edit: ${label}`, 'info');
            }
            loadProjectPreview(currentProjectName);
            addLog(`Cambio aplicado por IA en: ${(data.changed_files || []).join(', ') || 'archivo principal'}.`, 'success');
            logBuildReport(data);
            if (typeof data.remaining_tokens === 'number') {
                checkUserCredits();
            }
            conversationHistory.push({ role: "user", content: instruction });
            conversationHistory.push({ role: "ai", content: data.summary || "Change applied to the project." });
            queueMemorySave();

        } catch (e) {
            addLog(`La IA tuvo problemas: ${e.message}`, 'warning');
            await addSystemMessage("I couldn't safely apply that change. Reformulate it with more detail (file, section, and expected result).");
        }

        stopThinking();

        const wantsHumanSupport = /(human support|human team|maria|ticket|escalate|human review|human support)/i.test(instruction || "");
        if (wantsHumanSupport) {
            showReviewOverlay('Escalated to internal team', 'Your request has been sent to specialized human review.', 55);
            addLog("Requesting premium human support...", "system");
            submitTicketInBackground(instruction);
        }
    }

    async function submitTicketInBackground(request) {
        try {
            const res = await fetch('/api/submit-ticket', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    user_email: currentUser.email,
                    project_name: currentProjectName,
                    request: request
                })
            });
            const data = await res.json();
            if (!res.ok) {
                if (res.status === 402) {
                    addLog(`⛔ ${data.error || 'Insufficient credits for human support.'}`, 'warning');
                    checkUserCredits();
                    return;
                }
                throw new Error(data.error || `Status ${res.status}`);
            }
            if (data.ticket_id) {
                addLog(`Ticket #${data.ticket_id} escalated to expert team (${data.assigned_to}) for quality review.`, 'system');
            }
        } catch (e) {
            console.error("Ticket fallback error", e);
            addLog(`Could not escalate to human support: ${e.message}`, 'warning');
        }
    }


    // --- Visuals ---
    function setPreviewOverlay(message, icon = 'fa-cube') {
        if (!emptyState) return;
        previewLockedByReview = false;
        emptyState.style.display = 'flex';
        emptyState.innerHTML = `
            <i class="fas ${icon}" style="font-size:2.2rem; opacity:0.45; margin-bottom:0.8rem;"></i>
            <p style="opacity:0.9; font-family:'Inter'; margin:0 16px; text-align:center;">${message}</p>
        `;
    }

    function clearReviewOverlayTimer() {
        if (reviewOverlayTimer) {
            clearInterval(reviewOverlayTimer);
            reviewOverlayTimer = null;
        }
    }

    function showReviewOverlay(stateLabel = 'Under review', detail = 'Our team is working on your project.', progress = 35) {
        if (!emptyState) return;
        previewLockedByReview = true;
        clearReviewOverlayTimer();
        const safeProgress = Math.max(10, Math.min(95, Number(progress) || 35));
        let dots = 0;
        emptyState.style.display = 'flex';
        emptyState.innerHTML = `
            <div style="width:min(92%,420px); background:rgba(4,9,17,0.92); border:1px solid rgba(59,130,246,0.45); border-radius:14px; padding:16px; box-shadow:0 14px 36px rgba(0,0,0,0.45);">
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
                    <i class="fas fa-user-gear" style="font-size:1rem; color:#93c5fd;"></i>
                    <strong style="color:#dbeafe; font-size:0.92rem;">${stateLabel}</strong>
                </div>
                <p id="reviewOverlayText" style="margin:0 0 10px 0; color:#cbd5e1; font-size:0.84rem; line-height:1.45;">${detail}</p>
                <div style="height:7px; border-radius:999px; background:rgba(255,255,255,0.12); overflow:hidden;">
                    <div style="height:100%; width:${safeProgress}%; background:linear-gradient(90deg,#3b82f6,#10b981); transition:width 0.4s;"></div>
                </div>
                <div style="margin-top:8px; font-size:0.72rem; color:#93a4bd;">Estado operativo en vivo</div>
            </div>
        `;
        reviewOverlayTimer = setInterval(() => {
            const textEl = document.getElementById('reviewOverlayText');
            if (!textEl) return;
            dots = (dots + 1) % 4;
            textEl.textContent = `${detail}${'.'.repeat(dots)}`;
        }, 650);
    }

    function ensureBlankPreview() {
        if (!livePreviewFrame) return;
        const src = String(livePreviewFrame.src || '');
        if (!src.startsWith('about:blank')) {
            livePreviewFrame.src = 'about:blank';
        }
    }

    if (livePreviewFrame) {
        livePreviewFrame.addEventListener('load', () => {
            if (previewLockedByReview) return;
            clearReviewOverlayTimer();
            if (previewLoadTimer) {
                clearTimeout(previewLoadTimer);
                previewLoadTimer = null;
            }
            if (emptyState) emptyState.style.display = 'none';
        });
        livePreviewFrame.addEventListener('error', () => {
            setPreviewOverlay('Could not load preview. Verify that the project exists and try again.', 'fa-triangle-exclamation');
        });
    }

    function loadProjectPreview(name) {
        if (!name) {
            setPreviewOverlay('Select a project to view its preview.', 'fa-folder-open');
            return;
        }
        if (currentTicketProjectId && !lastDeployedUrl && (chatStage === 'construction_mode' || chatStage === 'building')) {
            ensureBlankPreview();
            showReviewOverlay('Under internal review', 'Our team is working on your project and will soon send the preview.', 20);
            return;
        }
        setPreviewOverlay(`Loading preview for ${name}...`, 'fa-spinner');
        const url = `/projects/${name}/index.html?v=${Date.now()}`; // cache-bust
        previewLockedByReview = false;
        livePreviewFrame.src = url;

        // Update URL bar visual
        const urlBar = document.querySelector('.url-bar');
        if (urlBar) urlBar.textContent = `anmar.app/projects/${name}`;

        livePreviewFrame.style.display = 'block';
        if (previewLoadTimer) clearTimeout(previewLoadTimer);
        previewLoadTimer = setTimeout(() => {
            setPreviewOverlay(`No preview response for "${name}". Check that the backend is active on :5001.`, 'fa-plug-circle-xmark');
        }, 7000);
    }

    function logBuildReport(data) {
        if (!data) return;
        const report = Array.isArray(data.build_report) ? data.build_report : [];
        const checks = Array.isArray(data.smoke_checks) ? data.smoke_checks : [];
        if (report.length) {
            addLog("Build report por archivo:", "system");
            report.forEach((item) => {
                addLog(
                    `${item.file}: ${item.status} (+${item.additions || 0} / -${item.deletions || 0})`,
                    "info"
                );
            });
        }
        if (checks.length) {
            const failed = checks.filter(c => !c.ok);
            if (failed.length === 0) {
                addLog("Smoke checks: todos OK.", "success");
            } else {
                addLog(`Smoke checks fallidos: ${failed.map(f => f.name).join(', ')}`, "warning");
            }
        }
    }

    // --- VIEW TOGGLES ---
    const mobileBtn = document.getElementById('mobileViewBtn');
    const desktopBtn = document.getElementById('desktopViewBtn');

    if (uploadImageBtn && imageUploadInput) {
        uploadImageBtn.addEventListener('click', () => imageUploadInput.click());
        imageUploadInput.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            if (!file.type || !file.type.startsWith('image/')) {
                addLog('Only images are allowed.', 'warning');
                clearPendingAttachment();
                return;
            }
            try {
                const toDataUrl = (f) => new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result || ''));
                    reader.onerror = reject;
                    reader.readAsDataURL(f);
                });
                pendingImageDataUrl = await toDataUrl(file);
                pendingImageName = file.name || 'imagen';
                updateAttachmentStatus();
                updateSendState();
            } catch (err) {
                addLog(`Could not load the image: ${err.message}`, 'error');
                clearPendingAttachment();
                updateSendState();
            }
        });
    }

    if (voiceInputBtn) {
        initVoiceInput();
        voiceInputBtn.addEventListener('click', () => {
            if (!speechRecognition) return;
            if (isVoiceRecording) {
                speechRecognition.stop();
                return;
            }
            try {
                speechRecognition.start();
            } catch (_) {
                // Ignore repeated start errors
            }
        });
    }

    if (mobileBtn && desktopBtn) {
        mobileBtn.addEventListener('click', () => {
            livePreviewFrame.style.width = '390px';
            livePreviewFrame.style.height = '844px';
            livePreviewFrame.style.aspectRatio = 'auto';
            livePreviewFrame.style.maxWidth = '100%';
            livePreviewFrame.style.maxHeight = '100%';
            livePreviewFrame.style.borderRadius = '20px'; // make it look like a phone
            livePreviewFrame.style.border = '4px solid #333';
        });
        desktopBtn.addEventListener('click', () => {
            livePreviewFrame.style.width = '100%';
            livePreviewFrame.style.height = '100%';
            livePreviewFrame.style.aspectRatio = 'auto';
            livePreviewFrame.style.maxWidth = 'none';
            livePreviewFrame.style.maxHeight = 'none';
            livePreviewFrame.style.borderRadius = '0';
            livePreviewFrame.style.border = 'none';
        });
    }

    function setLoading(bool) {
        isProcessing = bool;
        if (sendBtn) sendBtn.disabled = bool;
        if (chatInput) chatInput.disabled = bool;
        if (chatTypingIndicator) {
            chatTypingIndicator.classList.toggle('active', bool);
        }
        if (bool) {
            if (sendBtn) sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        } else {
            if (sendBtn) sendBtn.innerHTML = '<i class="fas fa-arrow-up"></i>';
            if (chatInput) chatInput.focus();
        }
        updateSendState();
    }

    // --- Project Management ---
    function toDisplayName(slug) {
        return (slug || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    window.toggleProjectList = async function () {
        const el = document.getElementById('projectsModal');
        el.style.display = el.style.display === 'none' ? 'block' : 'none';
        if (el.style.display === 'block') loadProjects();
    }

    window.createNewProject = async function () {
        const projectName = prompt("New project name:");
        if (!projectName || !projectName.trim()) return;
        await createProjectByName(projectName.trim());
    }

    async function createProjectByName(name, options = {}) {
        const showAlert = options.showAlert !== false;
        const onError = typeof options.onError === 'function' ? options.onError : null;
        const phone = (options.phone || '').trim();
        const description = (options.description || '').trim();
        const project_type = (options.project_type || '').trim();
        const business_model = (options.business_model || '').trim();
        const stage = (options.stage || '').trim();
        // skipNavigation: true → no cierra la pantalla de onboarding ni cambia de tab
        // (lo maneja el caller para no interrumpir animaciones en curso)
        const skipNavigation = !!options.skipNavigation;
        try {
            const payload = { project_name: name, user_email: currentUser?.email || '', phone };
            if (description) payload.description = description;
            if (project_type) payload.project_type = project_type;
            if (business_model) payload.business_model = business_model;
            if (stage) payload.stage = stage;
            const res = await fetch('/api/create-empty-project', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) {
                const msg = data.error || 'Could not create the project.';
                if (showAlert) addLog(msg, 'error');
                if (onError) onError(msg);
                return false;
            }
            currentProjectName = data.project_name;
            currentTicketProjectId = data.project_id || '';
            chatStage = 'initial';
            markWelcomeDone();
            if (!skipNavigation) setWelcomeVisible(false);

            // Reset state
            lastHumanChatCount = 0;
            if (humanChatInterval) clearInterval(humanChatInterval);
            humanChatInterval = setInterval(pollHumanChat, 3000);
            persistCurrentProject();
            conversationHistory = [];
            originalIdea = '';
            currentMarketingBrief = null;
            currentMarketingAssets = [];
            latestMissingFields = getRequiredFields().slice();
            latestBriefScore = 0;

            // UI updates — pueden fallar durante onboarding (elementos no visibles aún)
            try { setInteractionMode('strategy'); } catch(_) {}
            try { setTimelineVisible(false); } catch(_) {}
            try { clearChatMessages(); } catch(_) {}
            try { renderBriefState({ missing_fields: latestMissingFields, memory_summary: '' }); } catch(_) {}
            try { await loadChatMemory(); } catch(_) {}
            try { loadProjectPreview(currentProjectName); } catch(_) {}
            try { addLog(`Project created: ${currentProjectName}.`, 'system'); } catch(_) {}

            await loadProjects();
            if (!skipNavigation) switchTab('build');
            return true;
        } catch (e) {
            console.error(e);
            const msg = 'Connection error creating project.';
            if (showAlert) addLog(msg, 'error');
            if (onError) onError(msg);
            return false;
        }
    }

    window.createQuickProject = async function (name) {
        const safeName = (name || '').trim();
        if (!safeName) return;
        await createProjectByName(safeName);
    }

    window.createProjectFromInput = async function () {
        openWelcomeNewProject();
    }

    window.deleteAllProjects = async function () {
        const ok = confirm("Delete ALL projects? This action cannot be undone.");
        if (!ok) return;

        try {
            const res = await fetch('/api/delete-all-projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({})
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error deleting projects');

            currentProjectName = '';
            persistCurrentProject();
            setInteractionMode('strategy');
            currentMarketingBrief = null;
            currentMarketingAssets = [];
            latestMissingFields = getRequiredFields().slice();
            latestBriefScore = 0;
            renderBriefState({ missing_fields: latestMissingFields, memory_summary: '' });
            const iframe = document.getElementById('livePreviewFrame');
            const emptyState = document.getElementById('emptyState');
            if (iframe) iframe.src = 'about:blank';
            if (emptyState) emptyState.style.display = 'flex';
            addLog(`${data.deleted || 0} projects deleted.`, 'warning');
            await loadProjects();
        } catch (e) {
            console.error(e);
            addLog('Could not delete all projects.', 'error');
        }
    }

    const projectList = document.getElementById('projectList');

    async function loadProjects() {
        try {
            const emailQuery = currentUser?.email ? `?email=${encodeURIComponent(currentUser.email)}` : '';
            const response = await fetch(`/list-projects${emailQuery}`, { credentials: 'include' }); // FIXED PORT
            const projects = await response.json();
            let projectMeta = {};
            try {
                const metaRes = await fetch(`/api/projects-meta${emailQuery}`, { credentials: 'include' });
                projectMeta = await metaRes.json();
            } catch (e) {
                projectMeta = {};
            }

            projectList.innerHTML = '';
            if (projectsFolderGrid) projectsFolderGrid.innerHTML = '';
            const limitHint = document.getElementById('projectLimitHint');
            projectLimitReached = false;

            if (projects.length === 0) {
                // No projects — force onboarding
                forceWelcome = true;
                // Clear welcome_done so it shows on reload too
                try { localStorage.removeItem(getWelcomeDismissKey()); } catch(_){}
                setWelcomeVisible(true);
                projectList.innerHTML = '<li style="padding:0.5rem">No projects found.</li>';
                if (projectsFolderGrid) {
                    projectsFolderGrid.innerHTML = `
                        <div style="padding:20px; border:1px dashed rgba(255,255,255,0.2); border-radius:10px; color:rgba(255,255,255,0.7);">
                            No projects created yet. Complete the form above to get started.
                        </div>
                    `;
                }
                if (limitHint) limitHint.style.display = 'none';
                return;
            }
            if (projects.length > 0 && !forceWelcome) {
                markWelcomeDone();
                setWelcomeVisible(false);
            }

            if (limitHint) limitHint.style.display = 'none';

            projects.forEach(project => {
                const meta = projectMeta && projectMeta[project] ? projectMeta[project] : {};
                const phoneLabel = meta && meta.phone ? `📞 ${meta.phone}` : '';
                const li = document.createElement('li');
                li.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 0.5rem; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.1);';

                // Project Name Clickable Area
                const nameSpan = document.createElement('span');
                nameSpan.innerHTML = `<i class="fas fa-folder" style="margin-right:8px; color:#3b82f6;"></i> ${escapeHtml(toDisplayName(project))} ${phoneLabel ? `<span style="margin-left:8px; font-size:0.75rem; opacity:0.7;">${escapeHtml(phoneLabel)}</span>` : ''}`;
                nameSpan.style.flexGrow = '1';
                nameSpan.onclick = async () => {
                    currentProjectName = project;

                    // Load this project's cached Business Model (or reset to idle if none)
                    restoreBmFromCache(project);

                    // Start polling human chat mapping
                    lastHumanChatCount = 0;
                    if (humanChatInterval) clearInterval(humanChatInterval);
                    humanChatInterval = setInterval(pollHumanChat, 3000);
                    pollHumanChat();
                    persistCurrentProject();
                    setInteractionMode('strategy');
                    await loadChatMemory();
                    loadProjectPreview(project); // Ensure loadProjectPreview is accessible or define logic here
                    const previewUrl = `/projects/${project}/index.html?v=${Date.now()}`;
                    const iframe = document.getElementById('livePreviewFrame');
                    if (iframe) iframe.src = previewUrl;

                    const projectsModal = document.getElementById('projectsModal');
                    if (projectsModal) projectsModal.style.display = 'none';
                    addLog(`Project loaded: ${project}`, 'info');
                    if (typeof resultSection !== 'undefined') resultSection.style.display = 'none';
                };

                // Delete Button
                const deleteBtn = document.createElement('i');
                deleteBtn.className = 'fas fa-trash-alt';
                deleteBtn.style.cssText = 'color: #ef4444; opacity: 0.6; cursor: pointer; padding: 5px; transition: opacity 0.2s;';
                deleteBtn.onmouseover = () => deleteBtn.style.opacity = '1';
                deleteBtn.onmouseout = () => deleteBtn.style.opacity = '0.6';

                deleteBtn.onclick = async (e) => {
                    e.stopPropagation(); // Prevent opening the project
                    if (confirm(`Are you sure you want to DELETE "${project}"? This action is irreversible.`)) {
                        try {
                            const res = await fetch('/delete-project', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                credentials: 'include',
                                body: JSON.stringify({ project_name: project, user_email: currentUser?.email || '' })
                            });
                            if (res.ok) {
                                li.remove();
                                addLog(`Project deleted: ${project}`, 'warning');
                                if (currentProjectName === project) {
                                    document.getElementById('livePreviewFrame').src = 'about:blank';
                                    currentProjectName = '';
                                    persistCurrentProject();
                                }
                            } else {
                                addLog('Error deleting project.', 'error');
                            }
                        } catch (err) {
                            console.error(err);
                            addLog('Connection error when deleting.', 'error');
                        }
                    }
                };

                li.appendChild(nameSpan);
                li.appendChild(deleteBtn);
                projectList.appendChild(li);

                if (projectsFolderGrid) {
                    const card = document.createElement('div');
                    card.style.cssText = 'position:relative; text-align:left; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.09); padding:20px; border-radius:14px; color:#fff; cursor:pointer; min-height:140px; transition:all 0.25s ease; overflow:hidden; display:flex; flex-direction:column; justify-content:space-between;';
                    const descText = (meta && meta.description) ? escapeHtml(meta.description) : 'No description provided.';
                    card.innerHTML = `
                        <div>
                            <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px; min-width:0;">
                                <div style="width:32px; height:32px; border-radius:8px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.12); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                                    <i class="fas fa-folder" style="color:rgba(255,255,255,0.7); font-size:0.85rem;"></i>
                                </div>
                                <strong title="${escapeHtml(toDisplayName(project))}" style="font-size:1rem; display:block; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; letter-spacing:-0.2px;">
                                    ${escapeHtml(toDisplayName(project))}
                                </strong>
                            </div>
                            <div style="color:rgba(255,255,255,0.45); font-size:0.8rem; line-height:1.5; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">${descText}</div>
                        </div>
                        <div style="display:flex; align-items:center; justify-content:flex-end; margin-top:14px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.07);">
                            <span style="font-size:0.75rem; color:rgba(255,255,255,0.4); font-weight:600; letter-spacing:0.3px;">Open →</span>
                        </div>
                    `;
                    card.onmouseenter = () => {
                        card.style.transform = 'translateY(-2px)';
                        card.style.background = 'rgba(255,255,255,0.07)';
                        card.style.borderColor = 'rgba(255,255,255,0.2)';
                        card.style.boxShadow = '0 8px 32px rgba(0,0,0,0.3)';
                    };
                    card.onmouseleave = () => {
                        card.style.transform = 'none';
                        card.style.background = 'rgba(255,255,255,0.04)';
                        card.style.borderColor = 'rgba(255,255,255,0.09)';
                        card.style.boxShadow = 'none';
                    };
                    card.onclick = async () => {
                        currentProjectName = project;
                        persistCurrentProject();
                        setInteractionMode('strategy');
                        await loadChatMemory();
                        loadProjectPreview(project);
                        switchTab('build');
                        addLog(`Project loaded: ${project}. You can continue briefing or send build adjustments.`, 'info');
                    };

                    const deleteCardBtn = document.createElement('button');
                    deleteCardBtn.type = 'button';
                    deleteCardBtn.title = `Eliminar ${project}`;
                    deleteCardBtn.innerHTML = '<i class="fas fa-trash"></i>';
                    deleteCardBtn.style.cssText = 'position:absolute; top:8px; right:8px; width:28px; height:28px; border-radius:8px; border:1px solid rgba(239,68,68,0.45); background:rgba(239,68,68,0.18); color:#fecaca; cursor:pointer; z-index:2;';
                    deleteCardBtn.onclick = async (e) => {
                        e.stopPropagation();
                        const okDelete = confirm(`Delete the project "${project}"? This action cannot be undone.`);
                        if (!okDelete) return;
                        try {
                            const res = await fetch('/delete-project', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                credentials: 'include',
                                body: JSON.stringify({ project_name: project, user_email: currentUser?.email || '' })
                            });
                            const payload = await res.json().catch(() => ({}));
                            if (!res.ok) {
                                throw new Error(payload.error || `Status ${res.status}`);
                            }
                            if (currentProjectName === project) {
                                currentProjectName = '';
                                persistCurrentProject();
                                const iframe = document.getElementById('livePreviewFrame');
                                const emptyState = document.getElementById('emptyState');
                                if (iframe) iframe.src = 'about:blank';
                                if (emptyState) emptyState.style.display = 'flex';
                            }
                            addLog(`Project deleted: ${project}`, 'warning');
                            await loadProjects();
                        } catch (err) {
                            addLog(`Could not delete ${project}: ${err.message}`, 'error');
                        }
                    };
                    card.appendChild(deleteCardBtn);
                    projectsFolderGrid.appendChild(card);
                }
            });
        } catch (e) {
            console.error(e);
        }
    }

    window.showProjectLimitModal = function () {
        const modal = document.getElementById('project-limit-modal');
        if (modal) modal.style.display = 'flex';
    }

    window.closeProjectLimitModal = function () {
        const modal = document.getElementById('project-limit-modal');
        if (modal) modal.style.display = 'none';
    }

    // --- MARKETING MODULE ---
    // Expose gate globally so inline onclick handlers can reach it
    window.showValidateGate = showValidateGate;

    // ── BUSINESS MODEL GENERATOR ─────────────────────────────────────────────
    async function generateBusinessModelStream(projectInfo) {
        const overlay    = document.getElementById('bmNeuralOverlay');
        const canvas     = document.getElementById('bmNeuralCanvas');
        const labelEl    = document.getElementById('bmNeuralLabel');
        const idlePlh    = document.getElementById('bmIdlePlaceholder');
        const cardsArea  = document.getElementById('bmCardsArea');
        const titleEl    = document.getElementById('bmTitle');
        const subtitleEl = document.getElementById('bmSubtitle');

        // Prepare UI
        if (idlePlh)    idlePlh.style.display    = 'none';
        if (cardsArea)  cardsArea.style.display   = 'flex';
        if (titleEl)    titleEl.textContent       = `Analyzing ${projectInfo.project_name}...`;
        if (subtitleEl) subtitleEl.textContent    = 'Anmar Supra AI is building your personalized business model';

        // Show overlay FIRST, then resize canvas on next frame so dimensions are correct
        if (overlay) overlay.style.display = 'flex';

        // Wait one frame so the overlay is rendered and has real dimensions
        await new Promise(r => requestAnimationFrame(r));
        await new Promise(r => setTimeout(r, 20));

        // ── Neural network canvas animation ──────────────────────────────────
        let bmAnimId = null;
        const bmParticles = [];
        let labelInterval = null;

        if (canvas) {
            canvas.width  = window.innerWidth;
            canvas.height = window.innerHeight;
            const bmCtx = canvas.getContext('2d');
            const MAX_DIST = 200;
            const bmPulses = [];

            const N = Math.max(70, Math.floor((canvas.width * canvas.height) / 8000));
            for (let i = 0; i < N; i++) {
                bmParticles.push({
                    x:  Math.random() * canvas.width,
                    y:  Math.random() * canvas.height,
                    vx: (Math.random() - 0.5) * 0.4,
                    vy: (Math.random() - 0.5) * 0.4,
                    r:  Math.random() * 1.8 + 0.7,
                    glow: Math.random(),
                    glowDir: (Math.random() > 0.5 ? 1 : -1) * 0.01
                });
            }

            const labels = [
                'Analyzing your market...',
                'Identifying real competitors...',
                'Calculating your advantage...',
                'Evaluating key risks...',
                'Building your roadmap...'
            ];
            let labelIdx = 0;
            labelInterval = setInterval(() => {
                labelIdx = (labelIdx + 1) % labels.length;
                if (labelEl) labelEl.textContent = labels[labelIdx];
            }, 1800);

            function spawnPulse() {
                if (Math.random() > 0.06) return;
                const a = bmParticles[Math.floor(Math.random() * bmParticles.length)];
                const b = bmParticles[Math.floor(Math.random() * bmParticles.length)];
                if (a === b) return;
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                if (d < MAX_DIST) bmPulses.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, t: 0, speed: 1.6 / d });
            }

            function bmAnimate() {
                bmAnimId = requestAnimationFrame(bmAnimate);
                bmCtx.clearRect(0, 0, canvas.width, canvas.height);

                // Draw connections
                for (let a = 0; a < bmParticles.length; a++) {
                    for (let b = a + 1; b < bmParticles.length; b++) {
                        const dx = bmParticles[a].x - bmParticles[b].x;
                        const dy = bmParticles[a].y - bmParticles[b].y;
                        const d  = Math.sqrt(dx * dx + dy * dy);
                        if (d < MAX_DIST) {
                            bmCtx.strokeStyle = `rgba(16,185,129,${(1 - d / MAX_DIST) * 0.2})`;
                            bmCtx.lineWidth = 0.8;
                            bmCtx.beginPath();
                            bmCtx.moveTo(bmParticles[a].x, bmParticles[a].y);
                            bmCtx.lineTo(bmParticles[b].x, bmParticles[b].y);
                            bmCtx.stroke();
                        }
                    }
                }

                // Draw neurons
                for (const p of bmParticles) {
                    p.x += p.vx; p.y += p.vy;
                    if (p.x < 0) p.x = canvas.width;
                    if (p.x > canvas.width)  p.x = 0;
                    if (p.y < 0) p.y = canvas.height;
                    if (p.y > canvas.height) p.y = 0;
                    p.glow += p.glowDir;
                    if (p.glow > 1 || p.glow < 0) p.glowDir *= -1;

                    const alpha = 0.45 + p.glow * 0.55;
                    // glow halo
                    const grad = bmCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 5);
                    grad.addColorStop(0, `rgba(16,185,129,${alpha * 0.35})`);
                    grad.addColorStop(1, 'rgba(16,185,129,0)');
                    bmCtx.beginPath(); bmCtx.arc(p.x, p.y, p.r * 5, 0, Math.PI * 2);
                    bmCtx.fillStyle = grad; bmCtx.fill();
                    // core
                    bmCtx.beginPath(); bmCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                    bmCtx.fillStyle = `rgba(16,185,129,${alpha})`; bmCtx.fill();
                }

                // Pulses
                spawnPulse();
                for (let i = bmPulses.length - 1; i >= 0; i--) {
                    const pulse = bmPulses[i];
                    pulse.t += pulse.speed;
                    if (pulse.t > 1) { bmPulses.splice(i, 1); continue; }
                    const px = pulse.ax + (pulse.bx - pulse.ax) * pulse.t;
                    const py = pulse.ay + (pulse.by - pulse.ay) * pulse.t;
                    const pg = bmCtx.createRadialGradient(px, py, 0, px, py, 7);
                    pg.addColorStop(0, 'rgba(52,211,153,0.95)');
                    pg.addColorStop(0.4, 'rgba(16,185,129,0.4)');
                    pg.addColorStop(1, 'rgba(16,185,129,0)');
                    bmCtx.beginPath(); bmCtx.arc(px, py, 7, 0, Math.PI * 2);
                    bmCtx.fillStyle = pg; bmCtx.fill();
                }
            }
            bmAnimate();
        }

        function stopNeural() {
            if (labelInterval) clearInterval(labelInterval);
            if (bmAnimId) cancelAnimationFrame(bmAnimId);
            if (overlay) {
                overlay.style.transition = 'opacity 0.7s ease';
                overlay.style.opacity = '0';
                setTimeout(() => {
                    overlay.style.display = 'none';
                    overlay.style.opacity = '';
                    overlay.style.transition = '';
                }, 750);
            }
        }

        // ── Fetch + minimum animation time in parallel ───────────────────────
        let fetchResult = null;
        let fetchError  = null;

        try {
            // Run fetch AND a minimum 4-second wait in parallel.
            // The neural network always plays at least 4s no matter how fast the API responds.
            const [res] = await Promise.all([
                fetch('/api/generate-business-model', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify(projectInfo)
                }),
                new Promise(r => setTimeout(r, 4000))
            ]);

            const json = await res.json();

            if (!res.ok || !json.ok) {
                fetchError = json.error || `HTTP ${res.status}`;
                // Keep full json for error details (invalid_input message)
                if (json.error === 'invalid_input') {
                    fetchError = '__invalid_input__::' + (json.message || 'Please describe your idea more clearly.');
                }
            } else {
                fetchResult = json.data;
            }
        } catch (e) {
            fetchError = e.message || 'Network error';
        }

        // Stop neural network (fades out over 0.7s)
        stopNeural();
        await new Promise(r => setTimeout(r, 800));

        if (fetchError || !fetchResult) {
            // ── Invalid input — show friendly error with instructions ──────────
            if (fetchError && fetchError.startsWith('__invalid_input__::')) {
                const msg = fetchError.replace('__invalid_input__::', '');
                if (idlePlh) {
                    idlePlh.style.display = 'flex';
                    idlePlh.innerHTML = `
                        <div style="width:64px;height:64px;border-radius:50%;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);display:flex;align-items:center;justify-content:center;">
                            <i class="fas fa-exclamation-triangle" style="font-size:1.6rem;color:#f87171;"></i>
                        </div>
                        <div style="font-size:1rem;font-weight:600;color:#fff;text-align:center;max-width:380px;line-height:1.5;">
                            We couldn't generate a real analysis
                        </div>
                        <div style="font-size:0.85rem;color:rgba(255,255,255,0.45);text-align:center;max-width:400px;line-height:1.6;">${escapeHtml(msg)}</div>
                        <div style="margin-top:8px;font-size:0.8rem;color:rgba(255,255,255,0.28);text-align:center;max-width:360px;line-height:1.5;">
                            <strong style="color:rgba(255,255,255,0.5);">What we need:</strong> A real project name and a description of at least 5 words explaining what your idea does, who it's for, and what problem it solves.
                        </div>`;
                }
                if (titleEl)    titleEl.textContent    = 'Business Model';
                if (subtitleEl) subtitleEl.textContent = 'Complete the form with real information to generate your analysis.';
            } else {
                if (titleEl)    titleEl.textContent    = 'Analysis unavailable';
                if (subtitleEl) subtitleEl.textContent = `Error: ${fetchError || 'No data received'}. Please try again.`;
            }
            return;
        }

        const d = fetchResult;

        if (titleEl)    titleEl.textContent    = `${projectInfo.project_name} — Business Model`;
        if (subtitleEl) subtitleEl.textContent = 'Anmar Supra AI has finished your analysis.';

        // Cache result keyed by project name
        const _bmKey = (projectInfo.project_name || '').toLowerCase().trim();
        try { localStorage.setItem(`bm_data_${_bmKey}`, JSON.stringify(fetchResult)); } catch(_) {}

        // Render mind map with typewriter effect
        await renderBmMindMap(d, projectInfo.project_name, projectInfo.project_type || '', 10);
    }

    // Called every time the Business Model tab is activated (tab click or project switch)
    window.__onBmTab = () => {
        restoreBmFromCache(currentProjectName);
        initBmScrollHint();
    };

    // BM scroll indicator — shows when there's more content below, hides at bottom
    function initBmScrollHint() {
        const area = document.getElementById('bmScrollArea');
        const hint = document.getElementById('bmScrollHint');
        if (!area || !hint) return;
        function updateHint() {
            const scrollable = area.scrollHeight > area.clientHeight + 8;
            const atBottom = area.scrollTop + area.clientHeight >= area.scrollHeight - 24;
            hint.style.display = (scrollable && !atBottom) ? 'flex' : 'none';
        }
        area.removeEventListener('scroll', updateHint);
        area.addEventListener('scroll', updateHint);
        setTimeout(updateHint, 300);
    }

    // ── Inline BM chat send ───────────────────────────────────────────────────
    window.bmChatSend = async function () {
        const input  = document.getElementById('bmChatInput');
        const msgBox = document.getElementById('bmChatMessages');
        if (!input || !msgBox) return;
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        input.style.height = 'auto';

        // Append user bubble
        const userBubble = document.createElement('div');
        userBubble.style.cssText = 'display:flex;justify-content:flex-end;';
        userBubble.innerHTML = `<div style="background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);border-radius:10px;padding:9px 13px;font-size:0.83rem;color:#fff;line-height:1.5;max-width:85%;">${escapeHtml(text)}</div>`;
        msgBox.appendChild(userBubble);
        msgBox.scrollTop = msgBox.scrollHeight;

        // Typing indicator
        const typing = document.createElement('div');
        typing.style.cssText = 'display:flex;gap:10px;align-items:flex-start;';
        typing.innerHTML = `
            <div style="width:28px;height:28px;border-radius:8px;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <i class="fas fa-brain" style="font-size:0.65rem;color:#10b981;"></i>
            </div>
            <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.09);border-radius:10px;padding:10px 13px;font-size:0.83rem;color:rgba(255,255,255,0.4);font-style:italic;">Thinking...</div>`;
        msgBox.appendChild(typing);
        msgBox.scrollTop = msgBox.scrollHeight;

        try {
            const res = await fetch('/api/continue-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    message: text,
                    user_email: currentUser?.email || '',
                    project_name: currentProjectName || '',
                    history: [],
                    engine: 'anthropic'
                })
            });
            const json = await res.json().catch(() => ({}));
            const reply = json.ai_reply || json.reply || json.message || '';

            typing.remove();
            if (reply) {
                const aiBubble = document.createElement('div');
                aiBubble.style.cssText = 'display:flex;gap:10px;align-items:flex-start;';
                aiBubble.innerHTML = `
                    <div style="width:28px;height:28px;border-radius:8px;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas fa-brain" style="font-size:0.65rem;color:#10b981;"></i>
                    </div>
                    <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.09);border-radius:10px;padding:10px 13px;font-size:0.83rem;color:rgba(255,255,255,0.8);line-height:1.6;max-width:90%;white-space:pre-wrap;">${escapeHtml(reply)}</div>`;
                msgBox.appendChild(aiBubble);
                msgBox.scrollTop = msgBox.scrollHeight;
            }
        } catch (e) {
            typing.remove();
            const errBubble = document.createElement('div');
            errBubble.style.cssText = 'display:flex;gap:10px;align-items:flex-start;';
            errBubble.innerHTML = `
                <div style="width:28px;height:28px;border-radius:8px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <i class="fas fa-exclamation" style="font-size:0.65rem;color:#f87171;"></i>
                </div>
                <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 13px;font-size:0.83rem;color:rgba(255,255,255,0.4);">Connection error. Please try again.</div>`;
            msgBox.appendChild(errBubble);
            msgBox.scrollTop = msgBox.scrollHeight;
        }
    };

    // ── Typewriter utility ────────────────────────────────────────────────────
    async function typeWriter(el, text, speed = 12) {
        if (!el) return;
        if (!speed || speed <= 0) { el.textContent = text; return; }
        el.textContent = '';
        const scrollArea = document.getElementById('bmScrollArea');
        let charCount = 0;
        for (const char of String(text || '')) {
            el.textContent += char;
            charCount++;
            // Scroll every 6 characters so it follows smoothly without being jumpy
            if (scrollArea && charCount % 6 === 0) {
                scrollArea.scrollTop = scrollArea.scrollHeight;
            }
            await new Promise(r => setTimeout(r, speed));
        }
        // Final scroll after each field completes
        if (scrollArea) scrollArea.scrollTop = scrollArea.scrollHeight;
    }

    // ── Reset mind map to idle state ──────────────────────────────────────────
    function resetBmToIdle(projectName) {
        const idlePlh  = document.getElementById('bmIdlePlaceholder');
        const mindMap  = document.getElementById('bmMindMap');
        const titleEl  = document.getElementById('bmTitle');
        const subEl    = document.getElementById('bmSubtitle');
        if (idlePlh)  idlePlh.style.display = '';
        if (mindMap)  mindMap.style.display  = 'none';
        if (titleEl)  titleEl.textContent    = 'Business Model';
        if (subEl)    subEl.textContent      = 'Complete the onboarding wizard to generate your personalized analysis.';
        document.querySelectorAll('.bm-branch').forEach(b => { b.style.display = 'none'; b.style.opacity = '0'; });
        const chList   = document.getElementById('bmChannelsList');
        const compList = document.getElementById('bmCompetitorsList');
        const trends   = document.getElementById('bmMarketTrends');
        if (chList)   chList.innerHTML   = '';
        if (compList) compList.innerHTML = '';
        if (trends)   trends.innerHTML   = '';
        const done = document.getElementById('bmCard-done');
        if (done) done.style.display = 'none';
        const chatPanel = document.getElementById('bmChatPanel');
        if (chatPanel) chatPanel.style.display = 'none';
        const msgBox = document.getElementById('bmChatMessages');
        if (msgBox) msgBox.innerHTML = '';
    }

    // ── Restore BM from localStorage cache ───────────────────────────────────
    function restoreBmFromCache(projectName) {
        const _key = (projectName || '').toLowerCase().trim();
        // Try exact key, then with underscores→spaces, then spaces→underscores
        const raw  = localStorage.getItem(`bm_data_${_key}`)
                  || localStorage.getItem(`bm_data_${_key.replace(/_/g, ' ')}`)
                  || localStorage.getItem(`bm_data_${_key.replace(/ /g, '_')}`);
        if (!raw) { resetBmToIdle(projectName); return; }
        try {
            const d = JSON.parse(raw);
            const titleEl = document.getElementById('bmTitle');
            const subEl   = document.getElementById('bmSubtitle');
            if (titleEl) titleEl.textContent = `${toDisplayName(projectName)} — Business Model`;
            if (subEl)   subEl.textContent   = 'Your personalized analysis.';
            // Reset lists before re-filling
            const chList   = document.getElementById('bmChannelsList');
            const compList = document.getElementById('bmCompetitorsList');
            const trends   = document.getElementById('bmMarketTrends');
            if (chList)   chList.innerHTML   = '';
            if (compList) compList.innerHTML = '';
            if (trends)   trends.innerHTML   = '';
            renderBmMindMap(d, projectName, d._projectType || '', 0);
        } catch(_) { resetBmToIdle(projectName); }
    }

    // ── Render mind map with optional typewriter effect ───────────────────────
    async function renderBmMindMap(data, projectName, projectType, speed = 10) {
        const mindMap  = document.getElementById('bmMindMap');
        const idlePlh  = document.getElementById('bmIdlePlaceholder');
        if (!mindMap) return;

        // Store project type for cache restore
        data._projectType = projectType;

        if (idlePlh) idlePlh.style.display = 'none';
        mindMap.style.display = 'block';

        // Center node
        await typeWriter(document.getElementById('bmCenterName'), projectName, speed * 1.6);
        const ctEl = document.getElementById('bmCenterType');
        if (ctEl) ctEl.textContent = projectType || '';

        await new Promise(r => setTimeout(r, speed ? 280 : 0));

        // ── Market ──
        const bMkt = document.getElementById('bmBranch-market');
        if (bMkt && data.market) {
            const m = data.market;
            bMkt.style.display = 'flex'; bMkt.style.flexDirection = 'column';
            await new Promise(r => requestAnimationFrame(r));
            await new Promise(r => setTimeout(r, speed ? 20 : 0));
            bMkt.style.opacity = '1';
            await typeWriter(document.getElementById('bmMarketSize'),    m.size    || '—', speed * 0.7);
            await typeWriter(document.getElementById('bmMarketSam'),     m.sam     || '—', speed * 0.7);
            await typeWriter(document.getElementById('bmMarketGrowth'),  m.growth  || '—', speed * 0.7);
            await typeWriter(document.getElementById('bmMarketInsight'), m.insight || '—', speed * 0.55);
            const trendsEl = document.getElementById('bmMarketTrends');
            if (trendsEl && Array.isArray(m.trends)) {
                for (const t of m.trends) {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;align-items:flex-start;gap:7px;font-size:0.76rem;color:rgba(255,255,255,0.38);line-height:1.5;';
                    row.innerHTML = '<span style="color:#10b981;flex-shrink:0;margin-top:2px;">→</span><span></span>';
                    trendsEl.appendChild(row);
                    await typeWriter(row.querySelector('span:last-child'), t, speed * 0.45);
                }
            }
        }
        await new Promise(r => setTimeout(r, speed ? 350 : 0));

        // ── Competitors ──
        const bCmp = document.getElementById('bmBranch-competitors');
        if (bCmp && data.competitors) {
            bCmp.style.display = 'flex'; bCmp.style.flexDirection = 'column';
            await new Promise(r => requestAnimationFrame(r));
            await new Promise(r => setTimeout(r, speed ? 20 : 0));
            bCmp.style.opacity = '1';
            const listEl = document.getElementById('bmCompetitorsList');
            if (listEl && Array.isArray(data.competitors)) {
                for (const c of data.competitors) {
                    const item = document.createElement('div');
                    item.style.cssText = 'background:rgba(255,255,255,0.03);border-radius:10px;padding:11px 13px;';
                    item.innerHTML = `
                        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;">
                            <div class="c-name" style="font-weight:600;font-size:0.84rem;color:#fff;"></div>
                            <div style="font-size:0.62rem;color:rgba(255,255,255,0.32);background:rgba(255,255,255,0.05);padding:2px 7px;border-radius:5px;flex-shrink:0;margin-left:10px;">${escapeHtml(c.share||'')}</div>
                        </div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                            <div><div style="font-size:0.58rem;text-transform:uppercase;color:rgba(255,255,255,0.22);margin-bottom:3px;">Weakness</div><div class="c-weak" style="font-size:0.77rem;color:#f87171;line-height:1.5;"></div></div>
                            <div><div style="font-size:0.58rem;text-transform:uppercase;color:rgba(255,255,255,0.22);margin-bottom:3px;">Strength</div><div class="c-str" style="font-size:0.77rem;color:rgba(255,255,255,0.42);line-height:1.5;"></div></div>
                        </div>`;
                    listEl.appendChild(item);
                    await typeWriter(item.querySelector('.c-name'), c.name     || '—', speed * 0.9);
                    await typeWriter(item.querySelector('.c-weak'), c.weakness || '—', speed * 0.42);
                    await typeWriter(item.querySelector('.c-str'),  c.strength || '—', speed * 0.42);
                }
            }
        }
        await new Promise(r => setTimeout(r, speed ? 350 : 0));

        // ── Advantage ──
        const bAdv = document.getElementById('bmBranch-advantage');
        if (bAdv && data.advantage) {
            const a = data.advantage;
            bAdv.style.display = 'flex'; bAdv.style.flexDirection = 'column';
            await new Promise(r => requestAnimationFrame(r));
            await new Promise(r => setTimeout(r, speed ? 20 : 0));
            bAdv.style.opacity = '1';
            await typeWriter(document.getElementById('bmAdvantageMain'),  a.main           || '—', speed * 0.62);
            await typeWriter(document.getElementById('bmAdvantageMoat'),  a.moat           || '—', speed * 0.5);
            await typeWriter(document.getElementById('bmAdvantageDiff'),  a.differentiation|| '—', speed * 0.5);
        }
        await new Promise(r => setTimeout(r, speed ? 350 : 0));

        // ── Risk ──
        const bRsk = document.getElementById('bmBranch-risk');
        if (bRsk && data.risk) {
            const r = data.risk;
            bRsk.style.display = 'flex'; bRsk.style.flexDirection = 'column';
            await new Promise(r2 => requestAnimationFrame(r2));
            await new Promise(r2 => setTimeout(r2, speed ? 20 : 0));
            bRsk.style.opacity = '1';
            const badge = document.getElementById('bmRiskBadge');
            if (badge) badge.textContent = r.probability || 'Medium';
            await typeWriter(document.getElementById('bmRiskDesc'), r.description || '—', speed * 0.58);
            await typeWriter(document.getElementById('bmRiskMit'),  r.mitigation  || '—', speed * 0.48);
        }
        await new Promise(r => setTimeout(r, speed ? 350 : 0));

        // ── Persona ──
        const bPer = document.getElementById('bmBranch-persona');
        if (bPer && data.persona) {
            const p = data.persona;
            bPer.style.display = 'flex'; bPer.style.flexDirection = 'column';
            await new Promise(r => requestAnimationFrame(r));
            await new Promise(r => setTimeout(r, speed ? 20 : 0));
            bPer.style.opacity = '1';
            await typeWriter(document.getElementById('bmPersonaName'), p.name        || '—', speed * 0.7);
            await typeWriter(document.getElementById('bmPersonaPain'), p.painPoint   || '—', speed * 0.5);
            await typeWriter(document.getElementById('bmPersonaPay'),  p.willingness || '—', speed * 0.6);
        }
        await new Promise(r => setTimeout(r, speed ? 350 : 0));

        // ── Channels ──
        const bCh = document.getElementById('bmBranch-channels');
        if (bCh && data.channels) {
            bCh.style.display = 'flex'; bCh.style.flexDirection = 'column';
            await new Promise(r => requestAnimationFrame(r));
            await new Promise(r => setTimeout(r, speed ? 20 : 0));
            bCh.style.opacity = '1';
            const chList = document.getElementById('bmChannelsList');
            if (chList && Array.isArray(data.channels)) {
                for (const ch of data.channels) {
                    const item = document.createElement('div');
                    item.style.cssText = 'display:flex;align-items:flex-start;gap:10px;';
                    item.innerHTML = '<div style="width:5px;height:5px;border-radius:50%;background:#60a5fa;margin-top:5px;flex-shrink:0;"></div><div><div class="ch-name" style="font-weight:600;font-size:0.83rem;color:#fff;margin-bottom:3px;"></div><div class="ch-why" style="font-size:0.77rem;color:rgba(255,255,255,0.42);line-height:1.55;"></div></div>';
                    chList.appendChild(item);
                    await typeWriter(item.querySelector('.ch-name'), ch.name   || '—', speed * 0.85);
                    await typeWriter(item.querySelector('.ch-why'),  ch.reason || '—', speed * 0.42);
                }
            }
        }
        await new Promise(r => setTimeout(r, speed ? 350 : 0));

        // ── Score + Revenue + Analogy ──
        const insightRow = document.getElementById('bmInsightRow');
        if (insightRow) {
            insightRow.style.display = 'grid';

            // Score
            if (data.score) {
                const s = data.score;
                // Animated counter 0 → overall
                const scoreNumEl = document.getElementById('bmScoreNum');
                const target = parseInt(s.overall) || 0;
                if (scoreNumEl && speed > 0) {
                    let cur = 0;
                    const step = Math.max(1, Math.floor(target / 40));
                    await new Promise(resolve => {
                        const iv = setInterval(() => {
                            cur = Math.min(cur + step, target);
                            scoreNumEl.textContent = cur;
                            if (cur >= target) { clearInterval(iv); resolve(); }
                        }, 28);
                    });
                } else if (scoreNumEl) {
                    scoreNumEl.textContent = target;
                }
                await typeWriter(document.getElementById('bmScoreGrade'),   s.grade   || '', speed * 0.5);
                await typeWriter(document.getElementById('bmScoreVerdict'), s.verdict || '', speed * 0.4);

                // Breakdown bars
                const bdEl = document.getElementById('bmScoreBreakdown');
                if (bdEl && s.breakdown) {
                    const dims = [
                        { label: 'Market',    val: s.breakdown.market,    color: '#10b981' },
                        { label: 'Timing',    val: s.breakdown.timing,    color: '#34d399' },
                        { label: 'Advantage', val: s.breakdown.advantage, color: '#60a5fa' },
                        { label: 'Risk',      val: s.breakdown.risk,      color: '#f59e0b' },
                    ];
                    for (const d2 of dims) {
                        const v = parseInt(d2.val) || 0;
                        const row = document.createElement('div');
                        row.style.cssText = 'display:flex;align-items:center;gap:8px;';
                        row.innerHTML = `
                            <div style="font-size:0.58rem;color:rgba(255,255,255,0.3);width:52px;flex-shrink:0;">${d2.label}</div>
                            <div style="flex:1;height:3px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">
                                <div style="height:100%;width:0%;background:${d2.color};border-radius:2px;transition:width 0.7s ease;"></div>
                            </div>
                            <div style="font-size:0.58rem;color:rgba(255,255,255,0.35);width:24px;text-align:right;">${v}</div>`;
                        bdEl.appendChild(row);
                        await new Promise(r => requestAnimationFrame(r));
                        await new Promise(r => setTimeout(r, speed ? 60 : 0));
                        row.querySelector('div > div').style.width = `${v}%`;
                    }
                }
            }

            // Revenue
            if (data.revenue) {
                const rv = data.revenue;
                await typeWriter(document.getElementById('bmRevY1'), rv.year1 || '—', speed * 0.5);
                await typeWriter(document.getElementById('bmRevY2'), rv.year2 || '—', speed * 0.5);
                await typeWriter(document.getElementById('bmRevY3'), rv.year3 || '—', speed * 0.5);
                await typeWriter(document.getElementById('bmRevAssumption'), rv.assumption || '', speed * 0.35);
            }

            // Analogy
            if (data.analogy) {
                const an = data.analogy;
                await typeWriter(document.getElementById('bmAnalogyCompany'), an.company || '—', speed * 1.1);
                await typeWriter(document.getElementById('bmAnalogyRaised'),  an.raised  || '', speed * 0.55);
                await typeWriter(document.getElementById('bmAnalogyInsight'), an.insight || '', speed * 0.4);
            }
        }

        await new Promise(r => setTimeout(r, speed ? 300 : 0));

        // ── CTA ──
        const done = document.getElementById('bmCard-done');
        if (done) {
            done.style.display = 'block';

            // Live activity — realistic fake number seeded by project name
            const seed = (projectName || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
            const liveCount = 3 + (seed % 11); // 3–13
            const actEl = document.getElementById('bmLiveActivity');
            if (actEl) actEl.textContent = `${liveCount} entrepreneurs validated similar ideas this week`;

            // Countdown timer — 48h from first generation, persisted in localStorage
            const timerKey = `bm_timer_${(projectName || '').toLowerCase().trim()}`;
            let expiry = parseInt(localStorage.getItem(timerKey) || '0');
            if (!expiry || expiry < Date.now()) {
                expiry = Date.now() + 48 * 60 * 60 * 1000;
                localStorage.setItem(timerKey, expiry);
            }
            const cdEl = document.getElementById('bmCountdown');
            function updateCountdown() {
                if (!cdEl) return;
                const diff = Math.max(0, expiry - Date.now());
                const h = Math.floor(diff / 3600000);
                const m = Math.floor((diff % 3600000) / 60000);
                const s2 = Math.floor((diff % 60000) / 1000);
                cdEl.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s2).padStart(2,'0')}`;
            }
            updateCountdown();
            setInterval(updateCountdown, 1000);

            // Confetti burst
            if (speed > 0) _bmConfetti();
        }

        await typeWriter(document.getElementById('bmNextStepText'), data.nextStep || '', speed * 0.5);

        // ── Show inline chat panel ─────────────────────────────────────────
        const chatPanel = document.getElementById('bmChatPanel');
        if (chatPanel) {
            chatPanel.style.display = 'block';
            // Clear old messages
            const msgBox = document.getElementById('bmChatMessages');
            if (msgBox) msgBox.innerHTML = `
                <div style="display:flex;gap:10px;align-items:flex-start;">
                    <div style="width:28px;height:28px;border-radius:8px;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas fa-brain" style="font-size:0.65rem;color:#10b981;"></i>
                    </div>
                    <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.09);border-radius:10px;padding:10px 13px;font-size:0.83rem;color:rgba(255,255,255,0.75);line-height:1.55;max-width:90%;">
                        Your business model is ready! Ask me anything — strategy questions, pricing, how to find your first customers, what to build first, or anything about the analysis above.
                    </div>
                </div>`;
        }

        // Scroll + update hint
        const scrollArea = document.getElementById('bmScrollArea');
        if (scrollArea) setTimeout(() => {
            scrollArea.scrollTo({ top: 0, behavior: 'smooth' });
            initBmScrollHint();
        }, 300);
    }

    // ── Green confetti burst ──────────────────────────────────────────────────
    function _bmConfetti() {
        const canvas = document.getElementById('bmConfettiCanvas');
        if (!canvas) return;
        const parent = canvas.parentElement;
        canvas.width  = parent.offsetWidth  || 600;
        canvas.height = parent.offsetHeight || 200;
        const ctx = canvas.getContext('2d');
        const particles = [];
        const colors = ['#10b981','#34d399','#6ee7b7','#a7f3d0','#fff','#f59e0b','#60a5fa'];
        for (let i = 0; i < 80; i++) {
            particles.push({
                x: canvas.width / 2 + (Math.random() - 0.5) * 100,
                y: canvas.height * 0.6,
                vx: (Math.random() - 0.5) * 6,
                vy: -(Math.random() * 5 + 2),
                r: Math.random() * 4 + 2,
                color: colors[Math.floor(Math.random() * colors.length)],
                alpha: 1,
                rot: Math.random() * Math.PI * 2,
                rspeed: (Math.random() - 0.5) * 0.2
            });
        }
        let frame = 0;
        function animate() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            particles.forEach(p => {
                p.x  += p.vx; p.y += p.vy;
                p.vy += 0.12; // gravity
                p.vx *= 0.99;
                p.alpha -= 0.012;
                p.rot += p.rspeed;
                if (p.alpha <= 0) return;
                ctx.save();
                ctx.globalAlpha = p.alpha;
                ctx.fillStyle = p.color;
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rot);
                ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 2);
                ctx.restore();
            });
            frame++;
            if (frame < 120) requestAnimationFrame(animate);
            else ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        animate();
    }

    function _renderBmSection(section, data) {
        const cardEl = document.getElementById(`bmCard-${section}`);
        if (!cardEl) return;
        cardEl.style.display = 'block';

        if (section === 'market') {
            const m = data || {};
            const sz = document.getElementById('bmMarketSize');
            const gr = document.getElementById('bmMarketGrowth');
            const ins = document.getElementById('bmMarketInsight');
            if (sz)  sz.textContent  = m.size    || '—';
            if (gr)  gr.textContent  = m.growth  || '—';
            if (ins) ins.textContent = m.insight  || '—';
        }
        if (section === 'competitors') {
            const list = Array.isArray(data) ? data : [];
            const el = document.getElementById('bmCompetitorsList');
            if (el) el.innerHTML = list.map(c => `
                <div style="display:flex;align-items:flex-start;gap:12px;background:rgba(255,255,255,0.03);border-radius:9px;padding:13px 14px;">
                    <div style="min-width:6px;height:6px;border-radius:50%;background:#f59e0b;margin-top:6px;flex-shrink:0;"></div>
                    <div>
                        <div style="font-weight:600;font-size:0.88rem;color:#fff;margin-bottom:3px;">${escapeHtml(c.name||'')}</div>
                        <div style="font-size:0.82rem;color:rgba(255,255,255,0.45);line-height:1.55;">${escapeHtml(c.weakness||'')}</div>
                    </div>
                </div>`).join('');
        }
        if (section === 'advantage') {
            const a = data || {};
            const main = document.getElementById('bmAdvantageMain');
            const moat = document.getElementById('bmAdvantageMoat');
            if (main) main.textContent = a.main || '—';
            if (moat) moat.textContent = a.moat || '—';
        }
        if (section === 'risk') {
            const r = data || {};
            const desc = document.getElementById('bmRiskDesc');
            const mit  = document.getElementById('bmRiskMit');
            if (desc) desc.textContent = r.description || '—';
            if (mit)  mit.textContent  = r.mitigation  || '—';
        }
    }

    // --- UI MODE SWITCHER ---
    // --- TAB SWITCHER ---
    // --- TAB SWITCHER ---
    window.switchTab = function (tab) {
        // 1. Top Tabs
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        const tabBtn = document.getElementById(`tab-${tab}`);
        if (tabBtn) tabBtn.classList.add('active');

        // 2. Sidebar Icons
        document.querySelectorAll('.nav-icon').forEach(icon => icon.classList.remove('active'));
        // 3. Mobile Bottom Nav
        document.querySelectorAll('.mobile-bottom-nav .nav-item').forEach(n => n.classList.remove('active'));
        const navIcon = document.getElementById(`nav-${tab}`);
        if (navIcon) navIcon.classList.add('active');

        // 4. Sections — simple display toggle via .active class (CSS handles display:none/flex)
        const sectionId = (tab === 'market' || tab === 'growth' || tab === 'capital') ? 'section-build' : (tab === 'business' ? 'section-business' : `section-${tab}`);
        const targetSec = document.getElementById(sectionId);
        if (targetSec) {
            document.querySelectorAll('.section-view').forEach(s => {
                s.classList.remove('active');
            });
            targetSec.classList.add('active');
            // Re-position chat welcome card after section becomes visible
            if (['build', 'market', 'growth', 'capital'].includes(tab)) {
                requestAnimationFrame(() => positionChatWelcome());
            }
        }

        // 5. Channel switching (only for chat-related tabs)
        const tabChannelMap = { build: 'build', market: 'marketing', growth: 'organic', capital: 'capital' };
        const newChannel = tabChannelMap[tab];

        if (newChannel && newChannel !== activeChannel) {
            // Save current channel's history to cache before switching
            if (activeChannel && conversationHistory.length) {
                channelHistoryCache[activeChannel] = {
                    history: [...conversationHistory],
                    stage: chatStage,
                    missingFields: [...latestMissingFields],
                    briefScore: latestBriefScore
                };
            }

            setActiveChannel(newChannel);

            if (currentProjectName) {
                // Restore from cache if available, otherwise fetch from backend
                const cached = channelHistoryCache[newChannel];
                if (cached && cached.history.length) {
                    conversationHistory = [...cached.history];
                    chatStage = cached.stage || 'initial';
                    latestMissingFields = cached.missingFields || getRequiredFields().slice();
                    latestBriefScore = cached.briefScore || 0;
                    clearChatMessages();
                    renderConversationHistory(conversationHistory);
                    renderBriefState({ missing_fields: latestMissingFields });
                } else {
                    loadChatMemory();
                }
            } else {
                // No project loaded — clear chat and show channel welcome
                clearChatMessages();
                conversationHistory = [];
            }
        } else if (newChannel && newChannel === activeChannel) {
            // Same channel — just make sure the section is visible, don't touch chat
        }

        if (tab === 'projects') {
            loadProjects();
        }

        if (tab === 'business') {
            // currentProjectName is closure-scoped; read from localStorage as fallback
            const _bmProject = currentProjectName || (() => {
                try {
                    const email = (currentUser?.email || '').toLowerCase();
                    return localStorage.getItem(`anmar:last_project:${email}`) || '';
                } catch(_) { return ''; }
            })();
            if (_bmProject) restoreBmFromCache(_bmProject);
        }
    }

    // Session restore: reopen last project and chat memory when possible.
    setInteractionMode('strategy');
    setTimelineVisible(false);
    (async () => {
        if (forceWelcome) {
            // Before showing the wizard, check backend — user may have projects from another device
            try {
                const emailQuery = currentUser?.email ? `?email=${encodeURIComponent(currentUser.email)}` : '';
                const checkResp = await fetch(`/list-projects${emailQuery}`, { credentials: 'include' });
                const existingProjects = await checkResp.json();
                if (Array.isArray(existingProjects) && existingProjects.length > 0) {
                    // User already has projects — skip wizard, go to Projects tab
                    forceWelcome = false;
                    markWelcomeDone();
                    switchTab('projects');
                    return;
                }
            } catch (_) { }
            setWelcomeVisible(true);
            // Don't switchTab here — it calls loadProjects() which can hide the welcome
            return;
        }
        const lastProject = localStorage.getItem(getLastProjectStorageKey()) || '';
        if (!lastProject) {
            try {
                const emailQuery = currentUser?.email ? `?email=${encodeURIComponent(currentUser.email)}` : '';
                const response = await fetch(`/list-projects${emailQuery}`, { credentials: 'include' });
                const projects = await response.json();
                if (Array.isArray(projects) && projects.length === 1) {
                    currentProjectName = projects[0];
                    persistCurrentProject();
                    await loadChatMemory();
                    loadProjectPreview(currentProjectName);
                    if (humanChatInterval) clearInterval(humanChatInterval);
                    humanChatInterval = setInterval(pollHumanChat, 3000);
                    pollHumanChat();
                    setWelcomeVisible(false);
                    switchTab('build');
                    addLog(`Project restored: ${currentProjectName}`, 'system');
                    return;
                }
            } catch (e) { }
            switchTab('projects');
            return;
        }
        try {
            const emailQuery = currentUser?.email ? `?email=${encodeURIComponent(currentUser.email)}` : '';
            const response = await fetch(`/list-projects${emailQuery}`, { credentials: 'include' });
            const projects = await response.json();
            if (Array.isArray(projects) && projects.includes(lastProject)) {
                currentProjectName = lastProject;
                persistCurrentProject();
                await loadChatMemory();
                loadProjectPreview(lastProject);
                if (humanChatInterval) clearInterval(humanChatInterval);
                humanChatInterval = setInterval(pollHumanChat, 3000);
                pollHumanChat();
                setWelcomeVisible(false);
                switchTab('build');
                addLog(`Project restored: ${lastProject}`, 'system');
                return;
            }
        } catch (e) {
            console.warn('Project restore failed', e);
        }
        localStorage.removeItem(getLastProjectStorageKey());
        switchTab('projects');
    })();

    // --- MARKETING MODULE ---
    window.startMarketingCampaign = async function () {
        if (!currentProjectName) {
            // Just in case
            return;
        }

        const goal = prompt("🎯 Define el Obejtivo de la Campaign (Ej: 'Ventas flash', 'Viralidad en Gen Z', 'Posicionamiento B2B'):");
        if (!goal) return;

        showThinking("Analizando Mercado con Supra Marketing Core...");

        // Simulation
        await new Promise(r => setTimeout(r, 1500));
        addLog("Analizando audiencia objetivo y competidores...", "system");
        await new Promise(r => setTimeout(r, 2000));
        addLog("Designing high-conversion psychological hooks...", "design");
        await new Promise(r => setTimeout(r, 2000));

        try {
            const res = await fetch('/api/generate-marketing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ project_name: currentProjectName, focus: goal })
            });
            const campaign = await res.json();
            stopThinking();

            if (campaign.error) throw new Error(campaign.error);

            // Format Output
            const html = `
            <div style="background:rgba(255,255,255,0.05); border-left:3px solid #f59e0b; padding:15px; margin-top:10px; font-family:'Inter', sans-serif;"> 
                <h3 style="color:#f59e0b; margin-top:0;"><i class="fas fa-bullhorn"></i> Estrategia Base Generada</h3>
                <div style="margin-bottom:10px; color:#fff; font-weight:bold;">"${campaign.strategy_hook}"</div>
                
                <div style="font-size:0.8rem; color:#aaa; margin-bottom:15px;">
                    <strong>Audiencia:</strong> ${campaign.target_audience}
                </div>

                <div style="background:rgba(0,0,0,0.3); padding:10px; border-radius:6px; margin-bottom:10px;">
                    <div style="color:#10b981; font-size:0.75rem; text-transform:uppercase; letter-spacing:1px; margin-bottom:5px;">Video Concept (Reels/TikTok)</div>
                    <div style="font-size:0.85rem; color:#ddd;">"${campaign.ads[0].concept}"</div>
                    <div style="font-size:0.75rem; color:#888; margin-top:5px; font-style:italic;">Script: "${campaign.ads[0].script}"</div>
                </div>

                <div style="background:rgba(0,0,0,0.3); padding:10px; border-radius:6px;">
                    <div style="color:#3b82f6; font-size:0.75rem; text-transform:uppercase; letter-spacing:1px; margin-bottom:5px;">Copywriting (Social)</div>
                    <div style="font-size:0.85rem; color:#ddd;">"${campaign.ads[1].copy}"</div>
                </div>
                
                <div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:10px;">
                    <div style="font-size:0.8rem; color:#aaa; margin-bottom:10px;">
                        <i class="fas fa-magic"></i> <strong>Activos Base Listos.</strong>
                        Our creative directors are ready to shoot, edit, and launch this campaign.
                    </div>
                    <button onclick="submitTicketInBackground('Production Campaign: ${goal}')" style="background:#f59e0b; color:#000; border:none; padding:8px 16px; border-radius:4px; font-weight:bold; cursor:pointer; width:100%;">
                        🎬 Request Human Production
                    </button>
                </div>
            </div>
        `;
            addSystemMessage(html);

        } catch (e) {
            stopThinking();
            addLog("Error generating campaign: " + e.message, "error");
        }
    }
    /* --- BUILD FLOW & PREMIUM LOGIC --- */

    window.handleBuildClick = async function () {
        try {
            const plan = window.lastGeneratedPlan;
            if (!plan) {
                addLog("No plan to build. Try generating again.", "error");
                return;
            }

            // Proceed with build (tokens checked server-side)
            {
                if (typeof window.startBuildProcess !== 'function') {
                    addLog("Critical error: build module not loaded. Reload the page.", "error");
                    return;
                }

                try {
                    await window.startBuildProcess(plan);
                } catch (buildErr) {
                    addLog("Error executing build: " + buildErr.message, "error");
                    console.error(buildErr);
                }
            }
        } catch (e) {
            addLog("Error en el handler: " + e.message, "error");
            console.error("Build Handler Error", e);
        }
    }

    window.unlockPremium = function () {
        const premiumModal = document.getElementById('premium-modal');
        if (premiumModal) premiumModal.style.display = 'none';
        const pricingModal = document.getElementById('pricing-modal');
        if (pricingModal) pricingModal.style.display = 'flex';
    }

    window.startBuildProcess = async function (plan) {
        // alert("Building..."); // Debug
        // 1. Update Phase Indicator
        updatePhase("STEP 3: BUILD AND DEPLOYMENT");
        setTimelineVisible(true);

        // 2. Start Timeline Animation sequence
        // Step 0: Network
        updateTimeline(0);
        addLog("[ANMAR // CORE] Initializing build sequence...", "system");

        // Step 1: Engineer (Simulated Delay)
        setTimeout(() => {
            updateTimeline(1);
            addLog("[ANMAR // HUMAN] Ingeniero de guardia asignado.", "info");
            showThinking("Generando estructura de archivos...");
        }, 1500);

        // Step 2: Dev (Simulated Delay)
        setTimeout(() => {
            updateTimeline(2);
            addLog("[ANMAR // BUILD] Compilando assets y estructura React/Tailwind...", "info");
        }, 3500);

        // 3. ACTUAL BUILD CALL
        try {
            const res = await fetch('/create-project', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    project_name: (plan.project_name || "project_" + Date.now()).toLowerCase().replace(/\s+/g, '_'),
                    plan: JSON.stringify(plan),
                    theme: plan.style,
                    user_email: currentUser?.email || localStorage.getItem('user_email') || 'guest@anmar.ai'
                })
            });
            const data = await res.json();

            if (data.error) throw new Error(data.error);

            stopThinking();
            logBuildReport(data);

            // 4. Success & Step 3: Ready
            setTimeout(() => {
                updateTimeline(3); // Done
                addLog("[ANMAR // DEPLOY] Successful deployment on preview.anmar.ai", "success");

                // Show "Success Card" in chat
                const successHtml = `
                <div style="background:rgba(16, 185, 129, 0.1); border:1px solid #10b981; padding:15px; border-radius:8px; margin-top:10px;">
                    <h3 style="color:#10b981; margin:0 0 10px 0;">🚀 Project Deployed</h3>
                    <p style="color:#ddd; font-size:0.9rem; margin-bottom:10px;">
                        Your project <strong>${plan.human_readable_name}</strong> is live.
                    </p>
                    <div style="font-size:0.8rem; color:#aaa;">Ruta: ${data.path}</div>
                </div>
             `;
                addSystemMessage(successHtml);

                // 5. LOAD IFRAME
                const iframe = document.getElementById('livePreviewFrame');
                const placeholder = document.getElementById('emptyState');

                if (placeholder) placeholder.style.display = 'none';
                if (iframe) {
                    // Serve via backend static file server
                    // Assuming the iframe is inside the preview container
                    const projectFolder = data.path.split('/').pop(); // get the last folder name
                    iframe.src = `/projects/${projectFolder}/index.html?v=${Date.now()}`;
                    iframe.style.opacity = '1';
                }

            }, 5000); // 5s total animation approx

        } catch (e) {
            stopThinking();
            addLog("[ERROR] " + e.message, "error");
        }
    }

    window.purchasePlan = async function (planId) {
        const btn = (typeof event !== 'undefined' && event?.target) ? event.target.closest('button') : null;
        const originalText = btn ? btn.innerHTML : '';
        if (btn) {
            btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Redirigiendo...';
            btn.style.opacity = '0.7';
        }

        try {
            const currentUser = JSON.parse(localStorage.getItem('currentUser'));
            if (!currentUser || isGuestEmail(currentUser.email)) {
                window.location.href = 'login.html';
                return;
            }

            const res = await fetch('/api/stripe/create-checkout-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ email: currentUser.email, plan: planId })
            });

            const data = await res.json();

            if (data.url) {
                window.location.href = data.url;
                return;
            }
            throw new Error(data.error || "Could not initiate payment.");
        } catch (e) {
            console.error(e);
            if (btn) {
                btn.innerHTML = '<i class="fas fa-times"></i> Error';
                btn.style.background = '#ef4444';
                setTimeout(() => { btn.innerHTML = originalText; btn.style.background = ''; btn.style.opacity = '1'; }, 2000);
            }
        }
    }
    /* --- TOKEN PACK PURCHASE --- */
    window.purchaseTokenPack = async function (packId) {
        const btn = event?.target?.closest('button');
        const originalHTML = btn ? btn.innerHTML : '';
        if (btn) {
            btn.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="font-size:1.2rem;"></i>';
            btn.style.opacity = '0.7';
        }
        try {
            const cu = JSON.parse(localStorage.getItem('currentUser'));
            if (!cu || isGuestEmail(cu.email)) { window.location.href = 'login.html'; return; }
            const res = await fetch('/api/stripe/create-token-pack-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ email: cu.email, pack: packId })
            });
            const data = await res.json();
            if (data.url) { window.location.href = data.url; return; }
            throw new Error(data.error || 'Could not initiate payment.');
        } catch (e) {
            console.error(e);
            if (btn) {
                btn.innerHTML = '<i class="fas fa-times" style="color:#ef4444;"></i>';
                setTimeout(() => { btn.innerHTML = originalHTML; btn.style.opacity = '1'; }, 2000);
            }
        }
    }

    /* --- TOKEN/PLAN DISPLAY (simplified — tokens removed) --- */
    function updateTokenDisplay(remaining) {
        // No-op: token display removed, plan badge is updated via updatePlanBadge()
    }

    function showTokenLowBanner(remaining) { /* removed */ }
    function hideTokenLowBanner() { /* removed */ }

    /* --- HELPER: TIMELINE --- */
    window.updateTimeline = function (stepIndex) {
        const steps = document.querySelectorAll('.step-dot');
        steps.forEach((b, idx) => {
            if (idx <= stepIndex) {
                b.style.background = '#10b981'; // Green
                b.style.borderColor = '#fff';
                if (idx === stepIndex) {
                    b.style.boxShadow = '0 0 10px #10b981'; // Glow active
                    b.style.transform = 'scale(1.2)';
                } else {
                    b.style.boxShadow = 'none';
                    b.style.transform = 'scale(1)';
                }
            } else {
                b.style.background = '#333'; // Inactive
                b.style.borderColor = '#000';
                b.style.boxShadow = 'none';
                b.style.transform = 'scale(1)';
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            const email = currentUser?.email?.toLowerCase() || '';
            localStorage.removeItem('currentUser');
            localStorage.removeItem('pendingPlan');
            localStorage.removeItem('pending_ticket_project');
            if (email) {
                localStorage.removeItem(`anmar:last_project:${email}`);
            }
            // Clear all anmar-prefixed keys
            try {
                Object.keys(localStorage).forEach(key => {
                    if (key.startsWith('anmar:')) localStorage.removeItem(key);
                });
            } catch (e) {}
            // Use replace() so dashboard is removed from history — back button won't return here
            window.location.replace('login.html');
        });
    }

    // Guard against bfcache restore (browser Back button after logout)
    window.addEventListener('pageshow', (e) => {
        if (e.persisted) {
            // Page restored from cache — re-check auth
            const raw = localStorage.getItem('currentUser');
            if (!raw) {
                window.location.replace('login.html');
            }
        }
    });

    // === Consume pendingPlan AFTER purchasePlan is defined ===
    (function consumePendingPlan() {
        const pendingPlan = localStorage.getItem('pendingPlan');
        if (!pendingPlan || !currentUser?.email || isGuestEmail(currentUser.email)) return;
        localStorage.removeItem('pendingPlan');
        // Don't auto-trigger if already subscribed to same or better plan
        if (typeof subscriptionActive !== 'undefined' && subscriptionActive) {
            return;
        }
        if (typeof window.purchasePlan === 'function') {
            setTimeout(() => {
                try {
                    window.purchasePlan(pendingPlan);
                } catch (e) {
                    console.error('Failed to trigger pending plan checkout:', e);
                    if (typeof addLog === 'function') addLog('Could not start automatic payment. Go to the plans section.', 'warning');
                }
            }, 1200);
        }
    })();

    // Team chat is always active — ensure polling is always running
    if (!humanChatInterval && currentProjectName) {
        humanChatInterval = setInterval(pollHumanChat, 4000);
        pollHumanChat();
    }

    window.addEventListener('beforeunload', () => {
        if (humanChatInterval) clearInterval(humanChatInterval);
        if (typeof pollInterval !== 'undefined' && pollInterval) clearInterval(pollInterval);
    });

    // Reposition chat welcome on resize
    window.addEventListener('resize', () => {
        const w = document.getElementById('humanChatWelcome');
        if (w && w.style.display !== 'none') positionChatWelcome();
    });
    // Initial position after layout settles
    setTimeout(positionChatWelcome, 300);
    // Initialize welcome content for default channel
    setTimeout(() => updateChannelWelcome(activeChannel), 350);

    window.__mainScriptOk = true;
    } catch (e) {
        console.error('Dashboard boot error:', e);
        if (window.__applyDashboardFallback) {
            window.__applyDashboardFallback();
        }
    }
});
