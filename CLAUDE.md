# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a PixiJS 4.7 Canvas optimization playground demonstrating performance profiling and batch-friendly vs batch-unfriendly rendering scenarios. The project is a single-file HTML application focused on Canvas rendering performance analysis.

## Architecture

- **Single HTML file**: `index.html` contains the complete application
- **PixiJS 4.7**: Canvas renderer forced (not WebGL) for performance testing
- **Canvas 2D profiling**: Custom patched CanvasRenderingContext2D for draw call counting
- **Atlas texture system**: BaseTexture switching monitoring for batch analysis

### Key Components

1. **Canvas Profiling System** (lines 88-194): Patches CanvasRenderingContext2D to count:
   - Raster operations (drawImage calls)
   - Path operations (fill/stroke)
   - Text operations
   - Clear operations
   - Blend mode changes
   - Unique texture sources

2. **Atlas Monitoring** (lines 374-478): Tracks BaseTexture switches and unique atlas usage per frame

3. **Test Scenarios**:
   - **Batch-friendly**: Uses single atlas BaseTexture with consistent blend modes
   - **Batch-chaotic**: Creates individual textures per sprite with mixed blend modes

## Development

This is a standalone HTML file that can be opened directly in a browser. No build process, package managers, or dependencies are required.

### Running the Application

Simply open `index.html` in a web browser. The application will:
- Load PixiJS 4.7 from CDN
- Initialize Canvas renderer
- Start with a batch-friendly scene (800 sprites)

### Performance Testing

Use the UI buttons to switch between scenarios:
- **배치 우호**: Creates batch-friendly rendering (single atlas)
- **배치 비우호**: Creates batch-unfriendly rendering (multiple textures)
- **모두 지우기**: Clears all sprites

Monitor the HUD (top-right) for real-time performance metrics including draw calls, texture switches, and FPS.

## Code Patterns

- Korean language UI labels and comments
- Manual memory management with `destroy(true)` calls
- Performance-focused rendering optimizations
- Frame-based profiling counters that reset each frame