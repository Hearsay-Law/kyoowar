// services/GameOfLifeService.js

class GameOfLifeService {
  constructor() {
    // No specific constructor logic needed for now,
    // but it's here if we need to add configuration later (e.g., different rule sets).
  }

  /**
   * Calculates the next generation of a Game of Life grid.
   * @param {Array<Array<number>>} grid - The current grid, where 1 is a live cell and 0 is a dead cell.
   * @returns {Array<Array<number>>} The grid representing the next generation.
   */
  calculateNextGeneration(grid) {
    if (!grid || grid.length === 0 || !Array.isArray(grid[0])) {
      // Handle empty or invalid grid
      return [];
    }

    const rows = grid.length;
    const cols = grid[0].length;
    const newGrid = [];

    // Create a new grid initialized to all dead cells
    for (let i = 0; i < rows; i++) {
      newGrid[i] = Array(cols).fill(0);
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const liveNeighbors = this._countLiveNeighbors(grid, r, c, rows, cols);
        const currentCell = grid[r][c];

        // Apply Conway's Game of Life rules:
        if (currentCell === 1) {
          // If cell is alive
          if (liveNeighbors < 2 || liveNeighbors > 3) {
            newGrid[r][c] = 0; // Dies by underpopulation or overpopulation
          } else {
            newGrid[r][c] = 1; // Survives
          }
        } else {
          // If cell is dead
          if (liveNeighbors === 3) {
            newGrid[r][c] = 1; // Becomes alive by reproduction
          }
        }
      }
    }
    return newGrid;
  }

  /**
   * Counts the number of live neighbors for a given cell.
   * @private
   * @param {Array<Array<number>>} grid - The current grid.
   * @param {number} r - The row index of the cell.
   * @param {number} c - The column index of the cell.
   * @param {number} numRows - Total number of rows in the grid.
   * @param {number} numCols - Total number of columns in the grid.
   * @returns {number} The count of live neighbors.
   */
  _countLiveNeighbors(grid, r, c, numRows, numCols) {
    let count = 0;
    // Define the 8 possible neighbor positions relative to the cell (r, c)
    const neighborOffsets = [
      [-1, -1],
      [-1, 0],
      [-1, 1], // Top row
      [0, -1],
      /* [0,0] is self */ [0, 1], // Middle row
      [1, -1],
      [1, 0],
      [1, 1], // Bottom row
    ];

    for (const offset of neighborOffsets) {
      const nr = r + offset[0]; // Neighbor row
      const nc = c + offset[1]; // Neighbor column

      // Check if the neighbor is within grid boundaries
      if (nr >= 0 && nr < numRows && nc >= 0 && nc < numCols) {
        if (grid[nr][nc] === 1) {
          count++;
        }
      }
    }
    return count;
  }
}

module.exports = GameOfLifeService;
