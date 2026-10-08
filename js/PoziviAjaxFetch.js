(function () {
  function request(method, url, body, callback) {
    const options = { method, headers: { "Content-Type": "application/json" } };
    if (body !== null && body !== undefined) options.body = JSON.stringify(body);

    return fetch(url, options)
      .then(async (response) => {
        let data = {};
        try { data = await response.json(); } catch { data = {}; }
        if (typeof callback === "function") callback(response.status, data);
        if (!response.ok) {
          const error = new Error(data.message || "Zahtjev nije uspješan.");
          error.status = response.status;
          error.data = data;
          throw error;
        }
        return data;
      })
      .catch((error) => {
        if (typeof callback === "function" && !error.status) {
          callback(0, { message: error.message });
        }
        throw error;
      });
  }

  const api = {
    getCurrentUser(callback) {
      return request("GET", "/api/auth/me", null, callback);
    },

    getScenarios(callback) {
      return request("GET", "/api/scenarios", null, callback);
    },

    postScenario(title, callback) {
      return request("POST", "/api/scenarios", { title }, callback);
    },

    getScenario(scenarioId, callback) {
      return request("GET", `/api/scenarios/${scenarioId}`, null, callback);
    },

    updateScenarioTitle(scenarioId, title, callback) {
      return request("PATCH", `/api/scenarios/${scenarioId}`, { title }, callback);
    },

    addLine(scenarioId, text, callback) {
      return request("POST", `/api/scenarios/${scenarioId}/lines`, { text }, callback);
    },

    duplicateScenario(scenarioId, callback) {
      return request("POST", `/api/scenarios/${scenarioId}/duplicate`, {}, callback);
    },

    lockLine(scenarioId, lineId, userId, callback) {
      return request("POST", `/api/scenarios/${scenarioId}/lines/${lineId}/lock`, { userId }, callback);
    },

    updateLine(scenarioId, lineId, userId, newText, callback) {
      return request("PUT", `/api/scenarios/${scenarioId}/lines/${lineId}`, { userId, newText }, callback);
    },

    lockCharacter(scenarioId, characterName, userId, callback) {
      return request("POST", `/api/scenarios/${scenarioId}/characters/lock`, { userId, characterName }, callback);
    },

    updateCharacter(scenarioId, userId, oldName, newName, callback) {
      return request("POST", `/api/scenarios/${scenarioId}/characters/update`, { userId, oldName, newName }, callback);
    },

    getDeltas(scenarioId, since, callback) {
      return request("GET", `/api/scenarios/${scenarioId}/deltas?since=${since}`, null, callback);
    },

    createCheckpoint(scenarioId, callback) {
      return request("POST", `/api/scenarios/${scenarioId}/checkpoint`, {}, callback);
    },

    getCheckpoints(scenarioId, callback) {
      return request("GET", `/api/scenarios/${scenarioId}/checkpoints`, null, callback);
    },

    previewCheckpoint(scenarioId, checkpointId, callback) {
      return request("GET", `/api/scenarios/${scenarioId}/restore/${checkpointId}`, null, callback);
    }
  };

  window.PoziviAjaxFetch = api;
  window.PoziviAjax = api;
})();
