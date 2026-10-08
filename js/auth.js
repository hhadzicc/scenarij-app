(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const requestedNext = params.get("next");
  const nextPath = requestedNext?.startsWith("/") && !requestedNext.startsWith("//")
    ? requestedNext
    : "/";
  let mode = params.get("mode") === "register" ? "register" : "login";

  const form = document.getElementById("authForm");
  const nameField = document.getElementById("nameField");
  const nameInput = document.getElementById("name");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const submitButton = document.getElementById("submitButton");
  const errorElement = document.getElementById("formError");

  function refreshIcons() {
    if (window.lucide) window.lucide.createIcons();
  }

  function setMode(nextMode) {
    mode = nextMode;
    const registering = mode === "register";
    document.title = `${registering ? "Novi račun" : "Prijava"} - ScenarijPro`;
    document.getElementById("authTitle").textContent = registering ? "Kreiraj svoj prostor" : "Dobro došao nazad";
    document.getElementById("authDescription").textContent = registering
      ? "Sačuvaj privatne scenarije i nastavi pisanje na bilo kojem uređaju."
      : "Prijavi se i nastavi gdje si stao.";
    nameField.hidden = !registering;
    nameInput.required = registering;
    passwordInput.autocomplete = registering ? "new-password" : "current-password";
    submitButton.querySelector("span").textContent = registering ? "Kreiraj račun" : "Prijavi se";
    document.querySelectorAll(".auth-tab").forEach((tab) => {
      const selected = tab.dataset.mode === mode;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    errorElement.hidden = true;
    const url = new URL(window.location.href);
    url.searchParams.set("mode", mode);
    history.replaceState(null, "", url);
  }

  function showError(message) {
    errorElement.textContent = message;
    errorElement.hidden = false;
  }

  async function submit(event) {
    event.preventDefault();
    errorElement.hidden = true;

    if (!form.reportValidity()) return;

    const payload = {
      email: emailInput.value.trim(),
      password: passwordInput.value
    };
    if (mode === "register") payload.name = nameInput.value.trim();

    submitButton.disabled = true;
    submitButton.querySelector("span").textContent = mode === "register" ? "Kreiranje..." : "Prijavljivanje...";

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Zahtjev nije uspio.");
      window.location.replace(nextPath);
    } catch (error) {
      showError(error.message);
      submitButton.disabled = false;
      submitButton.querySelector("span").textContent = mode === "register" ? "Kreiraj račun" : "Prijavi se";
    }
  }

  document.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => setMode(tab.dataset.mode));
  });
  document.getElementById("passwordToggle").addEventListener("click", () => {
    const visible = passwordInput.type === "text";
    passwordInput.type = visible ? "password" : "text";
    document.getElementById("passwordToggle").setAttribute("aria-label", visible ? "Prikaži lozinku" : "Sakrij lozinku");
    document.getElementById("passwordToggle").innerHTML = `<i data-lucide="${visible ? "eye" : "eye-off"}" aria-hidden="true"></i>`;
    refreshIcons();
  });
  form.addEventListener("submit", submit);

  refreshIcons();
  setMode(mode);
})();
