document.addEventListener('DOMContentLoaded', () => {
    // START FOCUS MODE
    document.body.classList.add('zen-mode');

    // DOM Elements
    const chatInput = document.getElementById('businessIdea'); // Dual purpose: Idea or Edit
    const sendBtn = document.getElementById('generateBtn');
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

    // --- Session Management ---
    let currentUser = JSON.parse(localStorage.getItem('currentUser'));

    if (!currentUser) {
        window.location.href = 'login.html'; // Protect Dashboard
        return;
    }

    async function checkUserCredits() {
        if (!userTokensEl) return;
        try {
            const res = await fetch(`http://127.0.0.1:5001/api/user-stats?email=${currentUser.email}`);
            const data = await res.json();
            if (data.tokens !== undefined) {
                userTokensEl.innerHTML = `<i class="fas fa-coins" style="color:#fbbf24; margin-right:5px;"></i> ${data.tokens} Créditos`;
                if (profileCreditsEl) {
                    profileCreditsEl.textContent = `${data.tokens} créditos`;
                }
                if (data.tokens === 0) {
                    userTokensEl.style.color = '#ef4444';
                    addLog("⚠️ Has agotado tus créditos gratuitos. Actualiza a Premium para continuar construyendo.", "system");
                }
            }
        } catch (e) {
            console.error("Auth Error", e);
        }
    }

    // State
    let currentProjectName = '';
    let currentPlanContent = '';
    let currentTicketProjectId = '';
    let isProcessing = false;
    let previewLoadTimer = null;
    let pendingMemorySave = null;
    let interactionMode = 'strategy'; // strategy | edit
    let selectedEngine = 'antigravity';
    let latestMissingFields = ['summary', 'audience', 'business_model', 'timeline', 'features'];
    let latestBriefScore = 0;
    let pendingImageDataUrl = '';
    let pendingImageName = '';
    let speechRecognition = null;
    let isVoiceRecording = false;
    let reviewOverlayTimer = null;
    let previewLockedByReview = false;

    // Conversation State
    let chatStage = 'initial'; // 'initial', 'refinement', 'ready', 'blueprint', 'building'
    let originalIdea = '';

    // Run on Load
    checkUserCredits();
    hydrateProfile();
    renderBriefState();

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
    }

    function renderBriefState(meta = {}) {
        if (Array.isArray(meta.missing_fields)) {
            latestMissingFields = meta.missing_fields.slice();
        }
        if (typeof meta.brief_score === 'number') {
            latestBriefScore = Math.max(0, Math.min(100, meta.brief_score));
        } else {
            latestBriefScore = Math.max(0, Math.min(100, Math.round(((5 - latestMissingFields.length) / 5) * 100)));
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
            const canShow = latestBriefScore >= 80 && interactionMode === 'strategy' && chatStage !== 'construction_mode';
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
        const instruction = prompt("Describe qué aspectos deseas que nuestro equipo pula o mejore (ej: 'Mejorar animaciones', 'Integrar pasarela de pagos', 'Optimizar SEO'):");
        if (instruction) {
            handleEditProject(instruction); // Reuses the hybrid ticket logic
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

    // --- Logic: Generate Blueprint ---
    async function handleBlueprintGeneration(fullContext) {
        showThinking("Arquitectando solución...");
        await new Promise(r => setTimeout(r, 2000));

        try {
            const response = await fetch('http://127.0.0.1:5001/create-blueprint', {
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

        return {
            version: 1,
            chat_stage: chatStage,
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
    }

    async function saveMemoryNow() {
        if (!currentUser?.email || !currentProjectName) return;
        try {
            await fetch('http://127.0.0.1:5001/api/chat-memory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: currentUser.email,
                    project_name: currentProjectName,
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
            latestMissingFields = ['summary', 'audience', 'business_model', 'timeline', 'features'];
            latestBriefScore = 0;
            renderBriefState();
            return;
        }
        try {
            const res = await fetch(`http://127.0.0.1:5001/api/chat-memory?email=${encodeURIComponent(currentUser.email)}&project_name=${encodeURIComponent(currentProjectName)}`);
            if (!res.ok) return;
            const data = await res.json();
            const memory = data.memory || {};
            clearChatMessages();
            if (Array.isArray(memory.conversation_history)) {
                conversationHistory = memory.conversation_history.slice(-40);
            }
            if (memory.chat_stage) chatStage = memory.chat_stage;
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
                        ${memory.summary ? `Retomando contexto: ${escapeHtml(memory.summary)}` : 'No hay conversación previa en este proyecto. Describe tu idea y empezamos.'}
                    </div>
                `;
                terminalContent.insertBefore(intro, resultSection);
            }

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
            if (currentTicketProjectId) {
                startPolling();
            }
            persistCurrentProject();
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
                Empecemos de cero. Describe tu nueva idea y la estructuramos juntos.
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
        latestMissingFields = ['summary', 'audience', 'business_model', 'timeline', 'features'];
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
                await fetch('http://127.0.0.1:5001/api/chat-memory/reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        user_email: currentUser.email,
                        email: currentUser.email,
                        project_name: currentProjectName
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
                await fetch('http://127.0.0.1:5001/api/chat-memory/reset', {
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
                const res = await fetch('http://127.0.0.1:5001/analyze-idea', {
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
                const res = await fetch('http://127.0.0.1:5001/api/continue-chat', {
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
            const res = await fetch('http://127.0.0.1:5001/api/create-ticket', {
                method: 'POST', body: JSON.stringify({ history: conversationHistory, user_email: currentUser.email, project_name: currentProjectName }),
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await res.json();

            stopThinking();

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
                    ? `http://127.0.0.1:5001/api/project-status?project_id=${encodeURIComponent(currentTicketProjectId)}`
                    : 'http://127.0.0.1:5001/api/project-status';
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
    // Support Enter key
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendBtn.click();
        }
    });

    // --- Logic: Generate Plan & Build ---
    async function handleGeneratePlan(idea) {
        addLog(`Iniciando secuencia de construcción...`, 'info');

        const response = await fetch('http://127.0.0.1:5001/generate-plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idea: idea })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error);

        currentPlanContent = data.plan;

        // Sanitize project name
        currentProjectName = data.project_name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
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

        const response = await fetch('http://127.0.0.1:5001/create-project', {
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
            const response = await fetch('http://127.0.0.1:5001/edit-project', {
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
            const res = await fetch('http://127.0.0.1:5001/api/submit-ticket', {
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
        const url = `http://127.0.0.1:5001/projects/${name}/index.html?v=${Date.now()}`; // cache-bust
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
            } catch (err) {
                addLog(`No se pudo cargar la imagen: ${err.message}`, 'error');
                clearPendingAttachment();
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
        if (bool) {
            sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        } else {
            sendBtn.innerHTML = '<i class="fas fa-arrow-up"></i>';
            chatInput.focus();
        }
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

        try {
            const res = await fetch('http://127.0.0.1:5001/api/create-empty-project', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ project_name: projectName.trim() })
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || 'No se pudo crear el proyecto.');
                return;
            }
            currentProjectName = data.project_name;
            persistCurrentProject();
            await resetContext(false);
            setInteractionMode('strategy');
            await loadChatMemory();
            loadProjectPreview(currentProjectName);
            addLog(`Proyecto creado: ${currentProjectName}. Inicia la conversación estratégica en el chat.`, 'system');
            await loadProjects();
            switchTab('build');
        } catch (e) {
            console.error(e);
            alert('Error de conexión creando proyecto.');
        }
    }

    window.deleteAllProjects = async function () {
        const ok = confirm("¿Eliminar TODOS los proyectos? Esta acción no se puede deshacer.");
        if (!ok) return;

        try {
            const res = await fetch('http://127.0.0.1:5001/api/delete-all-projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al borrar proyectos');

            currentProjectName = '';
            persistCurrentProject();
            setInteractionMode('strategy');
            latestMissingFields = ['summary', 'audience', 'business_model', 'timeline', 'features'];
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
            const response = await fetch('http://127.0.0.1:5001/list-projects'); // FIXED PORT
            const projects = await response.json();

            projectList.innerHTML = '';
            if (projectsFolderGrid) projectsFolderGrid.innerHTML = '';

            if (projects.length === 0) {
                projectList.innerHTML = '<li style="padding:0.5rem">No projects found.</li>';
                if (projectsFolderGrid) {
                    projectsFolderGrid.innerHTML = `
                        <div style="padding:20px; border:1px dashed rgba(255,255,255,0.2); border-radius:10px; color:rgba(255,255,255,0.7);">
                            Aun no hay proyectos generados. Presiona "Nuevo Proyecto" para empezar.
                        </div>
                    `;
                }
                return;
            }

            projects.forEach(project => {
                const li = document.createElement('li');
                li.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 0.5rem; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.1);';

                // Project Name Clickable Area
                const nameSpan = document.createElement('span');
                nameSpan.innerHTML = `<i class="fas fa-folder" style="margin-right:8px; color:#3b82f6;"></i> ${project}`;
                nameSpan.style.flexGrow = '1';
                nameSpan.onclick = async () => {
                    currentProjectName = project;
                    persistCurrentProject();
                    setInteractionMode('strategy');
                    await loadChatMemory();
                    loadProjectPreview(project); // Ensure loadProjectPreview is accessible or define logic here
                    const previewUrl = `http://127.0.0.1:5001/projects/${project}/index.html?v=${Date.now()}`;
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
                            const res = await fetch('http://127.0.0.1:5001/delete-project', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ project_name: project })
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
                        <div style="opacity:0.65; font-size:0.8rem; overflow-wrap:anywhere;">Abrir previsualizacion y continuar ajustes.</div>
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
                            const res = await fetch('http://127.0.0.1:5001/delete-project', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ project_name: project })
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
        const sec = document.getElementById(`section-${tab}`);
        if (sec) sec.classList.add('active');

        // Feedback
        if (tab === 'build') addLog("Módulo de Ingeniería Activo.", "system");
        if (tab === 'market') addLog("Módulo de Marketing Activo.", "system");
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
        const lastProject = localStorage.getItem(getLastProjectStorageKey()) || '';
        if (!lastProject) {
            switchTab('projects');
            return;
        }
        try {
            const response = await fetch('http://127.0.0.1:5001/list-projects');
            const projects = await response.json();
            if (Array.isArray(projects) && projects.includes(lastProject)) {
                currentProjectName = lastProject;
                persistCurrentProject();
                await loadChatMemory();
                loadProjectPreview(lastProject);
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
            const res = await fetch('http://127.0.0.1:5001/api/generate-marketing', {
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
        // Simulate Payment Processing
        const btn = document.querySelector('#premium-modal button');
        if (btn) {
            // const originalContent = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Procesando...';
            btn.style.opacity = '0.7';
        }

        setTimeout(() => {
            // Success
            localStorage.setItem('anmar_premium', 'true');
            if (btn) {
                btn.innerHTML = '<i class="fas fa-check"></i> ¡Pago Exitoso!';
                btn.style.background = '#10b981';
                btn.style.opacity = '1';
            }

            setTimeout(() => {
                // Hide Modal
                const modal = document.getElementById('premium-modal');
                if (modal) modal.style.display = 'none';

                // Proceed
                if (window.pendingPlan) {
                    startBuildProcess(window.pendingPlan);
                }
            }, 1000);
        }, 1500);
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
            const res = await fetch('http://127.0.0.1:5001/create-project', {
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
                    iframe.src = `http://127.0.0.1:5001/projects/${projectFolder}/index.html?v=${Date.now()}`;
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
                tokensBadge.setAttribute('title', 'Clic para recargar energía');
                tokensBadge.onclick = () => {
                    const modal = document.getElementById('pricing-modal');
                    if (modal) modal.style.display = 'flex';
                };
            }
        }, 1000);
    });

    window.purchasePlan = async function (planId) {
        const btn = event.target.closest('button'); // Ensure we get the button
        const originalText = btn.innerHTML;

        // Simulate Processing
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Procesando...';
        btn.style.opacity = '0.7';
        // await new Promise(r => setTimeout(r, 1500)); 

        try {
            const currentUser = JSON.parse(localStorage.getItem('currentUser'));
            if (!currentUser) { alert("Error de sesión"); return; }

            const res = await fetch('http://127.0.0.1:5001/api/recharge-tokens', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: currentUser.email, plan_id: planId })
            });

            const data = await res.json();

            if (data.status === 'success') {
                btn.innerHTML = '<i class="fas fa-check"></i> ¡Éxito!';
                btn.style.background = '#10b981';
                btn.style.color = '#fff';

                // Update Header Spark
                const tokensBadge = document.getElementById('userTokens');
                if (tokensBadge) {
                    let displayBalance = data.new_balance;
                    if (data.new_balance > 9000) displayBalance = "∞"; // Agency

                    tokensBadge.innerHTML = `<i class="fas fa-coins" style="color:#fbbf24; margin-right:5px;"></i> ${displayBalance} Créditos`;
                    tokensBadge.style.color = '#fff';
                }

                addLog(`⚡ Recarga Exitosa: +${data.added} Tokens añadidos.`, "success");

                setTimeout(() => {
                    document.getElementById('pricing-modal').style.display = 'none';
                    btn.innerHTML = originalText;
                    btn.style.background = '';
                    btn.style.opacity = '1';
                }, 1500);
            } else {
                throw new Error(data.error || "Fallo en transacción");
            }
        } catch (e) {
            console.error(e);
            btn.innerHTML = '<i class="fas fa-times"></i> Error';
            btn.style.background = '#ef4444';
            setTimeout(() => { btn.innerHTML = originalText; btn.style.background = ''; btn.style.opacity = '1'; }, 2000);
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

});
