const PoziviAjax = (function () {
  function request(method, url, body, callback) {
    const options = { method, headers: { "Content-Type": "application/json" } };
    if (body !== null && body !== undefined) options.body = JSON.stringify(body);

    fetch(url, options)
      .then(async (res) => {
        let data = {};
        try { data = await res.json(); } catch { data = {}; }
        callback(res.status, data);
      })
      .catch((err) => callback(0, { message: err.message }));
  }

  return {
    postScenario: function (title, callback) {
      request("POST", "/api/scenarios", { title }, callback);
    },

    getScenario: function (scenarioId, callback) {
      request("GET", `/api/scenarios/${scenarioId}`, null, callback);
    },

    lockLine: function (scenarioId, lineId, userId, callback) {
      request("POST", `/api/scenarios/${scenarioId}/lines/${lineId}/lock`, { userId }, callback);
    },

    updateLine: function (scenarioId, lineId, userId, newText, callback) {
      request("PUT", `/api/scenarios/${scenarioId}/lines/${lineId}`, { userId, newText }, callback);
    },

    lockCharacter: function (scenarioId, characterName, userId, callback) {
      request("POST", `/api/scenarios/${scenarioId}/characters/lock`, { userId, characterName }, callback);
    },

    updateCharacter: function (scenarioId, userId, oldName, newName, callback) {
      request("POST", `/api/scenarios/${scenarioId}/characters/update`, { userId, oldName, newName }, callback);
    },

    getDeltas: function (scenarioId, since, callback) {
      request("GET", `/api/scenarios/${scenarioId}/deltas?since=${since}`, null, callback);
    }
  };
})();
