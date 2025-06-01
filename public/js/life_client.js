// public/js/life_client.js
document.addEventListener("DOMContentLoaded", () => {
  // --- Socket.IO Connection ---
  // Connect to the '/life' namespace
  const socket = io("/life"); // Make sure this matches the namespace on the server

  // --- DOM Element References ---
  const canvas = document.getElementById("lifeCanvas");
  const ctx = canvas.getContext("2d");

  const generateButton = document.getElementById("generateQRBoard");
  const urlInput = document.getElementById("urlInput");

  const playPauseButton = document.getElementById("playPauseButton");
  const nextStepButton = document.getElementById("nextStepButton");
  const speedRange = document.getElementById("speedRange");
  const speedValueSpan = document.getElementById("speedValue");

  // --- Game State Variables ---
  let currentGrid = null;
  let animationIntervalId = null;
  letisPlaying = false;
  let animationSpeedMs = parseInt(speedRange.value, 10);
  let cellSize = 10; // Default cell size for drawing, can be dynamic

  // --- Utility Functions (Placeholder for now) ---
  function drawGrid(grid) {
    if (!grid || grid.length === 0) {
      // Clear canvas if no grid
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const rows = grid.length;
    const cols = grid[0].length;

    // Adjust canvas size and cell size based on grid dimensions
    // This is a simple approach; more sophisticated scaling might be needed
    const maxCanvasWidth = window.innerWidth * 0.8;
    const maxCanvasHeight = window.innerHeight * 0.6;

    cellSize = Math.min(
      Math.floor(maxCanvasWidth / cols),
      Math.floor(maxCanvasHeight / rows),
      10
    ); // Max cell size of 10px
    cellSize = Math.max(cellSize, 1); // Minimum cell size of 1px

    canvas.width = cols * cellSize;
    canvas.height = rows * cellSize;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.beginPath();
        ctx.rect(c * cellSize, r * cellSize, cellSize, cellSize);
        if (grid[r][c] === 1) {
          ctx.fillStyle = "black"; // Live cell color (can be from config)
        } else {
          ctx.fillStyle = "white"; // Dead cell color (can be from config)
        }
        ctx.fill();
        // Optional: draw grid lines
        // ctx.strokeStyle = '#eee';
        // ctx.stroke();
      }
    }
  }

  function requestNextGeneration() {
    if (currentGrid) {
      socket.emit("getNextLifeGeneration", currentGrid);
    }
  }

  function startGameLoop() {
    if (animationIntervalId) clearInterval(animationIntervalId); // Clear existing loop
    animationIntervalId = setInterval(() => {
      requestNextGeneration();
    }, animationSpeedMs);
    isPlaying = true;
    playPauseButton.textContent = "Pause";
  }

  function stopGameLoop() {
    if (animationIntervalId) clearInterval(animationIntervalId);
    animationIntervalId = null;
    isPlaying = false;
    playPauseButton.textContent = "Play";
  }

  // --- Event Listeners for Controls ---
  generateButton.addEventListener("click", () => {
    console.log("Requesting new GOL board...");
    const userUrl = urlInput.value.trim();
    // Optionally, send preferred QR scale/margin if you want client control
    socket.emit("generateLifeFromQR", {
      url: userUrl || null /*, qrScale: 1, qrMargin: 0 */,
    });
    stopGameLoop(); // Stop any current animation
  });

  playPauseButton.addEventListener("click", () => {
    if (isPlaying) {
      stopGameLoop();
    } else {
      if (currentGrid) {
        // Only start if there's a grid
        startGameLoop();
      }
    }
  });

  nextStepButton.addEventListener("click", () => {
    if (currentGrid) {
      stopGameLoop(); // Stop continuous play if user steps manually
      requestNextGeneration();
    }
  });

  speedRange.addEventListener("input", (event) => {
    animationSpeedMs = parseInt(event.target.value, 10);
    speedValueSpan.textContent = `${animationSpeedMs}ms`;
    if (isPlaying) {
      // Restart loop with new speed
      startGameLoop();
    }
  });

  // --- Socket Event Handlers ---
  socket.on("connect", () => {
    console.log("Connected to /life namespace on server.");
    // Automatically request a board on connection or wait for button click
    // generateButton.click(); // Uncomment to auto-generate on load
  });

  socket.on("initialLifeBoard", (data) => {
    console.log("Received initial GOL board:", data.sourceUrl);
    currentGrid = data.grid;
    drawGrid(currentGrid);
    // If you want it to auto-play on new board:
    // if (isPlaying) startGameLoop();
    // else stopGameLoop();
  });

  socket.on("newLifeGeneration", (data) => {
    // console.log('Received new GOL generation.');
    currentGrid = data.grid;
    drawGrid(currentGrid);
  });

  socket.on("lifeBoardError", (error) => {
    console.error("Server error for GOL board:", error.message);
    alert(`Error from server: ${error.message}`);
    stopGameLoop();
  });

  socket.on("disconnect", () => {
    console.log("Disconnected from /life namespace.");
    stopGameLoop();
  });

  // Initial setup (e.g., draw an empty grid or a placeholder)
  drawGrid(null); // Or draw some placeholder on canvas
  speedValueSpan.textContent = `${animationSpeedMs}ms`;
});
