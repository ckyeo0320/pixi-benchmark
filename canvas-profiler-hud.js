/**
 * Canvas Profiler HUD
 * 프로파일링 데이터를 실시간으로 표시하는 간단한 HUD
 */

(function() {
  'use strict';

  /**
   * Canvas Profiler HUD 생성
   * @param {Object} options - 설정 옵션
   * @param {string} options.position - 위치 ('top-right', 'top-left', 'bottom-right', 'bottom-left')
   * @param {boolean} options.fps - FPS 표시 여부
   * @param {Object} options.style - 커스텀 스타일
   */
  function createCanvasProfilerHUD(options = {}) {
    const config = {
      position: options.position || 'top-right',
      fps: options.fps !== false,
      style: options.style || {}
    };

    // HUD 엘리먼트 생성
    const hud = document.createElement('div');
    hud.id = 'canvas-profiler-hud';
    
    // 기본 스타일 적용
    const baseStyle = {
      position: 'fixed',
      zIndex: '9999',
      background: 'rgba(0, 0, 0, 0.8)',
      color: '#00ff00',
      padding: '10px 12px',
      borderRadius: '8px',
      fontFamily: 'monospace',
      fontSize: '11px',
      lineHeight: '1.3',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      minWidth: '280px'
    };

    // 위치별 스타일
    const positionStyles = {
      'top-right': { top: '12px', right: '12px' },
      'top-left': { top: '12px', left: '12px' },
      'bottom-right': { bottom: '12px', right: '12px' },
      'bottom-left': { bottom: '12px', left: '12px' }
    };

    // 스타일 병합 및 적용
    const finalStyle = { 
      ...baseStyle, 
      ...positionStyles[config.position], 
      ...config.style 
    };
    
    Object.assign(hud.style, finalStyle);
    document.body.appendChild(hud);

    // FPS 측정용
    let lastTime = performance.now();
    let fps = 0;

    /**
     * HUD 업데이트 함수
     */
    function updateHUD() {
      // FPS 계산
      if (config.fps) {
        const now = performance.now();
        fps = 1000 / (now - lastTime);
        lastTime = now;
      }

      // 프로파일링 데이터 가져오기
      const data = window.getCanvasProfileData ? window.getCanvasProfileData() : {
        total: 0,
        raster: 0,
        path: 0,
        text: 0,
        clear: 0,
        clip: 0,
        blendChanges: 0,
        texturesUsed: 0,
        atlasSwitches: 0,
        uniqueAtlases: 0
      };

      // HUD 텍스트 구성
      let hudText = 'Canvas Profiler (per frame)\n';
      
      if (config.fps) {
        hudText += `FPS: ${fps.toFixed(1)}\n`;
      }
      
      hudText += `total: ${data.total}\n`;
      hudText += `  raster: ${data.raster}   (drawImage/putImageData)\n`;
      hudText += `  path  : ${data.path}     (fill/stroke/rect)\n`;
      hudText += `  text  : ${data.text}     (fillText/strokeText)\n`;
      hudText += `  clear : ${data.clear}    (clearRect)\n`;
      hudText += `  clip  : ${data.clip}     (clip)\n`;
      hudText += `blendChanges: ${data.blendChanges}  (globalCompositeOperation)\n`;
      hudText += `texturesUsed: ${data.texturesUsed}  (drawImage 고유 소스 수)\n`;
      hudText += `atlasSwitches: ${data.atlasSwitches} (BaseTexture 전환)\n`;
      hudText += `uniqueAtlases: ${data.uniqueAtlases} (고유 BaseTexture 수)`;

      hud.textContent = hudText;

      // 카운터 리셋
      if (window.resetCanvasProfiler) {
        window.resetCanvasProfiler();
      }
    }

    /**
     * HUD 표시/숨김 토글
     */
    function toggleHUD() {
      hud.style.display = hud.style.display === 'none' ? 'block' : 'none';
    }

    /**
     * HUD 제거
     */
    function removeHUD() {
      if (hud.parentNode) {
        hud.parentNode.removeChild(hud);
      }
    }

    // window.__hud 네임스페이스에 노출
    if (!window.__hud) window.__hud = {};
    
    // 단축명
    window.__hud.update = updateHUD;
    window.__hud.show = toggleHUD;
    window.__hud.remove = removeHUD;
    
    // 기존 긴 이름도 유지 (호환성)
    window.__hud.updateCanvasProfiler = updateHUD;
    window.__hud.toggleCanvasProfiler = toggleHUD;
    window.__hud.removeCanvasProfiler = removeHUD;

    return {
      element: hud,
      update: updateHUD,
      toggle: toggleHUD,
      remove: removeHUD
    };
  }

  /**
   * 자동 HUD (requestAnimationFrame 사용)
   * @param {Object} options - HUD 옵션
   */
  function createAutoCanvasProfilerHUD(options = {}) {
    const hud = createCanvasProfilerHUD(options);
    let animationId = null;
    let isRunning = false;
    
    function animate() {
      if (isRunning) {
        hud.update();
        animationId = requestAnimationFrame(animate);
      }
    }
    
    // 자동 시작
    function start() {
      if (!isRunning) {
        isRunning = true;
        animate();
      }
    }
    
    // 중지
    function stop() {
      isRunning = false;
      if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
    }
    
    // 원래 remove 함수를 래핑해서 애니메이션도 중지
    const originalRemove = hud.remove;
    hud.remove = function() {
      stop();
      originalRemove();
    };
    
    // 자동 시작
    start();
    
    return {
      ...hud,
      start,
      stop,
      isRunning: () => isRunning
    };
  }

  // 텍스처 전환 분석 유틸리티 함수들
  function analyzeTextureSwitches() {
    if (!window.getAtlasSwitchDetails) {
      console.error('Canvas profiler not loaded');
      return;
    }

    const details = window.getAtlasSwitchDetails();

    console.error("=== Texture Switch Analysis ===");
    console.error(`총 전환 횟수: ${details.totalSwitches}`);
    console.error(`사용된 텍스처 수: ${details.uniqueTextures}`);

    console.error("\n가장 빈번한 전환 패턴:");
    details.topSwitchPatterns.forEach(([pattern, count]) => {
      console.error(`${pattern}: ${count}회`);
    });

    console.error("\n모든 텍스처 목록:");
    details.textureNames.forEach(([id, name]) => {
      console.error(`${name}: ${id.toString().slice(0, 50)}...`);
    });
  }

  function logRealTimeSwitches() {
    if (!window.getCanvasProfileData) {
      console.error('Canvas profiler not loaded');
      return;
    }

    const data = window.getCanvasProfileData();
    console.error("이번 프레임 전환:", data.switchLog);
  }

  function findSpecificPatterns(searchTerm = 'character') {
    if (!window.getAtlasSwitchDetails) {
      console.error('Canvas profiler not loaded');
      return;
    }

    const details = window.getAtlasSwitchDetails();
    const matchingPatterns = details.switchLog.filter(log => 
      log.fromName.includes(searchTerm) || log.toName.includes(searchTerm)
    );
    console.error(`"${searchTerm}" 관련 전환:`, matchingPatterns);
  }

  function getOptimizationHints(threshold = 10) {
    if (!window.getAtlasSwitchDetails) {
      console.error('Canvas profiler not loaded');
      return;
    }

    const details = window.getAtlasSwitchDetails();
    const problematicPatterns = details.topSwitchPatterns
      .filter(([, count]) => count > threshold);

    console.error(`최적화 필요한 패턴 (${threshold}회 이상):`, problematicPatterns);
  }

  function clearSwitchLog() {
    if (!window.__clearAtlasLog) {
      console.error('Canvas profiler not loaded');
      return;
    }

    window.__clearAtlasLog();
    console.log('텍스처 전환 로그가 초기화되었습니다.');
  }

  // window.__hud 네임스페이스에 노출
  if (!window.__hud) window.__hud = {};
  
  // HUD 관련 (단축명)
  window.__hud.create = createCanvasProfilerHUD;
  window.__hud.auto = createAutoCanvasProfilerHUD;
  
  // 분석 도구들 (단축명)
  window.__hud.analyze = analyzeTextureSwitches;
  window.__hud.log = logRealTimeSwitches;
  window.__hud.find = findSpecificPatterns;
  window.__hud.hints = getOptimizationHints;
  window.__hud.clear = clearSwitchLog;
  
  // 기존 긴 이름도 유지 (호환성)
  window.__hud.createCanvasProfiler = createCanvasProfilerHUD;
  window.__hud.createAutoCanvasProfiler = createAutoCanvasProfilerHUD;
  window.__hud.analyzeTextureSwitches = analyzeTextureSwitches;
  window.__hud.logRealTimeSwitches = logRealTimeSwitches;
  window.__hud.findSpecificPatterns = findSpecificPatterns;
  window.__hud.getOptimizationHints = getOptimizationHints;
  window.__hud.clearSwitchLog = clearSwitchLog;

  console.log('Canvas Profiler HUD loaded');
})();