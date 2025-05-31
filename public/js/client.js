// public/js/client.js
document.addEventListener("DOMContentLoaded", () => {
  const socket = io();

  const startButton = document.getElementById("startButton");
  const stopButton = document.getElementById("stopButton");
  const searchStateSpan = document.getElementById("searchState");
  const scannedCountSpan = document.getElementById("scannedCount");
  const matchesFoundCountSpan = document.getElementById("matchesFoundCount");
  const matchesContainer = document.getElementById("matchesContainer");
  const noMatchesMessage = document.getElementById("noMatchesMessage");

  function updateSearchStatusUI(status) {
    searchStateSpan.textContent = status.isSearching ? "Searching..." : "Idle";
    scannedCountSpan.textContent = status.searchedCount;
    matchesFoundCountSpan.textContent = status.foundCount;
    startButton.disabled = status.isSearching;
    stopButton.disabled = !status.isSearching;
  }

  function addMatchToUI(match) {
    if (noMatchesMessage) {
      noMatchesMessage.style.display = "none";
    }

    const matchItem = document.createElement("div");
    matchItem.classList.add("match-item");
    matchItem.id = `match-${match.id}`; // For potential future updates/removals
    matchItem.innerHTML = `
            <img src="${match.qrImageUrl}" alt="QR for ${match.url}">
            <p class="match-url" title="${match.url}">${match.url}</p>
            <p class="match-info">Pattern: ${match.pattern} @ (${
      match.location.x
    }, ${match.location.y})</p>
            <p class="match-time">${
              match.timestamp || new Date().toLocaleTimeString()
            }</p>
        `;
    // Add to the top of the container
    if (matchesContainer.firstChild) {
      matchesContainer.insertBefore(matchItem, matchesContainer.firstChild);
    } else {
      matchesContainer.appendChild(matchItem);
    }
  }

  // --- Event Listeners for Buttons ---
  startButton.addEventListener("click", () => {
    socket.emit("startSearch");
  });

  stopButton.addEventListener("click", () => {
    socket.emit("stopSearch");
  });

  // --- Socket.IO Event Handlers ---
  socket.on("initialData", (data) => {
    console.log("Received initial data:", data);
    updateSearchStatusUI({
      isSearching: data.isSearching,
      searchedCount: data.searchedCount,
      foundCount: data.foundMatches.length,
    });
    // Clear existing matches (if any from EJS) before adding from socket,
    // or ensure EJS only renders if socket data isn't immediately available.
    // For simplicity, this assumes EJS renders initial and socket might update.
    // If client reconnects, foundMatches from server is truth.
    matchesContainer.innerHTML = ""; // Clear EJS rendered matches
    let hasInitialMatches = false;
    data.foundMatches.forEach((match) => {
      addMatchToUI(match);
      hasInitialMatches = true;
    });
    if (!hasInitialMatches && noMatchesMessage) {
      noMatchesMessage.style.display = "block";
    } else if (hasInitialMatches && noMatchesMessage) {
      noMatchesMessage.style.display = "none";
    }
  });

  socket.on("searchStatus", (status) => {
    updateSearchStatusUI(status);
  });

  socket.on("patternFound", (matchData) => {
    addMatchToUI(matchData);
    // Update count separately if not included in patternFound event
    matchesFoundCountSpan.textContent =
      parseInt(matchesFoundCountSpan.textContent || "0", 10) + 1;
  });

  socket.on("searchError", (errorMessage) => {
    alert(`Search Error: ${errorMessage}`);
    // Ensure UI reflects that search is not running
    updateSearchStatusUI({
      isSearching: false,
      searchedCount: parseInt(scannedCountSpan.textContent),
      foundCount: parseInt(matchesFoundCountSpan.textContent),
    });
  });

  socket.on("connect_error", (err) => {
    console.error("Socket connection error:", err);
    searchStateSpan.textContent = "Connection Error!";
    searchStateSpan.style.color = "red";
    startButton.disabled = true;
    stopButton.disabled = true;
  });

  socket.on("disconnect", (reason) => {
    console.log("Disconnected from server:", reason);
    searchStateSpan.textContent = "Disconnected. Attempting to reconnect...";
    searchStateSpan.style.color = "orange";
    // Buttons might be re-enabled by 'initialData' on reconnect
  });

  socket.on("connect", () => {
    console.log("Connected to server with ID:", socket.id);
    searchStateSpan.textContent = "Connected"; // Will be updated by initialData
    searchStateSpan.style.color = ""; // Reset color
  });
});
