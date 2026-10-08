(function () {
  "use strict";

  const scenarioId = Number(new URLSearchParams(window.location.search).get("id"));
  if (!scenarioId) {
    window.location.replace("/");
    return;
  }

  const state = {
    scenario: null,
    originalText: new Map(),
    saveTimers: new Map(),
    savingLines: new Set(),
    titleTimer: null,
    pollingTimer: null,
    lastSince: Math.floor(Date.now() / 1000),
    userId: getOrCreateUserId()
  };

  const documentElement = document.getElementById("scriptDocument");
  const titleInput = document.getElementById("scenarioTitle");
  const saveState = document.getElementById("saveState");
  const mobileBackdrop = document.getElementById("mobileBackdrop");
  const renameModal = document.getElementById("renameCharacterModal");
  const versionModal = document.getElementById("versionPreviewModal");

  function getOrCreateUserId() {
    const stored = Number(localStorage.getItem("scenarijpro-user-id"));
    if (stored > 0) return stored;
    const created = Math.floor(100000 + Math.random() * 899999);
    localStorage.setItem("scenarijpro-user-id", String(created));
    return created;
  }

  function refreshIcons() {
    if (window.lucide) window.lucide.createIcons();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function plural(value, one, few, many) {
    const mod10 = value % 10;
    const mod100 = value % 100;
    if (value === 1) return one;
    if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return few;
    return many;
  }

  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i data-lucide="${type === "error" ? "circle-alert" : "circle-check"}" aria-hidden="true"></i><span>${escapeHtml(message)}</span>`;
    document.getElementById("toastRegion").append(toast);
    refreshIcons();
    setTimeout(() => toast.remove(), 3600);
  }

  function setSaveState(mode, label) {
    const icon = mode === "saving" ? "loader-circle" : mode === "error" ? "circle-alert" : "circle-check";
    saveState.className = `save-state ${mode}`;
    saveState.innerHTML = `<i data-lucide="${icon}" aria-hidden="true"></i>${escapeHtml(label)}`;
    refreshIcons();
  }

  function normalizeText(value) {
    return String(value ?? "").replace(/\r\n/g, "\n");
  }

  function parseSpeakerDialogue(text) {
    const match = String(text).trim().match(/^([A-ZČĆŽŠĐ][A-ZČĆŽŠĐ0-9 _-]{1,35}):\s*(.+)$/);
    return match ? { character: match[1].trim(), dialogue: match[2].trim() } : null;
  }

  function classifyLine(text, previousType = null) {
    const value = String(text).trim();
    if (!value) return "action";
    if (/^(INT\.|EXT\.|INT\.\/EXT\.)/i.test(value)) return "scene";
    if (/^\(.+\)$/.test(value)) return "parenthetical";
    if (parseSpeakerDialogue(value)) return "speaker-dialogue";
    if (/^[A-ZČĆŽŠĐ][A-ZČĆŽŠĐ0-9 _-]{1,35}$/.test(value) && value === value.toUpperCase()) return "character";
    if (previousType === "character" || previousType === "parenthetical") return "dialogue";
    return "action";
  }

  function analyzeScenario() {
    const lines = state.scenario?.content || [];
    const typed = [];
    const characters = new Map();
    let previousType = null;

    lines.forEach((line, index) => {
      const type = classifyLine(line.text, previousType);
      typed.push({ ...line, type, index });

      const inlineDialogue = parseSpeakerDialogue(line.text);
      if (inlineDialogue) {
        characters.set(inlineDialogue.character, (characters.get(inlineDialogue.character) || 0) + 1);
      } else if (type === "character") {
        const name = line.text.trim();
        characters.set(name, (characters.get(name) || 0) + 1);
      }

      if (type !== "parenthetical") previousType = type;
    });

    const text = lines.map((line) => line.text).join(" ");
    const words = text.match(/[A-Za-zČĆŽŠĐčćžšđ0-9]+/g) || [];
    const scenes = typed.filter((line) => line.type === "scene");
    const structure = {
      scene: typed.filter((line) => line.type === "scene").length,
      dialogue: typed.filter((line) => ["dialogue", "speaker-dialogue", "character", "parenthetical"].includes(line.type)).length,
      action: typed.filter((line) => line.type === "action").length
    };

    return { typed, characters, words: words.length, scenes, structure };
  }

  function resizeTextarea(textarea) {
    textarea.style.height = "0";
    textarea.style.height = `${Math.max(28, textarea.scrollHeight)}px`;
  }

  function createLineElement(line, type, index) {
    const wrapper = document.createElement("div");
    wrapper.className = "script-line";
    wrapper.dataset.lineId = String(line.lineId);
    wrapper.dataset.lineNumber = String(index + 1);
    wrapper.dataset.type = type;

    const textarea = document.createElement("textarea");
    textarea.className = "line-textarea";
    textarea.rows = 1;
    textarea.value = line.text;
    textarea.setAttribute("aria-label", `Linija ${index + 1}`);
    textarea.spellcheck = true;
    wrapper.append(textarea);

    textarea.addEventListener("input", () => {
      resizeTextarea(textarea);
      line.text = textarea.value;
      const scenarioLine = state.scenario.content.find((item) => item.lineId === line.lineId);
      if (scenarioLine) scenarioLine.text = textarea.value;
      wrapper.dataset.type = classifyLine(textarea.value, previousLineType(index));
      scheduleLineSave(line.lineId, textarea, wrapper);
      updateAnalysis();
    });

    textarea.addEventListener("blur", () => {
      if (state.saveTimers.has(line.lineId)) {
        clearTimeout(state.saveTimers.get(line.lineId));
        state.saveTimers.delete(line.lineId);
        saveLine(line.lineId, textarea, wrapper);
      }
    });

    requestAnimationFrame(() => resizeTextarea(textarea));
    return wrapper;
  }

  function previousLineType(index) {
    if (!state.scenario || index <= 0) return null;
    let previousType = null;
    for (let i = 0; i < index; i += 1) {
      const type = classifyLine(state.scenario.content[i].text, previousType);
      if (type !== "parenthetical") previousType = type;
    }
    return previousType;
  }

  function renderDocument() {
    if (!state.scenario) return;
    const analysis = analyzeScenario();
    documentElement.innerHTML = "";
    state.originalText.clear();

    analysis.typed.forEach((line, index) => {
      state.originalText.set(line.lineId, normalizeText(line.text));
      documentElement.append(createLineElement(line, line.type, index));
    });

    if (!analysis.typed.length) {
      documentElement.innerHTML = '<div class="document-error"><p>Scenario je prazan.</p></div>';
    }

    updateAnalysis(analysis);
    refreshIcons();
  }

  function scheduleLineSave(lineId, textarea, wrapper) {
    if (state.saveTimers.has(lineId)) clearTimeout(state.saveTimers.get(lineId));
    setSaveState("saving", "Nesačuvane promjene");
    const timer = setTimeout(() => {
      state.saveTimers.delete(lineId);
      saveLine(lineId, textarea, wrapper);
    }, 900);
    state.saveTimers.set(lineId, timer);
  }

  async function saveLine(lineId, textarea, wrapper) {
    const value = normalizeText(textarea.value);
    if (value === state.originalText.get(lineId) || state.savingLines.has(lineId)) return;

    state.savingLines.add(lineId);
    wrapper.classList.add("saving");
    wrapper.classList.remove("save-error");
    setSaveState("saving", "Spremanje...");

    try {
      await PoziviAjax.lockLine(scenarioId, lineId, state.userId);
      await PoziviAjax.updateLine(scenarioId, lineId, state.userId, [value]);
      state.originalText.set(lineId, value);
      wrapper.classList.remove("saving");
      state.savingLines.delete(lineId);
      setSaveState("saved", "Sve promjene su sačuvane");

      const wordCount = (value.match(/[A-Za-zČĆŽŠĐčćžšđ0-9]+/g) || []).length;
      if (wordCount > 20) await loadScenario({ preserveFocus: false });
    } catch (error) {
      wrapper.classList.remove("saving");
      wrapper.classList.add("save-error");
      state.savingLines.delete(lineId);
      setSaveState("error", "Promjena nije sačuvana");
      showToast(error.message || "Linija nije sačuvana.", "error");
    }
  }

  function formatSceneLabel(text) {
    return String(text).trim().replace(/\s+/g, " ");
  }

  function renderScenes(analysis) {
    const sceneList = document.getElementById("sceneList");
    const scenes = analysis.scenes;
    if (!scenes.length) {
      sceneList.innerHTML = `
        <button class="scene-link active" type="button" data-line-target="${analysis.typed[0]?.lineId || ""}">
          <span class="scene-index">01</span>
          <span class="scene-copy"><strong>SCENARIJ BEZ OZNAČENIH SCENA</strong><span>${analysis.typed.length} linija</span></span>
        </button>`;
    } else {
      sceneList.innerHTML = scenes.map((scene, index) => {
        const nextScene = scenes[index + 1];
        const lineCount = (nextScene ? nextScene.index : analysis.typed.length) - scene.index;
        return `
          <button class="scene-link ${index === 0 ? "active" : ""}" type="button" data-line-target="${scene.lineId}">
            <span class="scene-index">${String(index + 1).padStart(2, "0")}</span>
            <span class="scene-copy"><strong>${escapeHtml(formatSceneLabel(scene.text))}</strong><span>${lineCount} ${plural(lineCount, "linija", "linije", "linija")}</span></span>
          </button>`;
      }).join("");
    }

    sceneList.querySelectorAll("[data-line-target]").forEach((button) => {
      button.addEventListener("click", () => {
        sceneList.querySelectorAll(".scene-link").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        const target = documentElement.querySelector(`[data-line-id="${button.dataset.lineTarget}"]`);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        closeMobilePanels();
      });
    });
  }

  function renderCharacters(analysis) {
    const list = document.getElementById("characterList");
    const characters = [...analysis.characters.entries()].sort((a, b) => b[1] - a[1]);
    if (!characters.length) {
      list.innerHTML = '<div class="history-empty">Likovi će se pojaviti nakon što uneseš ime velikim slovima ili repliku u obliku IME: tekst.</div>';
      return;
    }

    list.innerHTML = characters.map(([name, count]) => `
      <div class="character-item">
        <span class="character-avatar">${escapeHtml(name.slice(0, 1))}</span>
        <span class="character-copy"><strong>${escapeHtml(name)}</strong><span>${count} ${plural(count, "pojavljivanje", "pojavljivanja", "pojavljivanja")}</span></span>
        <button class="icon-button" type="button" data-rename-character="${escapeHtml(name)}" aria-label="Preimenuj ${escapeHtml(name)}" title="Preimenuj">
          <i data-lucide="pencil" aria-hidden="true"></i>
        </button>
      </div>`).join("");

    list.querySelectorAll("[data-rename-character]").forEach((button) => {
      button.addEventListener("click", () => openRenameModal(button.dataset.renameCharacter));
    });
  }

  function levenshtein(a, b) {
    const matrix = Array.from({ length: b.length + 1 }, (_, row) => [row]);
    for (let column = 0; column <= a.length; column += 1) matrix[0][column] = column;
    for (let row = 1; row <= b.length; row += 1) {
      for (let column = 1; column <= a.length; column += 1) {
        matrix[row][column] = b[row - 1] === a[column - 1]
          ? matrix[row - 1][column - 1]
          : 1 + Math.min(matrix[row - 1][column], matrix[row][column - 1], matrix[row - 1][column - 1]);
      }
    }
    return matrix[b.length][a.length];
  }

  function renderNameReview(analysis) {
    const names = [...analysis.characters.keys()];
    const suspicious = new Set();
    names.forEach((name, index) => {
      names.slice(index + 1).forEach((other) => {
        const limit = name.length > 5 && other.length > 5 ? 2 : 1;
        if (levenshtein(name, other) <= limit) {
          suspicious.add(name);
          suspicious.add(other);
        }
      });
    });

    const review = document.getElementById("nameReview");
    if (suspicious.size) {
      review.className = "review-result warning";
      review.innerHTML = `<i data-lucide="triangle-alert" aria-hidden="true"></i><p>Provjeri slična imena: ${escapeHtml([...suspicious].join(", "))}.</p>`;
    } else {
      review.className = "review-result";
      review.innerHTML = '<i data-lucide="badge-check" aria-hidden="true"></i><p>Nema očiglednih grešaka u imenima likova.</p>';
    }
  }

  function renderStructure(analysis) {
    const labels = { scene: "Scene", dialogue: "Dijalog", action: "Akcija" };
    const max = Math.max(1, ...Object.values(analysis.structure));
    document.getElementById("structureBars").innerHTML = Object.entries(analysis.structure).map(([key, count]) => `
      <div class="structure-row">
        <span>${labels[key]}</span>
        <span class="structure-track"><span class="structure-fill" style="width:${Math.round((count / max) * 100)}%"></span></span>
        <strong>${count}</strong>
      </div>`).join("");
  }

  function updateAnalysis(providedAnalysis) {
    if (!state.scenario) return;
    const analysis = providedAnalysis || analyzeScenario();
    const sceneCount = Math.max(analysis.scenes.length, state.scenario.content.length ? 1 : 0);
    const characterCount = analysis.characters.size;
    const lineCount = analysis.typed.length;

    document.getElementById("wordCount").textContent = analysis.words;
    document.getElementById("lineCount").textContent = lineCount;
    document.getElementById("sceneCount").textContent = sceneCount;
    document.getElementById("characterCount").textContent = characterCount;
    document.getElementById("outlineLineCount").textContent = lineCount;
    document.getElementById("outlineCharacterCount").textContent = characterCount;
    document.getElementById("toolbarCounter").textContent = `${analysis.words} ${plural(analysis.words, "riječ", "riječi", "riječi")}`;

    const pages = Math.max(1, Math.ceil(analysis.words / 250));
    document.getElementById("documentPageEstimate").textContent = `${pages} ${plural(pages, "STRANICA", "STRANICE", "STRANICA")}`;

    renderScenes(analysis);
    renderCharacters(analysis);
    renderNameReview(analysis);
    renderStructure(analysis);
    refreshIcons();
  }

  async function loadScenario(options = {}) {
    const activeLineId = options.preserveFocus
      ? document.activeElement?.closest?.(".script-line")?.dataset.lineId
      : null;
    try {
      const scenario = await PoziviAjax.getScenario(scenarioId);
      state.scenario = scenario;
      titleInput.value = scenario.title;
      document.title = `${scenario.title} - ScenarijPro`;
      renderDocument();
      setSaveState("saved", "Sve promjene su sačuvane");
      if (activeLineId) {
        const textarea = documentElement.querySelector(`[data-line-id="${activeLineId}"] textarea`);
        textarea?.focus();
      }
    } catch (error) {
      documentElement.innerHTML = `
        <div class="document-error">
          <i data-lucide="file-warning" aria-hidden="true"></i>
          <strong>Scenario nije moguće otvoriti</strong>
          <span>${escapeHtml(error.message)}</span>
          <a class="secondary-button" href="/">Nazad na scenarije</a>
        </div>`;
      setSaveState("error", "Nije učitano");
      refreshIcons();
    }
  }

  function scheduleTitleSave() {
    clearTimeout(state.titleTimer);
    setSaveState("saving", "Nesačuvane promjene");
    state.titleTimer = setTimeout(saveTitle, 700);
  }

  async function saveTitle() {
    const title = titleInput.value.trim();
    if (!title || title === state.scenario?.title) return;
    try {
      setSaveState("saving", "Spremanje naslova...");
      await PoziviAjax.updateScenarioTitle(scenarioId, title);
      state.scenario.title = title;
      document.title = `${title} - ScenarijPro`;
      setSaveState("saved", "Sve promjene su sačuvane");
    } catch (error) {
      setSaveState("error", "Naslov nije sačuvan");
      showToast(error.message, "error");
    }
  }

  async function addLine(type = "action") {
    const templates = {
      scene: "INT. LOKACIJA - DAY",
      action: "",
      character: "IME LIKA",
      dialogue: ""
    };
    try {
      setSaveState("saving", "Dodavanje linije...");
      const created = await PoziviAjax.addLine(scenarioId, templates[type] ?? "");
      await loadScenario();
      const textarea = documentElement.querySelector(`[data-line-id="${created.lineId}"] textarea`);
      textarea?.focus();
      textarea?.select();
    } catch (error) {
      setSaveState("error", "Linija nije dodana");
      showToast(error.message, "error");
    }
  }

  function openRenameModal(name = "") {
    closeMobilePanels();
    document.getElementById("oldCharacterName").value = name;
    document.getElementById("newCharacterName").value = "";
    renameModal.showModal();
    requestAnimationFrame(() => (name ? document.getElementById("newCharacterName") : document.getElementById("oldCharacterName")).focus());
  }

  async function renameCharacter() {
    const oldName = document.getElementById("oldCharacterName").value.trim().toUpperCase();
    const newName = document.getElementById("newCharacterName").value.trim().toUpperCase();
    if (!oldName || !newName) return;

    const button = document.getElementById("confirmRenameButton");
    button.disabled = true;
    button.textContent = "Preimenovanje...";
    try {
      await PoziviAjax.lockCharacter(scenarioId, oldName, state.userId);
      await PoziviAjax.updateCharacter(scenarioId, state.userId, oldName, newName);
      renameModal.close();
      await loadScenario();
      showToast(`${oldName} je preimenovan u ${newName}.`);
    } catch (error) {
      showToast(error.message || "Lik nije preimenovan.", "error");
    } finally {
      button.disabled = false;
      button.textContent = "Preimenuj";
    }
  }

  async function createCheckpoint() {
    try {
      await PoziviAjax.createCheckpoint(scenarioId);
      await loadCheckpoints();
      showToast("Trenutna verzija je sačuvana.");
    } catch (error) {
      showToast(error.message || "Verzija nije sačuvana.", "error");
    }
  }

  function formatCheckpointDate(timestamp) {
    return new Intl.DateTimeFormat("bs-BA", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(timestamp * 1000));
  }

  async function loadCheckpoints() {
    const list = document.getElementById("historyList");
    try {
      const checkpoints = await PoziviAjax.getCheckpoints(scenarioId);
      if (!checkpoints.length) {
        list.innerHTML = '<div class="history-empty">Još nema sačuvanih verzija.</div>';
        return;
      }
      list.innerHTML = [...checkpoints].reverse().map((checkpoint, index) => `
        <div class="history-item">
          <span class="character-avatar">${String(checkpoints.length - index).padStart(2, "0")}</span>
          <span class="history-copy"><strong>Sačuvana verzija</strong><span>${escapeHtml(formatCheckpointDate(checkpoint.timestamp))}</span></span>
          <button class="icon-button" type="button" data-preview-checkpoint="${checkpoint.id}" data-checkpoint-time="${checkpoint.timestamp}" aria-label="Pregledaj verziju" title="Pregledaj">
            <i data-lucide="eye" aria-hidden="true"></i>
          </button>
        </div>`).join("");
      list.querySelectorAll("[data-preview-checkpoint]").forEach((button) => {
        button.addEventListener("click", () => previewCheckpoint(button.dataset.previewCheckpoint, button.dataset.checkpointTime));
      });
      refreshIcons();
    } catch (error) {
      list.innerHTML = `<div class="history-empty">${escapeHtml(error.message)}</div>`;
    }
  }

  async function previewCheckpoint(checkpointId, timestamp) {
    try {
      const snapshot = await PoziviAjax.previewCheckpoint(scenarioId, checkpointId);
      document.getElementById("versionPreviewDate").textContent = formatCheckpointDate(Number(timestamp));
      document.getElementById("versionPreviewContent").textContent = snapshot.content.map((line) => line.text).join("\n\n");
      versionModal.showModal();
    } catch (error) {
      showToast(error.message || "Verziju nije moguće učitati.", "error");
    }
  }

  function selectInspectorPanel(panelId) {
    document.querySelectorAll(".inspector-tab").forEach((tab) => {
      const selected = tab.dataset.panel === panelId;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    document.querySelectorAll(".inspector-content").forEach((panel) => {
      const selected = panel.id === panelId;
      panel.classList.toggle("active", selected);
      panel.hidden = !selected;
    });
    if (panelId === "historyPanel") loadCheckpoints();
  }

  function openOutline() {
    document.body.classList.remove("inspector-open");
    document.body.classList.add("outline-open");
    mobileBackdrop.hidden = false;
  }

  function openInspector() {
    document.body.classList.remove("outline-open", "inspector-hidden");
    document.body.classList.add("inspector-open");
    if (window.innerWidth <= 1120) mobileBackdrop.hidden = false;
  }

  function closeMobilePanels() {
    document.body.classList.remove("outline-open", "inspector-open");
    mobileBackdrop.hidden = true;
  }

  function closeInspector() {
    if (window.innerWidth > 1120) {
      document.body.classList.add("inspector-hidden");
    }
    closeMobilePanels();
  }

  function startPolling() {
    clearInterval(state.pollingTimer);
    state.pollingTimer = setInterval(async () => {
      if (state.savingLines.size || state.saveTimers.size || document.activeElement?.classList.contains("line-textarea")) return;
      try {
        const result = await PoziviAjax.getDeltas(scenarioId, state.lastSince);
        if (!result.deltas?.length) return;
        state.lastSince = Math.max(state.lastSince, ...result.deltas.map((delta) => Number(delta.timestamp) || 0));
        await loadScenario();
      } catch {
        // Polling is best-effort; a later request retries automatically.
      }
    }, 5000);
  }

  titleInput.addEventListener("input", scheduleTitleSave);
  titleInput.addEventListener("blur", saveTitle);
  document.getElementById("addLineButton").addEventListener("click", () => addLine("action"));
  document.querySelectorAll("[data-add-type]").forEach((button) => {
    button.addEventListener("click", () => addLine(button.dataset.addType));
  });
  ["renameCharacterButton", "renameCharacterSecondaryButton"].forEach((id) => {
    document.getElementById(id).addEventListener("click", () => openRenameModal());
  });
  ["createCheckpointButton", "createCheckpointSecondaryButton"].forEach((id) => {
    document.getElementById(id).addEventListener("click", createCheckpoint);
  });
  document.getElementById("confirmRenameButton").addEventListener("click", renameCharacter);
  document.getElementById("openOutlineButton").addEventListener("click", openOutline);
  document.getElementById("closeOutlineButton").addEventListener("click", closeMobilePanels);
  document.getElementById("openInspectorButton").addEventListener("click", openInspector);
  document.getElementById("closeInspectorButton").addEventListener("click", closeInspector);
  mobileBackdrop.addEventListener("click", closeMobilePanels);
  document.getElementById("closeVersionPreviewButton").addEventListener("click", () => versionModal.close());
  document.querySelectorAll(".inspector-tab").forEach((tab) => {
    tab.addEventListener("click", () => selectInspectorPanel(tab.dataset.panel));
  });

  window.addEventListener("beforeunload", (event) => {
    if (state.saveTimers.size || state.savingLines.size) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  refreshIcons();
  loadScenario();
  loadCheckpoints();
  startPolling();
})();
