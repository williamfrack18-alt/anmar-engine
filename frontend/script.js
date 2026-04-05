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
    const userTokensEl = document.getElementById('userTokens'); // ADDED THIS LINE
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
        if (!email) return;
        currentUser = currentUser || {};
        currentUser.email = email.trim().toLowerCase();
        if (!currentUser.name || currentUser.name === 'Invitado') {
            currentUser.name = email.split('@')[0] || 'Cliente';
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
    const notifiedBlueprintIds = new Set();
    const blueprintAudio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
    blueprintAudio.volume = 0.4;

    async function pollHumanChat() {
        if (!currentProjectName) return;
        try {
            const res = await fetch(`/api/human-chat/history?project_name=${encodeURIComponent(getActiveProjectKey())}`);
            const data = await res.json();
            const history = data.history || [];
            updateBlueprintNotifications(history);
            if (history && history.length > lastHumanChatCount) {
                lastHumanChatCount = history.length;
                renderHumanChat(history);
                // Human-only chat: always visible
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
            notifList.innerHTML = '<div style="color:rgba(255,255,255,0.6); font-size:0.85rem;">Sin notificaciones.</div>';
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
                <div class="notif-item-meta">${item.accepted ? 'Blueprint aprobado' : 'Blueprint pendiente'} ${timeLabel ? '• ' + timeLabel : ''}</div>
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
        msgRow.innerHTML = `<div class="ai-msg">${text}</div>`;
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

    function renderHumanChat(history) {
        const container = document.getElementById('humanChatContent');
        if (!container) return;
        container.innerHTML = '';
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
                    badge.textContent = 'Blueprint aprobado';
                    actions.appendChild(badge);
                } else if (!isClient) {
                    const btn = document.createElement('button');
                    btn.className = 'blueprint-btn';
                    btn.textContent = 'Aceptar blueprint';
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
                    <h4>Preview actualizado</h4>
                    <div class="blueprint-meta">Tu ingeniero compartió una nueva previsualización.</div>
                `;
                if (url) {
                    const actions = document.createElement('div');
                    actions.className = 'blueprint-actions';
                    const btn = document.createElement('button');
                    btn.className = 'blueprint-btn';
                    btn.textContent = 'Abrir preview';
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
        sendBtn.disabled = !canSend;
        sendBtn.classList.toggle('active', canSend);
        if (chatWrap) chatWrap.classList.toggle('typing', len > 0);
        if (chatCounter) {
            chatCounter.textContent = `${len}/${CHAT_MAX_CHARS}`;
            chatCounter.classList.toggle('over', overLimit);
        }
    };
    function updateChatCopy(tab = 'AI') {
        if (!chatInput) return;
        const isHuman = String(tab || '').toLowerCase().includes('human');
        if (isMarketingChannel()) {
            if (isHuman) {
                chatInput.placeholder = "Paso 1: Cuéntanos el objetivo de marketing y el producto.";
                if (chatHelper) {
                    chatHelper.textContent = "Paso 1: Define la campaña. Paso 2: Asignamos estratega de marketing.";
                }
            } else {
                chatInput.placeholder = "Describe objetivo, audiencia, oferta y presupuesto...";
                if (chatHelper) {
                    chatHelper.textContent = "La IA prepara la estrategia y copys para pauta en redes.";
                }
            }
            return;
        }

        if (isHuman) {
            chatInput.placeholder = "Paso 1: Cuéntanos qué necesitas. Ej: “Necesito una web para mi estudio con reservas.”";
            if (chatHelper) {
                chatHelper.textContent = "Paso 1: Cuéntanos qué necesitas. Paso 2: Te asignamos un ingeniero en minutos.";
            }
        } else {
            chatInput.placeholder = interactionMode === 'edit'
                ? "Describe qué quieres editar en el proyecto..."
                : "Describe tu idea... (ej. 'Un SaaS para gestión con Stripe')";
            if (chatHelper) {
                chatHelper.textContent = "Describe tu idea y generamos el blueprint técnico automáticamente.";
            }
        }
    }

    function setPreviewMode(mode) {
        const isMarketing = mode === 'marketing';
        if (livePreviewFrame) livePreviewFrame.style.display = isMarketing ? 'none' : 'block';
        if (marketingPreviewContainer) marketingPreviewContainer.style.display = isMarketing ? 'block' : 'none';
        if (emptyState) {
            if (isMarketing) {
                emptyState.style.display = 'none';
            } else if (!livePreviewFrame || !livePreviewFrame.src || livePreviewFrame.src === 'about:blank') {
                emptyState.style.display = 'flex';
            }
        }
        const urlBar = document.querySelector('.url-bar');
        if (urlBar) urlBar.textContent = isMarketing ? 'ads.anmar.ai/preview' : (currentProjectName ? `anmar.app/projects/${currentProjectName}` : 'preview.anmar.ai');
        const mobileBtnEl = document.getElementById('mobileViewBtn');
        const desktopBtnEl = document.getElementById('desktopViewBtn');
        if (mobileBtnEl) mobileBtnEl.style.display = isMarketing ? 'none' : 'inline-flex';
        if (desktopBtnEl) desktopBtnEl.style.display = isMarketing ? 'none' : 'inline-flex';
    }

    function setActiveChannel(channel) {
        activeChannel = channel === 'marketing' ? 'marketing' : 'build';
        updateChatCopy(isHumanChatActive ? 'Human' : 'AI');
        setPreviewMode(activeChannel);
        if (paywallBanner) {
            const slot = paywallBanner.querySelector('div');
            if (slot) {
                slot.innerHTML = isMarketingChannel()
                    ? '<strong>Activa tu plan</strong> para habilitar el chat con marketing.'
                    : '<strong>Activa tu plan</strong> para habilitar el chat con ingenieros.';
            }
        }
        if (togglePreviewBtn) {
            togglePreviewBtn.textContent = isMarketingChannel() ? 'Preview Marketing' : 'Preview';
        }
        if (isMarketingChannel()) {
            renderMarketingPreview(currentMarketingAssets);
        }
        if (resultSection && isMarketingChannel()) resultSection.style.display = 'none';
        if (statusTimeline) setTimelineVisible(!isMarketingChannel() && (chatStage === 'construction_mode' || chatStage === 'building'));
        latestMissingFields = getRequiredFields().slice();
        renderBriefState({ missing_fields: latestMissingFields, memory_summary: '' });
    }

    // React to Tab switch
    document.addEventListener('chatTabSwitched', (e) => {
        updateChatCopy(e.detail || 'AI');
        resizeChatInput();
        updateSendState();
    });

    if (!currentUser) {
        ensureGuestUser();
    }

    // Initialize welcome screen greeting once user is known
    typeWelcomeText();

    if (typeof switchChatTab === 'function') {
        switchChatTab('AI');
    }

    if (togglePreviewBtn && previewPanel && buildSection) {
        if (previewPanel.classList.contains('preview-hidden')) {
            buildSection.classList.add('expand-chat');
        }
        togglePreviewBtn.addEventListener('click', () => {
            const hidden = previewPanel.classList.toggle('preview-hidden');
            buildSection.classList.toggle('expand-chat', hidden);
            togglePreviewBtn.textContent = hidden ? 'Mostrar Preview' : 'Ocultar Preview';
        });
    }

    function formatPlanLabel(plan) {
        const key = (plan || '').toLowerCase();
        if (key.includes('marketing + construcción') || key.includes('marketing + construccion')) {
            return 'Marketing + Construcción';
        }
        if (key.includes('marketing')) return 'Marketing';
        return 'Plan requerido';
    }

    async function refreshSubscriptionStatus(showMessage = false) {
        if (!userTokensEl) return;
        try {
            const res = await fetch(`/api/user-stats?email=${currentUser.email}`);
            const data = await res.json();
            if (data.subscription_active !== undefined) {
                subscriptionActive = !!data.subscription_active;
                subscriptionPlan = data.subscription_plan || 'none';
                const label = subscriptionActive ? formatPlanLabel(subscriptionPlan) : 'Plan requerido';
                userTokensEl.innerHTML = `<i class="fas fa-crown" style="color:#fbbf24; margin-right:6px;"></i> ${label}`;
                if (profileCreditsEl) {
                    profileCreditsEl.textContent = subscriptionActive ? label : 'Sin plan activo';
                }
                if (!subscriptionActive && showMessage) {
                    addLog("🔒 Para chatear con el equipo necesitas activar un plan.", "system");
                }
                updatePaywallBanner();
                if (subscriptionActive && chatLockedForSubscription) {
                    setChatLocked(false);
                }
                syncChatLockWithPendingTicket();
            }
        } catch (e) {
            console.error("Auth Error", e);
        }
    }

    function updatePaywallBanner() {
        if (!paywallBanner) return;
        if (subscriptionActive) {
            paywallBanner.style.display = 'none';
        } else {
            paywallBanner.style.display = 'flex';
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
        const pendingProject = localStorage.getItem('pending_ticket_project') || '';
        const shouldLock = !!pendingProject && !subscriptionActive && currentProjectName && pendingProject === currentProjectName;
        setChatLocked(shouldLock);
    }

    async function checkUserCredits() {
        await refreshSubscriptionStatus();
    }

    async function requireSubscription() {
        if (subscriptionActive) return true;
        await refreshSubscriptionStatus(true);
        if (subscriptionActive) return true;
        const modal = document.getElementById('pricing-modal');
        if (modal) modal.style.display = 'flex';
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
            if (!email || !email.includes('@')) {
                alert('Escribe un correo válido para continuar.');
                return;
            }
            setCurrentUserEmail(email);
            hydrateProfile();
            refreshSubscriptionStatus(true);
            if (paywallEmailGate) paywallEmailGate.style.display = 'none';
            if (pendingPlanId) {
                const nextPlan = pendingPlanId;
                pendingPlanId = null;
                window.purchasePlan(nextPlan);
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
    let interactionMode = 'strategy'; // strategy | edit
    let selectedEngine = 'antigravity';
    let latestMissingFields = [];
    let latestBriefScore = 0;
    let pendingImageDataUrl = '';
    let pendingImageName = '';
    let speechRecognition = null;
    let isVoiceRecording = false;
    let reviewOverlayTimer = null;
    let previewLockedByReview = false;
    let subscriptionActive = false;
    let subscriptionPlan = 'none';
    let chatLockedForSubscription = false;

    const BUILD_REQUIRED_FIELDS = ['summary', 'audience', 'business_model', 'timeline', 'features'];
    const MARKETING_REQUIRED_FIELDS = ['goal', 'audience', 'offer', 'channels', 'budget', 'timeline', 'brand_voice', 'key_message'];
    let activeChannel = 'build'; // build | marketing
    let currentMarketingBrief = null;
    let currentMarketingAssets = [];

    function isMarketingChannel() {
        return activeChannel === 'marketing';
    }

    function getActiveProjectKey() {
        if (!currentProjectName) return '';
        return isMarketingChannel() ? `${currentProjectName}__marketing` : currentProjectName;
    }

    function getRequiredFields() {
        return isMarketingChannel() ? MARKETING_REQUIRED_FIELDS : BUILD_REQUIRED_FIELDS;
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
    renderBriefState();
    (function handleCheckoutReturn() {
        const params = new URLSearchParams(window.location.search);
        const status = params.get('checkout');
        const sessionId = params.get('session_id');
        if (!status) return;
        if (status === 'success') {
            if (sessionId) {
                fetch(`/api/stripe/verify-session?session_id=${encodeURIComponent(sessionId)}`)
                    .then(() => refreshSubscriptionStatus(true))
                    .then(() => submitPendingTicketIfAny())
                    .catch(() => refreshSubscriptionStatus(true));
            } else {
                setTimeout(() => {
                    refreshSubscriptionStatus(true).then(() => submitPendingTicketIfAny());
                }, 1200);
            }
            addLog("✅ Pago confirmado. Tu plan ya está activo.", "success");
        }
        if (status === 'cancel') {
            addLog("Pago cancelado. Puedes intentar de nuevo cuando quieras.", "system");
        }
    })();

    async function submitPendingTicketIfAny() {
        const pendingProject = localStorage.getItem('pending_ticket_project') || '';
        if (!pendingProject || !currentUser?.email) return;
        try {
            const res = await fetch('/api/tickets/submit-pending', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_email: currentUser.email, project_name: pendingProject })
            });
            const data = await res.json();
            if (data && data.status === 'ok' && Array.isArray(data.tickets) && data.tickets.length) {
                localStorage.removeItem('pending_ticket_project');
                setChatLocked(false);
                addLog("✅ Ticket enviado automáticamente al equipo.", "success");
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

    function initWelcomeScreen() {
        if (!welcomeScreen) return;
        try {
            const alreadyDone = localStorage.getItem(getWelcomeDismissKey());
            forceWelcome = !alreadyDone;
        } catch (_) {
            forceWelcome = true;
        }
        if (welcomeCloseBtn) {
            welcomeCloseBtn.addEventListener('click', () => {
                forceWelcome = false;
                markWelcomeDone();
                setWelcomeVisible(false);
                switchTab('projects');
            });
        }
        if (welcomePhoneBtn) {
            welcomePhoneBtn.addEventListener('click', async () => {
                const name = (welcomeInput?.value || '').trim();
                const phone = (welcomePhoneInput?.value || '').trim();
                if (!name) {
                    if (welcomeStatus) welcomeStatus.textContent = 'Escribe el nombre del proyecto.';
                    return;
                }
                if (!phone) {
                    if (welcomeStatus) welcomeStatus.textContent = 'Escribe tu número de teléfono.';
                    return;
                }
                welcomePhoneBtn.disabled = true;
                const originalLabel = welcomePhoneBtn.textContent;
                welcomePhoneBtn.textContent = 'Creando...';
                const created = await createProjectByName(name, {
                    showAlert: false,
                    phone,
                    onError: (msg) => {
                        if (welcomeStatus) welcomeStatus.textContent = msg || 'No se pudo crear el proyecto.';
                    }
                });
                if (created) {
                    forceWelcome = false;
                    markWelcomeDone();
                    if (welcomeScreen) welcomeScreen.classList.add('fade-out');
                    setTimeout(() => {
                        setWelcomeVisible(false);
                    }, 250);
                } else {
                    welcomePhoneBtn.disabled = false;
                    welcomePhoneBtn.textContent = originalLabel;
                }
            });
        }
        if (welcomeInput) {
            welcomeInput.addEventListener('input', () => {
                const value = (welcomeInput.value || '').trim();
                if (welcomeStartBtn) welcomeStartBtn.disabled = value.length < 1;
                if (welcomeStatus) welcomeStatus.textContent = '';
            });
            welcomeInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    if (welcomeStartBtn && !welcomeStartBtn.disabled) welcomeStartBtn.click();
                }
            });
        }
        if (welcomeStartBtn) {
            welcomeStartBtn.addEventListener('click', async () => {
                const value = (welcomeInput?.value || '').trim();
                if (value.length < 1) {
                    if (welcomeStatus) welcomeStatus.textContent = 'Escribe un nombre para el proyecto.';
                    return;
                }
                if (welcomePhoneStep) {
                    welcomePhoneStep.style.display = 'flex';
                }
                if (welcomePhoneInput) {
                    welcomePhoneInput.focus();
                }
            });
        }
        setWelcomeVisible(false);
    }

    window.openWelcomeNewProject = function () {
        forceWelcome = true;
        if (welcomePhoneStep) {
            welcomePhoneStep.style.display = 'none';
        }
        if (welcomeInput) {
            welcomeInput.value = '';
        }
        if (welcomePhoneInput) {
            welcomePhoneInput.value = '';
        }
        if (welcomeStatus) {
            welcomeStatus.textContent = '';
        }
        if (welcomeStartBtn) {
            welcomeStartBtn.disabled = true;
        }
        setWelcomeVisible(true);
        switchTab('projects');
    }

    initWelcomeScreen();

    window.addEventListener('error', (event) => {
        try {
            if (welcomeStatus) {
                welcomeStatus.textContent = `Error interno: ${event.message || 'Revisa la consola.'}`;
            }
        } catch (e) {}
    });

    function typeWelcomeText() {
        if (!welcomeType || welcomeTyped) return;
        welcomeTyped = true;
        const rawName = (currentUser?.name || '').trim();
        const displayName = rawName ? rawName.split(' ')[0] : 'arquitecto';
        const text = `Bienvenido de nuevo, ${displayName} — ¿qué vamos a construir hoy?`;
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
                welcomeScreen.classList.add('visible');
                welcomeScreen.classList.remove('fade-out');
                document.body.classList.add('welcome-mode');
                if (welcomeInput) {
                    welcomeInput.value = '';
                    if (welcomeStartBtn) welcomeStartBtn.disabled = true;
                }
                if (welcomePhoneInput) {
                    welcomePhoneInput.value = '';
                }
                if (welcomePhoneStep) {
                    welcomePhoneStep.style.display = 'none';
                }
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
            addLog(`Motor activo: ${label}`, 'system');
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
        const messages = terminalContent.querySelectorAll('.msg-row');
        messages.forEach((node) => {
            if (!resultSection.contains(node)) node.remove();
        });
    }

    function appendUserMessageFromMemory(text) {
        const msgRow = document.createElement('div');
        msgRow.className = 'msg-row user';
        const bubble = document.createElement('div');
        bubble.className = 'user-msg';
        bubble.textContent = String(text || '');
        msgRow.appendChild(bubble);
        terminalContent.insertBefore(msgRow, resultSection);
    }

    function appendAiMessageFromMemory(text) {
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
            addLog("Modo Estrategia activo: briefing, refinamiento y handoff.", "system");
        });
    }

    if (modeEditBtn) {
        modeEditBtn.addEventListener('click', () => {
            setInteractionMode('edit');
            addLog("Modo Edición activo: cambios directos sobre el proyecto.", "system");
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
                addLog("Cambia a modo Estrategia para generar el blueprint.", "warning");
                return;
            }
            if (!currentProjectName) {
                addLog("Primero crea o selecciona un proyecto.", "warning");
                switchTab('projects');
                return;
            }
            const seed = (briefSummaryText?.textContent || originalIdea || '').trim();
            if (!seed) {
                addLog("Aún falta contexto para construir. Describe mejor la idea en el chat.", "warning");
                return;
            }
            setLoading(true);
            try {
                addLog("Generando blueprint y construyendo versión inicial...", "system");
                await handleGeneratePlan(seed);
            } catch (e) {
                addLog(`No se pudo construir: ${e.message}`, "error");
            } finally {
                setLoading(false);
            }
        });
    }

    // --- Terminal & Log Logic ---
    function escapeHtml(str) {
        return String(str || '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    async function hydrateProfile() {
        if (!currentUser) return;
        if (profileNameEl) profileNameEl.textContent = currentUser.name || 'Usuario Anmar';
        if (profileEmailEl) profileEmailEl.textContent = currentUser.email || '';
        if (profileMemberSinceEl) {
            profileMemberSinceEl.textContent = `Activo en Anmar`;
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
        if (Array.isArray(meta.missing_fields)) {
            latestMissingFields = meta.missing_fields.slice();
        }
        if (typeof meta.brief_score === 'number') {
            latestBriefScore = Math.max(0, Math.min(100, meta.brief_score));
        } else {
            const total = getRequiredFields().length || 1;
            latestBriefScore = Math.max(0, Math.min(100, Math.round(((total - latestMissingFields.length) / total) * 100)));
        }

        const summary = (meta.memory_summary || '').trim();
        if (briefScoreText) briefScoreText.textContent = `${latestBriefScore}%`;
        if (briefScoreBar) briefScoreBar.style.width = `${latestBriefScore}%`;
        if (briefMissingList) {
            briefMissingList.textContent = latestMissingFields.length ? latestMissingFields.join(', ') : 'Ninguno';
        }
        if (briefSummaryText) {
            briefSummaryText.textContent = summary || 'Esperando conversación...';
        }
        if (blueprintNowBtn) {
            const canShow = !isMarketingChannel() && latestBriefScore >= 80 && interactionMode === 'strategy' && chatStage !== 'construction_mode';
            blueprintNowBtn.style.display = canShow ? 'block' : 'none';
        }
    }

    function setTimelineVisible(visible) {
        if (!statusTimeline) return;
        statusTimeline.style.display = visible ? 'flex' : 'none';
    }

    function addLog(text, type = 'info') {
        const msgRow = document.createElement('div');
        msgRow.className = 'msg-row ai';

        let color = '#ccc'; // default
        let prefix = '>';

        if (type === 'design') { color = '#d946ef'; prefix = '[George // DESIGN]'; } // Fuchsia for Design
        if (type === 'eng') { color = '#3b82f6'; prefix = '[Julian // DEV]'; }    // Blue for Dev
        if (type === 'system') { color = '#10b981'; prefix = '[ANMAR // CORE]'; } // Green for System
        if (type === 'success') { color = '#22c55e'; prefix = '[OK]'; }
        if (type === 'warning') { color = '#f59e0b'; prefix = '[WARN]'; }
        if (type === 'error') { color = '#ef4444'; prefix = '[ERROR]'; }

        msgRow.innerHTML = `<div class="ai-msg" style="font-family:'JetBrains Mono'; font-size: 0.85rem; color:${color}; opacity:0.9;">
            <span style="opacity:0.6; margin-right:8px;">${prefix}</span> ${text}
        </div>`;

        terminalContent.insertBefore(msgRow, resultSection);
        terminalContent.scrollTop = terminalContent.scrollHeight;
    }
    window.addLog = addLog; // Expose globally

    async function addSystemMessage(htmlContent) {
        const msgRow = document.createElement('div');
        msgRow.className = 'msg-row ai';

        // Container for text
        const contentDiv = document.createElement('div');
        contentDiv.className = 'ai-msg';
        contentDiv.style.whiteSpace = 'pre-wrap';
        msgRow.appendChild(contentDiv);

        terminalContent.insertBefore(msgRow, resultSection);

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

    function addUserMessage(text) {
        const msgRow = document.createElement('div');
        msgRow.className = 'msg-row user';
        msgRow.innerHTML = `<div class="user-msg">${text}</div>`;
        terminalContent.insertBefore(msgRow, resultSection);
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
        attachmentStatus.textContent = `Imagen adjunta: ${pendingImageName || 'archivo'} (se enviará con el mensaje)`;
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
            addLog('Micrófono activo. Habla ahora...', 'system');
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
            addLog('No se pudo usar el micrófono en este intento.', 'warning');
        };
    }

    // --- SIMULATION ENGINE ---
    async function simulateTeamExecution() {
        // 1. System Analysis
        addLog("Analizando requerimientos del cliente...", "system");
        await new Promise(r => setTimeout(r, 800));

        addLog("Arquitectura validada. Desplegando equipo experto.", "system");
        await new Promise(r => setTimeout(r, 1000));

        // 2. Dispatch to Experts
        // 2. Dispatch to Experts (THEATER V2 - High Latency)
        addLog("Ticket #4092 asignado a: George (Lead Designer)", "info");
        await new Promise(r => setTimeout(r, 2000));

        addLog("George: Escaneando patrones de UI competitivos...", "design");
        await new Promise(r => setTimeout(r, 2500));

        addLog("George: Definiendo paleta de colores (Deep Dark Mode)...", "design");
        await new Promise(r => setTimeout(r, 2500));

        addLog("Ticket #4093 asignado a: Julián (Senior FullStack)", "info");
        await new Promise(r => setTimeout(r, 2000));

        addLog("Julián: Inicializando entorno de desarrollo (Python/React)...", "eng");
        await new Promise(r => setTimeout(r, 2500));

        // 3. Work Simulation
        addLog("George: Aplicando principios de Glassmorphism v2.0...", "design");
        await new Promise(r => setTimeout(r, 3000));

        addLog("Julián: Estructurando HTML semántico con Tailwind CDN...", "eng");
        await new Promise(r => setTimeout(r, 2500));

        addLog("Julián: Inyectando scripts de interactividad...", "eng");
        await new Promise(r => setTimeout(r, 2000));

        addLog("Sincronizando módulos Frontend y Backend...", "system");
        await new Promise(r => setTimeout(r, 1000));

        // FINAL SUCCESS MESSAGE WITH "HUMAN CRAFTSMANSHIP" UPSELL
        const successMsg = `
            <div style="border-left: 3px solid #10b981; padding-left: 10px; margin-top: 10px;">
                <div style="color:#10b981; font-weight:bold;">✨ Previsualización Generada por Supra AI</div>
                <div style="color:#ccc; font-size:0.85rem; margin-top:5px;">
                    Este es un prototipo funcional generado automáticamente a velocidad 10x.
                </div>
                <div style="background:rgba(255,255,255,0.05); padding:8px; margin-top:8px; border-radius:4px; font-size:0.8rem; color:#aaa;">
                    <i class="fas fa-hammer" style="color:#fbbf24; margin-right:5px;"></i>
                    <strong>Siguiente Nivel:</strong> Nuestro equipo de ingenieros de élite (George & Julián) está listo para pulir, asegurar y escalar este código con artesanía humana.
                </div>
                <button onclick="triggerHumanRefinement()" style="background: linear-gradient(90deg, #10b981 0%, #059669 100%); border:none; color:white; padding:8px 16px; border-radius:4px; margin-top:10px; cursor:pointer; font-weight:bold; font-size:0.8rem; box-shadow:0 4px 12px rgba(16,185,129,0.3);">
                    💎 Solicitar Refinamiento Humano
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
            const instruction = prompt("Describe qué aspectos deseas que nuestro equipo pula o mejore (ej: 'Mejorar animaciones', 'Integrar pasarela de pagos', 'Optimizar SEO'):");
            if (instruction) {
                handleEditProject(instruction); // Reuses the hybrid ticket logic
            }
        }
    }

    async function handleMarketingChat(userInput, imageDataUrl = '') {
        if (!currentProjectName) {
            addLog("Primero crea o selecciona un proyecto en el módulo Proyectos.", "system");
            switchTab('projects');
            return;
        }
        if (isResetIntent(userInput)) {
            try {
                await fetch('/api/chat-memory/reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
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

        showThinking("Analizando mercado y activos...");
        try {
            const res = await fetch('/api/continue-marketing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    history: conversationHistory.slice(-28),
                    message: userInput,
                    image_data_url: imageDataUrl,
                    user_email: currentUser.email,
                    project_name: getActiveProjectKey()
                })
            });
            const data = await res.json();
            stopThinking();
            if (!res.ok) {
                throw new Error(data.error || 'Error de marketing');
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
                        <h3 style="color:#38bdf8; margin:0 0 8px 0;">Brief listo para el equipo de marketing</h3>
                        <p style="color:#cbd5f5; font-size:0.85rem; margin:0 0 10px 0;">¿Quieres enviar esto al equipo humano para producción y lanzamiento?</p>
                        <button onclick="window.sendMarketingBrief()" style="background:#38bdf8; color:#0f172a; border:none; padding:10px 16px; border-radius:8px; font-weight:700; cursor:pointer; width:100%;">
                            Enviar a Marketing
                        </button>
                    </div>
                `);
            }
            queueMemorySave();
        } catch (e) {
            stopThinking();
            addLog(`Error marketing: ${e.message}`, "error");
        }
    }

    window.sendMarketingBrief = async function () {
        if (!currentProjectName || !currentUser?.email) {
            addLog("Selecciona un proyecto antes de enviar el brief.", "warning");
            return;
        }
        const okSubscription = await requireSubscription();
        if (!okSubscription) return;
        const brief = currentMarketingBrief || {};
        const assets = Array.isArray(currentMarketingAssets) ? currentMarketingAssets : [];
        const summary = [
            `Brief Marketing: ${brief.key_message || brief.goal || 'Campaña'}`,
            brief.audience ? `Audiencia: ${brief.audience}` : '',
            brief.offer ? `Oferta: ${brief.offer}` : '',
            brief.channels ? `Canales: ${Array.isArray(brief.channels) ? brief.channels.join(', ') : brief.channels}` : '',
            brief.timeline ? `Timeline: ${brief.timeline}` : '',
            brief.budget ? `Presupuesto: ${brief.budget}` : ''
        ].filter(Boolean).join('\n');

        const assetLines = assets.map(item => {
            const platform = item.platform || 'Social';
            const hook = item.hook || '';
            const caption = item.caption || '';
            return `- ${platform}: ${hook} ${caption}`.trim();
        }).join('\n');

        const payloadText = `${summary}\n\nActivos sugeridos:\n${assetLines || 'Pendientes de definición.'}`;
        try {
            await fetch('/api/human-chat/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    project_name: getActiveProjectKey(),
                    role: 'client',
                    content: payloadText,
                    actor: currentUser.name || 'Cliente',
                    client_email: currentUser.email || ''
                })
            });
            addLog("Brief enviado al equipo de marketing.", "success");
            if (typeof switchChatTab === 'function') switchChatTab('Human');
            pollHumanChat();
        } catch (e) {
            addLog(`No se pudo enviar el brief: ${e.message}`, "warning");
        }
    }

    // --- 1. Main Chat Handler ---
    sendBtn.addEventListener('click', async () => {
        const text = chatInput.value.trim();
        if (!text && !pendingImageDataUrl) return;
        if (isProcessing) return;
        if (!currentProjectName) {
            addLog("Primero crea o selecciona un proyecto en el módulo Proyectos.", "system");
            switchTab('projects');
            return;
        }
        if (chatLockedForSubscription && !subscriptionActive) {
            const modal = document.getElementById('pricing-modal');
            if (modal) modal.style.display = 'flex';
            addLog("🔒 Tu proyecto está listo. Activa un plan para continuar.", "system");
            return;
        }

        // --- NEW: HUMAN CHAT FLOW ---
        if (typeof isHumanChatActive !== 'undefined' && isHumanChatActive) {
            const okSubscription = await requireSubscription();
            if (!okSubscription) return;
            const messageToSend = text;
            chatInput.value = '';
            const msgRow = document.createElement('div');
            msgRow.className = 'msg-row user';
            msgRow.innerHTML = `<div class="user-msg">${messageToSend}</div>`;
            const container = document.getElementById('humanChatContent');
            if (container) container.appendChild(msgRow);
            const log = document.getElementById('humanLog');
            if (log) log.scrollTop = log.scrollHeight;
            lastHumanChatCount++; // optimistic update
            updateSendState();

            if (!window.__humanAssignedOnce) {
                window.__humanAssignedOnce = true;
                const startAt = Date.now();
                const searchRow = addHumanSystemMessage(isMarketingChannel()
                    ? 'Buscando estratega de marketing... 0s'
                    : 'Buscando ingeniero disponible... 0s');
                const searchEl = searchRow ? searchRow.querySelector('.ai-msg') : null;
                if (window.__humanSearchTimer) clearInterval(window.__humanSearchTimer);
                window.__humanSearchTimer = setInterval(() => {
                    const elapsed = Math.max(0, Math.floor((Date.now() - startAt) / 1000));
                    if (searchEl) searchEl.textContent = isMarketingChannel()
                        ? `Buscando estratega de marketing... ${elapsed}s`
                        : `Buscando ingeniero disponible... ${elapsed}s`;
                }, 1000);
                setTimeout(() => {
                    addHumanSystemMessage(isMarketingChannel()
                        ? 'Asignando estratega y revisando tu brief...'
                        : 'Asignando ingeniero y revisando tu solicitud...');
                }, 2600);
                setTimeout(() => {
                    if (window.__humanSearchTimer) clearInterval(window.__humanSearchTimer);
                    const total = Math.max(0, Math.floor((Date.now() - startAt) / 1000));
                    if (searchEl) searchEl.textContent = isMarketingChannel()
                        ? `Estratega encontrado en ${total}s.`
                        : `Ingeniero encontrado en ${total}s.`;
                    addHumanSystemMessage(isMarketingChannel()
                        ? '✅ Equipo de marketing conectado y listo para ayudarte.'
                        : '✅ William está conectado y listo para ayudarte.');
                }, 5200);
            }

            try {
                const response = await fetch('/api/human-chat/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                    project_name: getActiveProjectKey(),
                    role: 'client',
                    content: messageToSend,
                    actor: currentUser.name || 'Cliente',
                        client_email: currentUser.email || ''
                    })
                });
                if (response.status === 402) {
                    const modal = document.getElementById('pricing-modal');
                    if (modal) modal.style.display = 'flex';
                    addHumanSystemMessage('🔒 Activa un plan para continuar con el chat.');
                    return;
                }
                pollHumanChat();
            } catch (e) { console.error(e); }
            return;
        }
        // --- END HUMAN CHAT FLOW ---

        if (isMarketingChannel()) {
            const imageToSend = pendingImageDataUrl;
            const imageNameToSend = pendingImageName;
            const messageToSend = text || 'Necesito ayuda con marketing de este producto.';
            const userBubbleText = imageToSend
                ? `${messageToSend}\n\n[Imagen adjunta: ${imageNameToSend || 'archivo'}]`
                : messageToSend;
            clearPendingAttachment();
            setLoading(true);
            addUserMessage(userBubbleText);
            chatInput.value = '';
            resizeChatInput();
            updateSendState();
            await handleMarketingChat(messageToSend, imageToSend);
            setLoading(false);
            return;
        }

        const imageToSend = pendingImageDataUrl;
        const imageNameToSend = pendingImageName;
        const messageToSend = text || 'Analiza la imagen adjunta y ayúdame a construir esto.';
        const userBubbleText = imageToSend
            ? `${messageToSend}\n\n[Imagen adjunta: ${imageNameToSend || 'archivo'}]`
            : messageToSend;
        clearPendingAttachment();

        setLoading(true);
        addUserMessage(userBubbleText);
        chatInput.value = '';
        resizeChatInput();
        updateSendState();

        try {
            if (interactionMode === 'edit') {
                await handleEditProject(messageToSend, imageToSend);
                return;
            }

            // Case 1: Initial Idea & Analysis Loop
            // UPDATED: Include 'conversing' and 'awaiting_approval' so messages route to handleIdeaAnalysis
            if (chatStage === 'initial' || chatStage === 'analyzing' || chatStage === 'conversing' || chatStage === 'awaiting_approval') {
                await handleIdeaAnalysis(messageToSend, imageToSend);
                return;
            }

            // Case 2: Blueprint Generation (Legacy/Fallback)
            if (chatStage === 'refinement') {
                const combinedContext = `Core Idea: ${originalIdea}. \nRefinements: ${messageToSend}`;
                originalIdea = combinedContext;
                await handleBlueprintGeneration(combinedContext);
                return;
            }

            // Case 3: BUILD EXECUTION (Here is where we insert the simulation)
            if (chatStage === 'blueprint') {
                if (messageToSend.toLowerCase().includes('si') || messageToSend.toLowerCase().includes('yes') || messageToSend.toLowerCase().includes('build')) {
                    chatStage = 'building';

                    // TRIGGER THE TEAM SIMULATION
                    await simulateTeamExecution();

                    // REAL BACKEND CALL
                    await handleGeneratePlan(originalIdea);

                } else {
                    addLog("Escribe 'Si' o usa el botón para confirmar la construcción.", 'warning');
            }
            return;
        }

            // Case 4: Editing
            if (interactionMode === 'edit' && chatStage === 'construction_mode' && currentProjectName) {
                await handleEditProject(messageToSend, imageToSend);
                return;
            }

            // Default to strategic conversation if no explicit construction/edit phase is active.
            await handleIdeaAnalysis(messageToSend, imageToSend);
            return;

        } catch (e) {
            addLog(`Error: ${e.message}`, 'error');
            chatStage = 'initial';
        } finally {
            setLoading(false);
        }
    });

    // Chat stays open until the ticket submission step. No paywall on focus.

    // --- Logic: Generate Blueprint ---
    async function handleBlueprintGeneration(fullContext) {
        showThinking("Arquitectando solución...");
        await new Promise(r => setTimeout(r, 2000));

        try {
            const response = await fetch('/create-blueprint', {
                method: 'POST', body: JSON.stringify({ idea: fullContext }),
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await response.json();

            stopThinking();
            chatStage = 'blueprint';

            // Show Blueprint + Action Button (Clean Layout)
            const bpHtml = `
                <div style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); padding:1rem; font-family:'JetBrains Mono', monospace; font-size:0.8rem; color:#ccc; max-height:300px; overflow-y:auto; border-radius:6px; margin-bottom:10px;">
                    ${data.blueprint.replace(/\n/g, '<br>')}
                </div>
                <div>¿Aprobamos esta arquitectura?</div>
            `;
            addSystemMessage(bpHtml);

            // Show the Build Button Container
            resultSection.style.display = 'block';

            // Bind the Build Button inside resultSection
            if (buildBtn) {
                buildBtn.onclick = async () => {
                    buildBtn.disabled = true;
                    buildBtn.innerHTML = '<i class="fas fa-cog fa-spin"></i> Construyendo...';
                    chatStage = 'building';

                    try {
                        await handleGeneratePlan(originalIdea);

                        buildBtn.innerHTML = '<i class="fas fa-check-circle"></i> Construcción Completa';
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
                    <div style="color:#fff;">Esperando Ejecución de Blueprint...</div>
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
        if (loadDiv) loadDiv.remove();
        loadDiv = document.createElement('div');
        loadDiv.className = 'msg-row ai';
        loadDiv.innerHTML = `<div class="ai-msg" style="opacity:0.7;"><i class="fas fa-circle-notch fa-spin"></i> ${text}</div>`;
        terminalContent.insertBefore(loadDiv, resultSection);
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

    function buildMemorySnapshot() {
        // Extract a lightweight summary from user messages for continuity.
        const userMsgs = conversationHistory.filter(m => m.role === 'user').map(m => m.content || '');
        const joined = userMsgs.join('\n').toLowerCase();
        const summary = userMsgs.find(msg => msg && msg.length > 20) || userMsgs[userMsgs.length - 1] || '';
        const audience = userMsgs.find(msg => /usuarios?|clientes?|audiencia|target|persona/i.test(msg)) || '';
        const business_model = userMsgs.find(msg => /suscrip|comisi|freemium|pago|fee|fit|por video|por evento|monet/i.test(msg)) || '';
        const timeline = userMsgs.find(msg => /semana|mes|deadline|fecha|hoy|24h|48h/i.test(msg)) || '';

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
            const res = await fetch(`/api/chat-memory?email=${encodeURIComponent(currentUser.email)}&project_name=${encodeURIComponent(getActiveProjectKey())}`);
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
                intro.innerHTML = `
                    <div class="ai-msg">
                        > Proyecto cargado: ${escapeHtml(currentProjectName)}<br><br>
                        ${memory.summary ? `Retomando contexto: ${escapeHtml(memory.summary)}` : (isMarketingChannel() ? 'No hay conversación previa de marketing. Describe tu objetivo y empezamos.' : 'No hay conversación previa en este proyecto. Describe tu idea y empezamos.')}
                    </div>
                `;
                terminalContent.insertBefore(intro, resultSection);
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
            'empecemos de cero', 'empezar de cero', 'empezamos de cero', 'desde cero',
            'reset', 'reinicia', 'reiniciar', 'borrar contexto', 'borra contexto',
            'olvida todo', 'nuevo proyecto', 'start over', 'from scratch'
        ];
        return phrases.some(p => t.includes(p));
    }

    function resetChatView() {
        const messages = terminalContent.querySelectorAll('.msg-row');
        messages.forEach((node) => {
            if (!resultSection.contains(node)) node.remove();
        });
        const intro = document.createElement('div');
        intro.className = 'msg-row ai';
        intro.innerHTML = `
            <div class="ai-msg">
                > Contexto reiniciado correctamente.<br><br>
                ${isMarketingChannel()
                    ? 'Empecemos de cero. Define el objetivo de marketing y lo estructuramos juntos.'
                    : 'Empecemos de cero. Describe tu nueva idea y la estructuramos juntos.'}
            </div>
        `;
        terminalContent.insertBefore(intro, resultSection);
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
                    body: JSON.stringify({
                        user_email: currentUser.email,
                        email: currentUser.email,
                        project_name: getActiveProjectKey()
                    })
                });
                await resetContext();
            } catch (e) {
                addLog("No se pudo reiniciar el contexto.", "error");
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
                    body: JSON.stringify({
                        user_email: currentUser.email,
                        email: currentUser.email,
                        project_name: currentProjectName
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
            showThinking("Consultando Núcleo Supra...");

            try {
                const res = await fetch('/analyze-idea', {
                    method: 'POST', body: JSON.stringify({ idea: userInput, image_data_url: imageDataUrl, engine: selectedEngine, user_email: currentUser.email, project_name: currentProjectName }),
                    headers: { 'Content-Type': 'application/json' }
                });
                const data = await res.json();
                if (!res.ok) {
                    if (res.status === 402 && (data.code === 'subscription_required_after_preview' || data.requires_subscription)) {
                        openSubscriptionModal(data.error || 'Debes suscribirte para continuar después de la previsualización.');
                        return;
                    }
                    if (res.status === 402) {
                        addLog(`⛔ ${data.error || 'Créditos insuficientes.'}`, 'error');
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
                // NEW: Go to conversation mode first
                chatStage = 'conversing';
                updatePhase("PASO 1.5: DEFINICIÓN ESTRATÉGICA");
                queueMemorySave();

            } catch (e) {
                stopThinking();
                addLog("Error: " + e.message, "error");
            }
        }
        else if (chatStage === 'conversing') {
            // Normal Conversation (Robust)
            showThinking("Escribiendo...");

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 35000);

            try {
                const res = await fetch('/api/continue-chat', {
                    method: 'POST',
                    body: JSON.stringify({
                        history: conversationHistory,
                        message: userInput,
                        image_data_url: imageDataUrl,
                        engine: selectedEngine,
                        user_email: currentUser.email,
                        project_name: currentProjectName
                    }),
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                const data = await res.json();
                if (!res.ok) {
                    if (res.status === 402 && (data.code === 'subscription_required_after_preview' || data.requires_subscription)) {
                        openSubscriptionModal(data.error || 'Debes suscribirte para continuar después de la previsualización.');
                        return;
                    }
                    if (res.status === 402) {
                        addLog(`⛔ ${data.error || 'Créditos insuficientes.'}`, 'error');
                        checkUserCredits();
                        return;
                    }
                    throw new Error(data.error || `Status ${res.status}`);
                }
                stopThinking();

                const reply = data.ai_reply || "Hubo un error al procesar tu respuesta.";
                addSystemMessage(reply);
                renderBriefState({
                    brief_score: data.brief_score,
                    missing_fields: data.missing_fields || [],
                    memory_summary: data.memory_summary || ''
                });
                conversationHistory.push({ role: "ai", content: reply });
                queueMemorySave();

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
                const msg = e.name === 'AbortError' ? "El servidor tardó demasiado." : "Error de conexión (" + e.message + ").";
                addLog(msg, "error");
                addSystemMessage(`<span style="color:#ef4444; font-size:0.9rem;">⚠️ ${msg} Intenta enviar tu mensaje de nuevo.</span>`);
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
                <h3 style="color:#fff; margin-top:0;">🚀 Propuesta Lista para Ingeniería</h3>
                <p style="color:#ccc; font-size:0.9rem;">He estructurado el plan técnico. ¿Enviamos esto al equipo de desarrollo?</p>
                <button id="sendTicketBtn" style="background:#3b82f6; color:#fff; border:none; padding:12px 24px; border-radius:6px; font-weight:bold; cursor:pointer; margin-top:10px; width:100%; transition:0.3s;">
                    <i class="fas fa-paper-plane"></i> Confirmar y Enviar a Ingeniería
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
                if (btn) { btn.disabled = false; btn.innerHTML = 'Confirmar y Enviar a Ingeniería'; }
                return;
            }
            const res = await fetch('/api/create-ticket', {
                method: 'POST', body: JSON.stringify({ history: conversationHistory, user_email: currentUser.email, project_name: currentProjectName }),
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await res.json();

            stopThinking();

            if (data.requires_subscription) {
                const modal = document.getElementById('pricing-modal');
                if (modal) modal.style.display = 'flex';
                localStorage.setItem('pending_ticket_project', currentProjectName || '');
                setChatLocked(true, "🔒 Tu proyecto está listo. Elige un plan para enviarlo a nuestro equipo.");
                if (btn) { btn.disabled = false; btn.innerHTML = 'Confirmar y Enviar a Ingeniería'; }
                stopThinking();
                return;
            }
            if (data.error) throw new Error(data.error);

            // Update Chat UI
            chatStage = 'construction_mode';
            setInteractionMode('edit');
            setTimelineVisible(true);
            updatePhase("PASO 3: CONSTRUCCIÓN (EN PROGRESO)");
            currentTicketProjectId = data.project_id || '';
            lastStatus = '';
            lastDeployedUrl = '';
            renderBriefState({ brief_score: 100, missing_fields: [], memory_summary: (briefSummaryText?.textContent || '') });
            queueMemorySave();

            addSystemMessage(`
                <div style="background:rgba(16, 185, 129, 0.1); border:1px solid #10b981; padding:15px; border-radius:8px;">
                    <h3 style="color:#10b981; margin:0;">✅ Ticket #${data.project_id} Creado</h3>
                    <p style="color:#ddd; font-size:0.9rem;">El equipo ha recibido la solicitud.</p>
                    <div class="progress-container" style="background:#333; height:6px; border-radius:3px; margin-top:10px;">
                        <div id="projectProgressBar" style="width:10%; height:100%; background:#10b981; border-radius:3px; transition:width 0.5s;"></div>
                    </div>
                    <div id="projectStatusText" style="color:#aaa; font-size:0.8rem; margin-top:5px;">Estado: Recibido</div>
                </div>
            `);

            showReviewOverlay('Solicitud recibida', 'Nuestro equipo está revisando tu proyecto para iniciar ejecución.', 18);

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
                const res = await fetch(statusUrl);
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
                        addLog(`📢 Actualización: ${status.message}`, 'info');
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
                                    Tu visión ha sido materializada por el equipo de Anmar.<br>
                                    <strong>Revisa la previsualización ahora en el panel derecho.</strong>
                                </p>
                                <button onclick="window.open('${deployedUrl}', '_blank')" style="background:#10b981; color:#000; border:none; padding:10px 20px; border-radius:6px; font-weight:bold; cursor:pointer; margin-top:15px; transition:0.2s;">
                                    <i class="fas fa-external-link-alt"></i> Abrir en Nueva Pestaña
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
                    showReviewOverlay('Orden aceptada', 'Un especialista tomó tu proyecto y preparó el entorno de trabajo.', 25);
                } else if (status.status === 'pending') {
                    if (!deployedUrl) ensureBlankPreview();
                    showReviewOverlay('En cola interna', 'Tu solicitud está en revisión inicial por nuestro equipo.', status.progress || 15);
                } else if (status.status === 'developing') {
                    if (!deployedUrl) ensureBlankPreview();
                    showReviewOverlay('Construcción en curso', 'Nuestro equipo está implementando cambios en tiempo real.', status.progress || 60);
                } else if (status.status === 'blocked') {
                    if (!deployedUrl) ensureBlankPreview();
                    showReviewOverlay('Bloqueado temporalmente', 'Hay una dependencia pendiente. Tu equipo ya está trabajando para resolverla.', status.progress || 45);
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
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            sendBtn.click();
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
        addLog(`Iniciando secuencia de construcción...`, 'info');

        const response = await fetch('/generate-plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
        showReviewOverlay('Construcción inicial', 'Nuestro equipo está creando tu primera previsualización.', 35);
        showThinking("Escribiendo código backend (Flask)...");
        const theme = 'Modern Startup';

        // Simulate steps
        await new Promise(r => setTimeout(r, 1000));
        showThinking("Diseñando interfaz (Tailwind)...");

        const response = await fetch('/create-project', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
            throw new Error("Pago requerido para continuar.");
        }

        if (data.error) throw new Error(data.error);

        // Success - Refresh Tokens
        checkUserCredits();

        addLog(`Despliegue Exitoso. Accediendo a instancia viva...`, 'success');
        logBuildReport(data);
        currentTicketProjectId = currentTicketProjectId || currentProjectName;
        lastDeployedUrl = '';
        ensureBlankPreview();
        showReviewOverlay('En revisión interna', 'Tu solicitud fue enviada. Verás la preview aquí cuando el equipo interno la publique.', 18);
        startPolling();
    }

    // --- Logic: Edit Project ---
    // --- Logic: Edit Project & Hybrid Ticket ---
    async function handleEditProject(instruction, imageDataUrl = '') {
        showReviewOverlay('Solicitud en revisión', 'Nuestro equipo está evaluando los cambios solicitados.', 42);
        showThinking(`IA intentando aplicar: "${instruction}"...`);

        try {
            const response = await fetch('/edit-project', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
                    openSubscriptionModal(data.error || 'Debes suscribirte para continuar después de la previsualización.');
                    return;
                }
                if (response.status === 402) {
                    addLog(`⛔ ${data.error || 'Créditos insuficientes para editar.'}`, 'error');
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
                addLog(`Motor usado en edición: ${label}`, 'info');
            }
            loadProjectPreview(currentProjectName);
            addLog(`Cambio aplicado por IA en: ${(data.changed_files || []).join(', ') || 'archivo principal'}.`, 'success');
            logBuildReport(data);
            if (typeof data.remaining_tokens === 'number') {
                checkUserCredits();
            }
            conversationHistory.push({ role: "user", content: instruction });
            conversationHistory.push({ role: "ai", content: data.summary || "Cambio aplicado en el proyecto." });
            queueMemorySave();

        } catch (e) {
            addLog(`La IA tuvo problemas: ${e.message}`, 'warning');
            await addSystemMessage("No pude aplicar ese cambio de forma segura. Reformúlalo con más detalle (archivo, sección y resultado esperado).");
        }

        stopThinking();

        const wantsHumanSupport = /(soporte humano|equipo humano|maria|ticket|escalar|revisión humana|human support)/i.test(instruction || "");
        if (wantsHumanSupport) {
            showReviewOverlay('Escalado a equipo interno', 'Tu solicitud fue enviada a revisión humana especializada.', 55);
            addLog("Solicitando soporte humano premium...", "system");
            submitTicketInBackground(instruction);
        }
    }

    async function submitTicketInBackground(request) {
        try {
            const res = await fetch('/api/submit-ticket', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_email: currentUser.email,
                    project_name: currentProjectName,
                    request: request
                })
            });
            const data = await res.json();
            if (!res.ok) {
                if (res.status === 402) {
                    addLog(`⛔ ${data.error || 'Créditos insuficientes para soporte humano.'}`, 'warning');
                    checkUserCredits();
                    return;
                }
                throw new Error(data.error || `Status ${res.status}`);
            }
            if (data.ticket_id) {
                addLog(`Ticket #${data.ticket_id} escalado al equipo experto (${data.assigned_to}) para revisión de calidad.`, 'system');
            }
        } catch (e) {
            console.error("Ticket fallback error", e);
            addLog(`No se pudo escalar a soporte humano: ${e.message}`, 'warning');
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

    function showReviewOverlay(stateLabel = 'En revisión', detail = 'Nuestro equipo está trabajando en tu proyecto.', progress = 35) {
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
            setPreviewOverlay('No se pudo cargar la previsualización. Verifica que el proyecto exista y vuelve a intentar.', 'fa-triangle-exclamation');
        });
    }

    function loadProjectPreview(name) {
        if (!name) {
            setPreviewOverlay('Selecciona un proyecto para ver su previsualización.', 'fa-folder-open');
            return;
        }
        if (currentTicketProjectId && !lastDeployedUrl && (chatStage === 'construction_mode' || chatStage === 'building')) {
            ensureBlankPreview();
            showReviewOverlay('En revisión interna', 'Nuestro equipo está trabajando en tu proyecto y pronto enviará la previsualización.', 20);
            return;
        }
        setPreviewOverlay(`Cargando previsualización de ${name}...`, 'fa-spinner');
        const url = `/projects/${name}/index.html?v=${Date.now()}`; // cache-bust
        previewLockedByReview = false;
        livePreviewFrame.src = url;

        // Update URL bar visual
        const urlBar = document.querySelector('.url-bar');
        if (urlBar) urlBar.textContent = `anmar.app/projects/${name}`;

        livePreviewFrame.style.display = 'block';
        if (previewLoadTimer) clearTimeout(previewLoadTimer);
        previewLoadTimer = setTimeout(() => {
            setPreviewOverlay(`No llegó respuesta de preview para "${name}". Revisa que el backend esté activo en :5001.`, 'fa-plug-circle-xmark');
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
                addLog('Solo se permiten imágenes.', 'warning');
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
                addLog(`No se pudo cargar la imagen: ${err.message}`, 'error');
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
        sendBtn.disabled = bool;
        chatInput.disabled = bool;
        if (chatTypingIndicator) {
            chatTypingIndicator.classList.toggle('active', bool);
        }
        if (bool) {
            sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        } else {
            sendBtn.innerHTML = '<i class="fas fa-arrow-up"></i>';
            chatInput.focus();
        }
        updateSendState();
    }

    // --- Project Management ---
    window.toggleProjectList = async function () {
        const el = document.getElementById('projectsModal');
        el.style.display = el.style.display === 'none' ? 'block' : 'none';
        if (el.style.display === 'block') loadProjects();
    }

    window.createNewProject = async function () {
        const projectName = prompt("Nombre del nuevo proyecto:");
        if (!projectName || !projectName.trim()) return;
        await createProjectByName(projectName.trim());
    }

    async function createProjectByName(name, options = {}) {
        const showAlert = options.showAlert !== false;
        const onError = typeof options.onError === 'function' ? options.onError : null;
        const phone = (options.phone || '').trim();
        try {
            const res = await fetch('/api/create-empty-project', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ project_name: name, user_email: currentUser?.email || '', phone })
            });
            const data = await res.json();
            if (!res.ok) {
                const msg = data.error || 'No se pudo crear el proyecto.';
                if (showAlert) alert(msg);
                if (onError) onError(msg);
                return false;
            }
            currentProjectName = data.project_name;
            currentTicketProjectId = data.project_id || '';
            chatStage = 'initial';
            markWelcomeDone();
            setWelcomeVisible(false);

            // Reset and trigger human chat polling 
            lastHumanChatCount = 0;
            if (humanChatInterval) clearInterval(humanChatInterval);
            humanChatInterval = setInterval(pollHumanChat, 3000);
            persistCurrentProject();
            setInteractionMode('strategy');
            conversationHistory = [];
            originalIdea = '';
            currentMarketingBrief = null;
            currentMarketingAssets = [];
            latestMissingFields = getRequiredFields().slice();
            latestBriefScore = 0;
            setTimelineVisible(false);
            clearChatMessages();
            renderBriefState({ missing_fields: latestMissingFields, memory_summary: '' });
            await loadChatMemory();
            loadProjectPreview(currentProjectName);
            addLog(`Proyecto creado: ${currentProjectName}. Inicia la conversación estratégica en el chat.`, 'system');
            await loadProjects();
            switchTab('build');
            updatePaywallBanner();
            return true;
        } catch (e) {
            console.error(e);
            const msg = 'Error de conexión creando proyecto.';
            if (showAlert) alert(msg);
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
        const ok = confirm("¿Eliminar TODOS los proyectos? Esta acción no se puede deshacer.");
        if (!ok) return;

        try {
            const res = await fetch('/api/delete-all-projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al borrar proyectos');

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
            addLog(`Se eliminaron ${data.deleted || 0} proyectos.`, 'warning');
            await loadProjects();
        } catch (e) {
            console.error(e);
            alert('No se pudieron eliminar todos los proyectos.');
        }
    }

    const projectList = document.getElementById('projectList');

    async function loadProjects() {
        try {
            const emailQuery = currentUser?.email ? `?email=${encodeURIComponent(currentUser.email)}` : '';
            const response = await fetch(`/list-projects${emailQuery}`); // FIXED PORT
            const projects = await response.json();
            let projectMeta = {};
            try {
                const metaRes = await fetch(`/api/projects-meta${emailQuery}`);
                projectMeta = await metaRes.json();
            } catch (e) {
                projectMeta = {};
            }

            projectList.innerHTML = '';
            if (projectsFolderGrid) projectsFolderGrid.innerHTML = '';
            const limitHint = document.getElementById('projectLimitHint');
            projectLimitReached = false;

            if (projects.length === 0) {
                if (forceWelcome) {
                    setWelcomeVisible(true);
                } else {
                    setWelcomeVisible(false);
                }
                projectList.innerHTML = '<li style="padding:0.5rem">No projects found.</li>';
                if (projectsFolderGrid) {
                    projectsFolderGrid.innerHTML = `
                        <div style="padding:20px; border:1px dashed rgba(255,255,255,0.2); border-radius:10px; color:rgba(255,255,255,0.7);">
                            Aun no hay proyectos generados. Presiona "Nuevo Proyecto" para empezar.
                        </div>
                    `;
                }
                if (limitHint) limitHint.style.display = 'none';
                return;
            }
            if (projects.length > 0) {
                forceWelcome = false;
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
                nameSpan.innerHTML = `<i class="fas fa-folder" style="margin-right:8px; color:#3b82f6;"></i> ${project} ${phoneLabel ? `<span style="margin-left:8px; font-size:0.75rem; opacity:0.7;">${phoneLabel}</span>` : ''}`;
                nameSpan.style.flexGrow = '1';
                nameSpan.onclick = async () => {
                    currentProjectName = project;

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

                    document.getElementById('projectsModal').style.display = 'none';
                    addLog(`Proyecto cargado: ${project}`, 'info');
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
                    if (confirm(`¿Estás seguro de ELIMINAR "${project}"? Esta acción es irreversible.`)) {
                        try {
                            const res = await fetch('/delete-project', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ project_name: project, user_email: currentUser?.email || '' })
                            });
                            if (res.ok) {
                                li.remove();
                                addLog(`Proyecto eliminado: ${project}`, 'warning');
                                if (currentProjectName === project) {
                                    document.getElementById('livePreviewFrame').src = 'about:blank';
                                    currentProjectName = '';
                                    persistCurrentProject();
                                }
                            } else {
                                alert('Error al eliminar');
                            }
                        } catch (err) {
                            console.error(err);
                            alert('Error de conexión');
                        }
                    }
                };

                li.appendChild(nameSpan);
                li.appendChild(deleteBtn);
                projectList.appendChild(li);

                if (projectsFolderGrid) {
                    const card = document.createElement('div');
                    card.style.cssText = 'position:relative; text-align:left; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); padding:16px; border-radius:12px; color:#fff; cursor:pointer; min-height:120px; transition:all 0.2s; overflow:hidden;';
                    card.innerHTML = `
                        <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px; min-width:0;">
                            <i class="fas fa-folder-open" style="color:#3b82f6;"></i>
                            <strong title="${escapeHtml(project)}" style="font-size:0.95rem; display:block; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                                ${escapeHtml(project)}
                            </strong>
                        </div>
                        <div style="opacity:0.65; font-size:0.8rem; overflow-wrap:anywhere;">${phoneLabel || 'Sin teléfono registrado'} · Abrir previsualización y continuar ajustes.</div>
                    `;
                    card.onmouseenter = () => {
                        card.style.transform = 'translateY(-1px)';
                        card.style.borderColor = 'rgba(59,130,246,0.5)';
                    };
                    card.onmouseleave = () => {
                        card.style.transform = 'none';
                        card.style.borderColor = 'rgba(255,255,255,0.1)';
                    };
                    card.onclick = async () => {
                        currentProjectName = project;
                        persistCurrentProject();
                        setInteractionMode('strategy');
                        await loadChatMemory();
                        loadProjectPreview(project);
                        switchTab('build');
                        addLog(`Proyecto cargado: ${project}. Puedes continuar briefing o enviar ajustes de construcción.`, 'info');
                    };

                    const deleteCardBtn = document.createElement('button');
                    deleteCardBtn.type = 'button';
                    deleteCardBtn.title = `Eliminar ${project}`;
                    deleteCardBtn.innerHTML = '<i class="fas fa-trash"></i>';
                    deleteCardBtn.style.cssText = 'position:absolute; top:8px; right:8px; width:28px; height:28px; border-radius:8px; border:1px solid rgba(239,68,68,0.45); background:rgba(239,68,68,0.18); color:#fecaca; cursor:pointer; z-index:2;';
                    deleteCardBtn.onclick = async (e) => {
                        e.stopPropagation();
                        const okDelete = confirm(`¿Eliminar el proyecto "${project}"? Esta acción no se puede deshacer.`);
                        if (!okDelete) return;
                        try {
                            const res = await fetch('/delete-project', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
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
                            addLog(`Proyecto eliminado: ${project}`, 'warning');
                            await loadProjects();
                        } catch (err) {
                            addLog(`No se pudo eliminar ${project}: ${err.message}`, 'error');
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
    // --- UI MODE SWITCHER ---
    // --- TAB SWITCHER ---
    // --- TAB SWITCHER ---
    window.switchTab = function (tab) {
        // 1. Top Tabs
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        const btn = document.getElementById(`tab-${tab}`);
        if (btn) btn.classList.add('active');

        // 2. Sidebar Icons
        document.querySelectorAll('.nav-icon').forEach(icon => icon.classList.remove('active'));
        const navIcon = document.getElementById(`nav-${tab}`);
        if (navIcon) navIcon.classList.add('active');

        // 3. Sections
        document.querySelectorAll('.section-view').forEach(sec => sec.classList.remove('active'));
        const sectionId = tab === 'market' ? 'section-build' : `section-${tab}`;
        const sec = document.getElementById(sectionId);
        if (sec) sec.classList.add('active');

        // Feedback
        if (tab === 'build') {
            setActiveChannel('build');
            addLog("Módulo de Ingeniería Activo.", "system");
            if (currentProjectName) loadChatMemory();
        }
        if (tab === 'market') {
            setActiveChannel('marketing');
            addLog("Módulo de Marketing Activo.", "system");
            if (currentProjectName) loadChatMemory();
        }
        if (tab === 'growth') addLog("Módulo de Financiación Activo.", "system");
        if (tab === 'projects') {
            addLog("Módulo de Proyectos Activo.", "system");
            loadProjects();
        }
        if (tab === 'profile') addLog("Módulo de Perfil Activo.", "system");
    }

    // Session restore: reopen last project and chat memory when possible.
    setInteractionMode('strategy');
    setTimelineVisible(false);
    (async () => {
        if (forceWelcome) {
            setWelcomeVisible(true);
            switchTab('projects');
            return;
        }
        const lastProject = localStorage.getItem(getLastProjectStorageKey()) || '';
        if (!lastProject) {
            try {
                const emailQuery = currentUser?.email ? `?email=${encodeURIComponent(currentUser.email)}` : '';
                const response = await fetch(`/list-projects${emailQuery}`);
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
                    addLog(`Proyecto restaurado: ${currentProjectName}`, 'system');
                    return;
                }
            } catch (e) { }
            switchTab('projects');
            return;
        }
        try {
            const emailQuery = currentUser?.email ? `?email=${encodeURIComponent(currentUser.email)}` : '';
            const response = await fetch(`/list-projects${emailQuery}`);
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
                addLog(`Proyecto restaurado: ${lastProject}`, 'system');
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

        const goal = prompt("🎯 Define el Obejtivo de la Campaña (Ej: 'Ventas flash', 'Viralidad en Gen Z', 'Posicionamiento B2B'):");
        if (!goal) return;

        showThinking("Analizando Mercado con Supra Marketing Core...");

        // Simulation
        await new Promise(r => setTimeout(r, 1500));
        addLog("Analizando audiencia objetivo y competidores...", "system");
        await new Promise(r => setTimeout(r, 2000));
        addLog("Diseñando hooks psicológicos de alta conversión...", "design");
        await new Promise(r => setTimeout(r, 2000));

        try {
            const res = await fetch('/api/generate-marketing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
                        Nuestros directores creativos están listos para rodar, editar y lanzar esta campaña.
                    </div>
                    <button onclick="submitTicketInBackground('Producción Campaña: ${goal}')" style="background:#f59e0b; color:#000; border:none; padding:8px 16px; border-radius:4px; font-weight:bold; cursor:pointer; width:100%;">
                        🎬 Solicitar Producción Humana
                    </button>
                </div>
            </div>
        `;
            addSystemMessage(html);

        } catch (e) {
            stopThinking();
            addLog("Error generando campaña: " + e.message, "error");
        }
    }
    /* --- BUILD FLOW & PREMIUM LOGIC --- */

    window.handleBuildClick = async function () {
        // alert("Activando maquinaria..."); // Debug - Commented out to avoid click fatigue
        try {
            const plan = window.lastGeneratedPlan;
            if (!plan) {
                alert("Error: No hay plano para construir. Intenta generar de nuevo.");
                return;
            }

            // AGENCY Mode Check: If tokens > 1000, bypass check
            const tokensEl = document.getElementById('userTokens');
            const tokenText = tokensEl ? tokensEl.innerText : "";
            const isAgency = tokenText.includes("∞") || localStorage.getItem('anmar_premium') === 'true';

            if (isAgency || true) { // Force true for now as user has credits
                if (typeof window.startBuildProcess !== 'function') {
                    alert("CRITICAL ERROR: startBuildProcess is not loaded. Please refresh.");
                    return;
                }

                try {
                    await window.startBuildProcess(plan);
                } catch (buildErr) {
                    alert("Error ejecutando build: " + buildErr.message);
                    console.error(buildErr);
                }
            } else {
                // ... legacy modal logic
            }
        } catch (e) {
            alert("Handler Error: " + e.message);
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
        updatePhase("PASO 3: CONSTRUCCIÓN Y DESPLIEGUE");
        setTimelineVisible(true);

        // 2. Start Timeline Animation sequence
        // Step 0: Network
        updateTimeline(0);
        addLog("[ANMAR // CORE] Iniciando secuencia de construcción...", "system");

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
                body: JSON.stringify({
                    project_name: (plan.project_name || "project_" + Date.now()).toLowerCase().replace(/\s+/g, '_'),
                    plan: JSON.stringify(plan),
                    theme: plan.style,
                    user_email: localStorage.getItem('user_email') || 'guest@anmar.ai'
                })
            });
            const data = await res.json();

            if (data.error) throw new Error(data.error);

            stopThinking();
            logBuildReport(data);

            // 4. Success & Step 3: Ready
            setTimeout(() => {
                updateTimeline(3); // Listo
                addLog("[ANMAR // DEPLOY] Despliegue Exitoso en preview.anmar.ai", "success");

                // Show "Success Card" in chat
                const successHtml = `
                <div style="background:rgba(16, 185, 129, 0.1); border:1px solid #10b981; padding:15px; border-radius:8px; margin-top:10px;">
                    <h3 style="color:#10b981; margin:0 0 10px 0;">🚀 Proyecto Desplegado</h3>
                    <p style="color:#ddd; font-size:0.9rem; margin-bottom:10px;">
                        Tu proyecto <strong>${plan.human_readable_name}</strong> está vivo.
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

    window.updateTimeline = function (stepIndex) {
        const bubbles = document.querySelectorAll('.step-bubble');

        bubbles.forEach((b, idx) => {
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

    /* --- TOKEN RECHARGE LOGIC --- */
    document.addEventListener('DOMContentLoaded', () => {
        // Retry finding badge if not immediately available
        setTimeout(() => {
            const tokensBadge = document.getElementById('userTokens');
            if (tokensBadge) {
                tokensBadge.style.cursor = 'pointer';
                tokensBadge.setAttribute('title', 'Clic para ver planes');
                tokensBadge.onclick = () => {
                    const modal = document.getElementById('pricing-modal');
                    if (modal) modal.style.display = 'flex';
                };
            }
        }, 1000);
    });

    window.purchasePlan = async function (planId) {
        const btn = event?.target?.closest('button');
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
                body: JSON.stringify({ email: currentUser.email, plan: planId })
            });

            const data = await res.json();

            if (data.url) {
                window.location.href = data.url;
                return;
            }
            throw new Error(data.error || "No se pudo iniciar el pago.");
        } catch (e) {
            console.error(e);
            if (btn) {
                btn.innerHTML = '<i class="fas fa-times"></i> Error';
                btn.style.background = '#ef4444';
                setTimeout(() => { btn.innerHTML = originalText; btn.style.background = ''; btn.style.opacity = '1'; }, 2000);
            }
        }
    }
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
            localStorage.removeItem('currentUser');
            window.location.href = 'login.html';
        });
    }

    window.__mainScriptOk = true;
    } catch (e) {
        console.error('Dashboard boot error:', e);
        if (window.__applyDashboardFallback) {
            window.__applyDashboardFallback();
        }
    }
});
