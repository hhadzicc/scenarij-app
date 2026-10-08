(function () {
  "use strict";

  const state = {
    scenarios: [],
    user: null,
    query: "",
    view: localStorage.getItem("scenario-view") || "grid"
  };

  const grid = document.getElementById("projectsGrid");
  const search = document.getElementById("scenarioSearch");
  const modal = document.getElementById("createScenarioModal");
  const titleInput = document.getElementById("scenarioTitle");
  const confirmCreateButton = document.getElementById("confirmCreateButton");
  const sidebarBackdrop = document.getElementById("sidebarBackdrop");

  function refreshIcons(root = document) {
    if (window.lucide) window.lucide.createIcons({ root });
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

  function relativeTime(timestamp) {
    if (!timestamp) return "Novi scenarij";
    const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
    if (seconds < 60) return "Upravo izmijenjeno";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `Prije ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Prije ${hours} h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `Prije ${days} ${plural(days, "dan", "dana", "dana")}`;
    const date = new Date(timestamp * 1000);
    return `${String(date.getDate()).padStart(2, "0")}. ${String(date.getMonth() + 1).padStart(2, "0")}. ${date.getFullYear()}.`;
  }

  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i data-lucide="${type === "error" ? "circle-alert" : "circle-check"}" aria-hidden="true"></i><span>${escapeHtml(message)}</span>`;
    document.getElementById("toastRegion").append(toast);
    refreshIcons(toast);
    setTimeout(() => toast.remove(), 3600);
  }

  function updateSummary(scenarios) {
    const totalLines = scenarios.reduce((sum, scenario) => sum + Number(scenario.lineCount || 0), 0);
    document.getElementById("scenarioCount").textContent = `${scenarios.length} ${plural(scenarios.length, "scenarij", "scenarija", "scenarija")}`;
    document.getElementById("lineCount").textContent = `${totalLines} ${plural(totalLines, "linija teksta", "linije teksta", "linija teksta")}`;
  }

  function authUrl(mode = "login") {
    return `/auth?mode=${mode}&next=${encodeURIComponent(window.location.pathname)}`;
  }

  function renderAccount() {
    const sidebarAccount = document.getElementById("sidebarAccount");
    const accountButton = document.getElementById("accountButton");
    const mobileAccountButton = document.getElementById("mobileAccountButton");

    if (!state.user) {
      sidebarAccount.innerHTML = `
        <a class="account-login" href="${authUrl()}">
          <i data-lucide="log-in" aria-hidden="true"></i><span>Prijava</span>
        </a>`;
      accountButton.href = authUrl();
      accountButton.innerHTML = '<i data-lucide="log-in" aria-hidden="true"></i><span>Prijava</span>';
      mobileAccountButton.href = authUrl();
      refreshIcons();
      return;
    }

    const initial = state.user.name.trim().slice(0, 1).toUpperCase();
    sidebarAccount.innerHTML = `
      <div class="account-summary">
        <span class="account-avatar">${escapeHtml(initial)}</span>
        <span class="account-copy"><strong>${escapeHtml(state.user.name)}</strong><span>${escapeHtml(state.user.email)}</span></span>
        <button class="account-logout" type="button" data-logout aria-label="Odjava" title="Odjava"><i data-lucide="log-out" aria-hidden="true"></i></button>
      </div>`;
    accountButton.href = "#account";
    accountButton.innerHTML = `<span class="small-avatar">${escapeHtml(initial)}</span><span>${escapeHtml(state.user.name)}</span>`;
    mobileAccountButton.href = "#account";
    mobileAccountButton.innerHTML = `<span class="small-avatar">${escapeHtml(initial)}</span>`;
    document.querySelectorAll('[href="#account"]').forEach((element) => {
      element.addEventListener("click", (event) => event.preventDefault());
    });
    sidebarAccount.querySelector("[data-logout]").addEventListener("click", logout);
    refreshIcons();
  }

  function render() {
    const query = state.query.trim().toLocaleLowerCase("bs");
    const visible = state.scenarios.filter((scenario) =>
      scenario.title.toLocaleLowerCase("bs").includes(query)
    );

    grid.classList.toggle("list-view", state.view === "list");
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === state.view);
    });
    updateSummary(state.scenarios);

    if (!visible.length) {
      const isSearch = Boolean(query);
      grid.innerHTML = `
        <div class="empty-state">
          <i data-lucide="${isSearch ? "search-x" : "file-pen-line"}" aria-hidden="true"></i>
          <h2>${isSearch ? "Nema rezultata" : "Još nema scenarija"}</h2>
          <p>${isSearch ? "Pokušaj s drugim naslovom ili ukloni filter pretrage." : "Kreiraj prvi scenarij i počni slagati scene, likove i dijalog."}</p>
          ${isSearch ? "" : '<button class="primary-button" type="button" data-empty-create><i data-lucide="plus" aria-hidden="true"></i>Novi scenarij</button>'}
        </div>`;
      grid.querySelector("[data-empty-create]")?.addEventListener("click", openCreateModal);
      refreshIcons(grid);
      return;
    }

    grid.innerHTML = visible.map((scenario) => `
      <a class="project-card ${scenario.isDemo ? "demo-card" : ""}" href="/editor?id=${scenario.id}" aria-label="Otvori scenarij ${escapeHtml(scenario.title)}">
        <div class="project-card-top">
          <span class="file-mark"><i data-lucide="file-pen-line" aria-hidden="true"></i></span>
          ${scenario.isDemo ? '<span class="demo-badge">DEMO</span>' : '<span class="project-open-icon"><i data-lucide="arrow-up-right" aria-hidden="true"></i></span>'}
        </div>
        <div>
          <h2 title="${escapeHtml(scenario.title)}">${escapeHtml(scenario.title)}</h2>
          <p class="project-meta">${scenario.isDemo ? "Javni primjer · samo pregled" : "Privatni scenarij"}</p>
        </div>
        <footer class="project-footer">
          <span><i data-lucide="align-left" aria-hidden="true"></i>${scenario.lineCount} ${plural(scenario.lineCount, "linija", "linije", "linija")}</span>
          <span><i data-lucide="clock-3" aria-hidden="true"></i>${relativeTime(scenario.updatedAt)}</span>
        </footer>
      </a>`).join("");
    refreshIcons(grid);
  }

  async function loadScenarios() {
    try {
      const response = await fetch("/api/scenarios");
      if (!response.ok) throw new Error("Scenariji nisu dostupni.");
      state.scenarios = await response.json();
      render();
    } catch (error) {
      grid.innerHTML = `
        <div class="empty-state">
          <i data-lucide="cloud-off" aria-hidden="true"></i>
          <h2>Veza nije uspostavljena</h2>
          <p>${escapeHtml(error.message)}</p>
          <button class="secondary-button" type="button" data-retry>Učitaj ponovo</button>
        </div>`;
      grid.querySelector("[data-retry]")?.addEventListener("click", loadScenarios);
      refreshIcons(grid);
    }
  }

  async function loadSession() {
    try {
      const response = await fetch("/api/auth/me");
      const data = await response.json();
      state.user = data.user || null;
    } catch {
      state.user = null;
    }
    renderAccount();
  }

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      state.user = null;
      await loadScenarios();
      renderAccount();
      closeSidebar();
      showToast("Uspješno si se odjavio.");
    } catch {
      showToast("Odjava trenutno nije uspjela.", "error");
    }
  }

  function openCreateModal() {
    closeSidebar();
    if (!state.user) {
      window.location.href = authUrl("register");
      return;
    }
    titleInput.value = "";
    modal.showModal();
    requestAnimationFrame(() => titleInput.focus());
  }

  async function createScenario() {
    const title = titleInput.value.trim();
    if (!title) {
      titleInput.focus();
      return;
    }

    confirmCreateButton.disabled = true;
    confirmCreateButton.querySelector("span").textContent = "Kreiranje...";
    try {
      const response = await fetch("/api/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title })
      });
      const data = await response.json();
      if (response.status === 401) {
        window.location.href = authUrl();
        return;
      }
      if (!response.ok) throw new Error(data.message || "Scenario nije kreiran.");
      window.location.href = `/editor?id=${data.id}`;
    } catch (error) {
      showToast(error.message, "error");
      confirmCreateButton.disabled = false;
      confirmCreateButton.querySelector("span").textContent = "Kreiraj i otvori";
    }
  }

  function openSidebar() {
    document.body.classList.add("sidebar-open");
    sidebarBackdrop.hidden = false;
  }

  function closeSidebar() {
    document.body.classList.remove("sidebar-open");
    sidebarBackdrop.hidden = true;
  }

  search.addEventListener("input", () => {
    state.query = search.value;
    render();
  });

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      localStorage.setItem("scenario-view", state.view);
      render();
    });
  });

  ["createScenarioButton", "sidebarCreateButton", "mobileCreateButton"].forEach((id) => {
    document.getElementById(id)?.addEventListener("click", openCreateModal);
  });
  document.getElementById("mobileMenuButton").addEventListener("click", openSidebar);
  sidebarBackdrop.addEventListener("click", closeSidebar);
  document.querySelectorAll("[data-close-create-modal]").forEach((button) => {
    button.addEventListener("click", () => modal.close());
  });
  confirmCreateButton.addEventListener("click", createScenario);
  titleInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      createScenario();
    }
  });

  refreshIcons();
  loadSession();
  loadScenarios();
})();
