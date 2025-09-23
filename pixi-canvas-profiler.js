/**
 * PixiJS Canvas Performance Profiler
 * Canvas 모드에서 드로우콜과 텍스처 전환을 측정하는 프로파일러
 */

(function () {
  "use strict";

  // 이미 적용되었으면 중복 실행 방지
  if (window.__PIXI_CANVAS_PROFILER__) return;
  window.__PIXI_CANVAS_PROFILER__ = true;

  // spine 블렌드 트랙 제어용 상태 관리
  const __spineBlendTracker = {
    tracked: new Set(),
    paused: new Set(),
    destroyWrapped: new WeakSet(),
    pauseMeta: new WeakMap(),
  };

  function __registerSpineInstance(spine) {
    const tracker = __spineBlendTracker;
    if (!spine || tracker.tracked.has(spine)) return;
    tracker.tracked.add(spine);

    if (
      !tracker.destroyWrapped.has(spine) &&
      typeof spine.destroy === "function"
    ) {
      const originalDestroy = spine.destroy;
      spine.destroy = function (...args) {
        tracker.tracked.delete(spine);
        tracker.paused.delete(spine);
        tracker.pauseMeta.delete(spine);
        tracker.destroyWrapped.delete(spine);
        return originalDestroy.apply(this, args);
      };
      tracker.destroyWrapped.add(spine);
    }
  }

  function __patchSpineConstructor() {
    const spineNamespace = window.PIXI && window.PIXI.spine;
    if (!spineNamespace || !spineNamespace.Spine) return false;

    const OriginalSpine = spineNamespace.Spine;
    if (OriginalSpine.__HUD_TRACKER_PATCHED__) return true;

    function HudTrackedSpine(...args) {
      const newTarget = new.target || HudTrackedSpine;
      let instance;
      if (
        typeof Reflect === "object" &&
        typeof Reflect.construct === "function"
      ) {
        instance = Reflect.construct(OriginalSpine, args, newTarget);
      } else {
        instance = new OriginalSpine(...args);
      }
      __registerSpineInstance(instance);
      return instance;
    }

    HudTrackedSpine.prototype = OriginalSpine.prototype;
    Object.defineProperty(HudTrackedSpine.prototype, "constructor", {
      value: HudTrackedSpine,
      writable: true,
      configurable: true,
    });

    Object.setPrototypeOf(HudTrackedSpine, OriginalSpine);

    Object.getOwnPropertyNames(OriginalSpine).forEach((prop) => {
      if (prop === "prototype") return;
      if (Object.prototype.hasOwnProperty.call(HudTrackedSpine, prop)) return;
      const descriptor = Object.getOwnPropertyDescriptor(OriginalSpine, prop);
      if (descriptor) {
        Object.defineProperty(HudTrackedSpine, prop, descriptor);
      }
    });

    Object.defineProperty(OriginalSpine, "__HUD_TRACKER_PATCHED__", {
      value: true,
      writable: false,
      configurable: true,
    });

    Object.defineProperty(HudTrackedSpine, "__HUD_TRACKER_PATCHED__", {
      value: true,
      writable: false,
      configurable: true,
    });

    Object.defineProperty(HudTrackedSpine, "__HUD_TRACKER_WRAPPER__", {
      value: OriginalSpine,
      writable: false,
      configurable: true,
    });

    spineNamespace.Spine = HudTrackedSpine;
    return true;
  }

  function __ensureSpineTracking() {
    return __patchSpineConstructor();
  }

  function __getBlendSlotsFromSkeleton(spine) {
    // spine skeleton에서 blend 속성이 있는 slot들 추출
    const blendSlots = new Set();
    try {
      const skeleton = spine.skeleton || spine.spineData;
      if (skeleton && skeleton.slots) {
        for (let i = 0; i < skeleton.slots.length; i++) {
          const slot = skeleton.slots[i];
          if (slot && slot.blend && slot.blend !== "normal") {
            blendSlots.add(slot.name);
          }
          if (slot && typeof slot.blendMode === "number" && slot.blendMode !== 0) {
            blendSlots.add(slot.name);
          }
        }
      }
    } catch (e) {
      /* noop */
    }
    return blendSlots;
  }

  function __isBlendAnimation(entry, trackIndex, spine) {
    if (!entry) return false;
    
    // 1. Track 1+ (보조 트랙)은 일반적으로 blend용
    if (trackIndex > 0) return true;
    
    // 2. Alpha blending (불투명도 < 1.0)
    if (typeof entry.alpha === "number" && entry.alpha < 1.0) return true;
    
    // 3. MixBlend 속성 확인 (spine runtime에서 지원하는 경우)
    if (entry.mixBlend && entry.mixBlend !== "normal") return true;
    
    // 4. spine skeleton에서 blend slot들을 가져옴
    const blendSlots = __getBlendSlotsFromSkeleton(spine);
    if (blendSlots.size === 0) return false;
    
    // 5. 애니메이션이 blend slot들을 조작하는지 확인
    const animation = entry.animation;
    if (!animation) return false;
    
    // animation.slots 객체에서 blend slot이 포함되어 있는지 확인
    if (animation.slots) {
      for (const slotName in animation.slots) {
        if (blendSlots.has(slotName)) {
          return true;
        }
      }
    }
    
    // animation.timelines에서 slot 관련 타임라인 확인 (선택적)
    if (animation.timelines) {
      for (let i = 0; i < animation.timelines.length; i++) {
        const timeline = animation.timelines[i];
        if (timeline && timeline.slotIndex !== undefined) {
          // slotIndex를 slot name으로 변환해서 확인
          try {
            const skeleton = spine.skeleton || spine.spineData;
            if (skeleton && skeleton.slots && skeleton.slots[timeline.slotIndex]) {
              const slotName = skeleton.slots[timeline.slotIndex].name;
              if (blendSlots.has(slotName)) {
                return true;
              }
            }
          } catch (e) {
            /* noop */
          }
        }
      }
    }
    
    return false;
  }

  function __stopBlendAnimations() {
    __ensureSpineTracking();
    const tracker = __spineBlendTracker;
    let stoppedCount = 0;
    let totalChecked = 0;

    tracker.tracked.forEach((spine) => {
      if (!spine || !spine.state) return;
      if (tracker.paused.has(spine)) return;

      const state = spine.state;
      const tracks = Array.isArray(state.tracks) ? state.tracks : [];
      const restoreData = [];

      for (let i = 0; i < tracks.length; i++) {
        const entry = tracks[i];
        const animationName = entry && entry.animation && entry.animation.name;
        if (!entry || !animationName) continue;
        
        totalChecked++;
        
        // blend 애니메이션인지 검증
        if (!__isBlendAnimation(entry, i, spine)) continue;
        
        restoreData.push({
          index: i,
          animationName,
          loop: !!entry.loop,
          timeScale: entry.timeScale,
          alpha: entry.alpha,
          trackTime: entry.trackTime,
          animationStart: entry.animationStart,
          animationEnd: entry.animationEnd,
        });
      }

      if (!restoreData.length) return;

      restoreData.sort((a, b) => a.index - b.index);
      for (let j = 0; j < restoreData.length; j++) {
        const trackIndex = restoreData[j].index;
        // clearTrack 대신 timeScale과 alpha로만 정지
        const track = state.tracks[trackIndex];
        if (track) {
          track.timeScale = 0;
          track.alpha = 0;
        }
      }
      
      // 원래 값들을 먼저 저장
      const originalAutoUpdate = spine.autoUpdate;
      const originalVisible = spine.visible;
      
      // spine 전체 업데이트를 멈춤
      if (spine.autoUpdate !== undefined) {
        spine.autoUpdate = false;
      }
      
      // spine을 화면에서 숨김
      spine.visible = false;

      tracker.pauseMeta.set(spine, {
        restoreData,
        originalAutoUpdate,
        originalVisible
      });
      tracker.paused.add(spine);
      stoppedCount++;
    });

    if (console && console.log) {
      console.log(
        `[HUD] stopBlend: ${stoppedCount} spine instance(s) stopped (${totalChecked} tracks checked).`
      );
    }
    return stoppedCount;
  }

  function __playBlendAnimations() {
    __ensureSpineTracking();
    const tracker = __spineBlendTracker;
    const toResume = Array.from(tracker.paused);
    let resumedCount = 0;

    for (let i = 0; i < toResume.length; i++) {
      const spine = toResume[i];
      tracker.paused.delete(spine);
      if (!spine || !spine.state) {
        tracker.pauseMeta.delete(spine);
        continue;
      }

      const state = spine.state;
      const meta = tracker.pauseMeta.get(spine);
      if (!meta || !Array.isArray(meta.restoreData) || !meta.restoreData.length) continue;

      // autoUpdate와 visible 복원
      if (meta.originalAutoUpdate !== undefined) {
        spine.autoUpdate = meta.originalAutoUpdate;
      }
      if (meta.originalVisible !== undefined) {
        spine.visible = meta.originalVisible;
      }

      // 기존 정지된 track들 정리
      meta.restoreData.forEach(info => {
        if (info && typeof info.index === "number") {
          state.clearTrack(info.index);
        }
      });

      meta.restoreData.sort((a, b) => a.index - b.index);
      for (let j = 0; j < meta.restoreData.length; j++) {
        const info = meta.restoreData[j];
        if (!info || typeof info.index !== "number" || !info.animationName)
          continue;
        const entry = state.setAnimation(
          info.index,
          info.animationName,
          !!info.loop
        );
        if (!entry) continue;
        if (typeof info.timeScale === "number")
          entry.timeScale = info.timeScale;
        if (typeof info.alpha === "number") entry.alpha = info.alpha;
        if (typeof info.trackTime === "number")
          entry.trackTime = info.trackTime;
        if (typeof info.animationStart === "number")
          entry.animationStart = info.animationStart;
        if (typeof info.animationEnd === "number")
          entry.animationEnd = info.animationEnd;
      }

      tracker.pauseMeta.delete(spine);
      resumedCount++;
    }

    if (resumedCount > 0 && console && console.log) {
      console.log(
        `[HUD] playBlend: ${resumedCount} spine instance(s) resumed.`
      );
    }
    return resumedCount;
  }

  __ensureSpineTracking();

  /* ==========================================================
     Canvas 2D API 패칭 (드로우콜 계측)
  ========================================================== */
  (function patchCanvas2D() {
    const proto =
      window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
    if (!proto || proto.__PIXI_CANVAS_PROF__) return;
    proto.__PIXI_CANVAS_PROF__ = true;

    const counters = {
      total: 0,
      raster: 0, // drawImage + putImageData
      path: 0, // fill/stroke/rect
      text: 0, // fillText/strokeText
      clear: 0, // clearRect
      clip: 0, // clip
      blendChanges: 0, // globalCompositeOperation 변경
      texturesUsed: 0, // 고유 이미지 소스 수
    };

    const uniqueSources = new Set();

    // 전역 접근 가능하도록 노출
    window.__canvasCounters = counters;
    window.__resetCanvasCounters = function () {
      counters.total = counters.raster = counters.path = counters.text = 0;
      counters.clear = counters.clip = counters.blendChanges = 0;
      uniqueSources.clear();
      counters.texturesUsed = 0;
    };

    // 메서드 래핑 함수
    const wrap = (name, bucket) => {
      const orig = proto[name];
      if (!orig) return;

      proto[name] = function (...args) {
        // 카운팅
        if (bucket === "raster_drawImage") {
          counters.raster++;
          counters.total++;
          const src = args[0];
          if (src) {
            uniqueSources.add(src);
            counters.texturesUsed = uniqueSources.size;
          }
        } else if (bucket === "raster_putImageData") {
          counters.raster++;
          counters.total++;
        } else if (bucket === "path") {
          counters.path++;
          counters.total++;
        } else if (bucket === "text") {
          counters.text++;
          counters.total++;
        } else if (bucket === "clear") {
          counters.clear++;
          counters.total++;
        } else if (bucket === "clip") {
          counters.clip++;
          counters.total++;
        }

        // 원본 메서드 호출
        return orig.apply(this, args);
      };
    };

    // raster operations
    wrap("drawImage", "raster_drawImage");
    wrap("putImageData", "raster_putImageData");

    // path/shape operations
    ["fill", "stroke", "fillRect", "strokeRect"].forEach((fn) =>
      wrap(fn, "path")
    );

    // text operations
    ["fillText", "strokeText"].forEach((fn) => wrap(fn, "text"));

    // clear & clip operations
    wrap("clearRect", "clear");
    wrap("clip", "clip");

    // globalCompositeOperation 변경 감지
    const desc = Object.getOwnPropertyDescriptor(
      proto,
      "globalCompositeOperation"
    );
    if (desc && desc.set && desc.get) {
      Object.defineProperty(proto, "globalCompositeOperation", {
        get: desc.get,
        set(v) {
          const cur = desc.get.call(this);
          if (v !== cur) counters.blendChanges++;
          return desc.set.call(this, v);
        },
      });
    } else {
      let _gco = "source-over";
      Object.defineProperty(proto, "globalCompositeOperation", {
        get() {
          return _gco;
        },
        set(v) {
          if (v !== _gco) {
            counters.blendChanges++;
            _gco = v;
          }
        },
      });
    }
  })();

  /* ==========================================================
     PixiJS 아틀라스 전환 추적
  ========================================================== */
  window.__atlasCanvas = {
    switches: 0,
    unique: 0,
    _lastId: null,
    _set: new Set(),
    _switchLog: [], // 전환 로그
    _textureNames: new Map(), // 텍스처 ID -> 이름 매핑
    _loggingEnabled: false, // 로깅 기본값 OFF
    _maxLogSize: 500, // 최대 로그 크기
  };

  window.__resetAtlasCanvas = function () {
    const A = window.__atlasCanvas;
    A.switches = 0;
    A.unique = 0;
    A._lastId = null;
    A._set.clear();
    // _switchLog와 _textureNames는 리셋하지 않고 누적 (세션 전체 로그 유지)
  };

  // 로그까지 완전히 초기화하는 함수 (별도 제공)
  window.__clearAtlasLog = function () {
    const A = window.__atlasCanvas;
    A._switchLog = [];
    A._textureNames.clear();
  };

  // 로깅 on/off 제어
  window.__toggleAtlasLogging = function () {
    const A = window.__atlasCanvas;
    A._loggingEnabled = !A._loggingEnabled;
    return A._loggingEnabled;
  };

  window.__setAtlasLogging = function (enabled) {
    window.__atlasCanvas._loggingEnabled = !!enabled;
  };

  window.__isAtlasLoggingEnabled = function () {
    return window.__atlasCanvas._loggingEnabled;
  };

  // window.__hud 네임스페이스에도 노출
  if (!window.__hud) window.__hud = {};

  // 단축명
  window.__hud.reset = window.__resetAtlasCanvas;
  window.__hud.clearLog = window.__clearAtlasLog;
  window.__hud.toggle = window.__toggleAtlasLogging;
  window.__hud.status = window.__isAtlasLoggingEnabled;
  window.__hud.stopBlend = __stopBlendAnimations;
  window.__hud.playBlend = __playBlendAnimations;

  // 기존 긴 이름도 유지 (호환성)
  window.__hud.resetAtlasCanvas = window.__resetAtlasCanvas;
  window.__hud.clearAtlasLog = window.__clearAtlasLog;
  window.__hud.toggleAtlasLogging = window.__toggleAtlasLogging;
  window.__hud.isAtlasLoggingEnabled = window.__isAtlasLoggingEnabled;
  window.__hud.stopBlendAnimations = __stopBlendAnimations;
  window.__hud.playBlendAnimations = __playBlendAnimations;

  // BaseTexture ID 추출 + 이름 학습
  function __getAtlasIdFromBaseTexture(baseTexture) {
    if (!baseTexture) return null;

    let id;
    let name = "unknown";

    // 기존 소스가 있으면 우선 사용
    const src =
      baseTexture.source || baseTexture.imageUrl || baseTexture._imageUrl;
    if (src) {
      id = src;
      // 이미지 URL에서 파일명 추출
      if (typeof src === "string") {
        const match = src.match(/([^\/]+)\.([^\.]+)$/);
        name = match ? match[1] : src.slice(0, 20);
      } else if (src.src) {
        const match = src.src.match(/([^\/]+)\.([^\.]+)$/);
        name = match ? match[1] : "image";
      } else {
        name = "canvas";
      }
    } else {
      // 없으면 고유 ID 생성
      if (!baseTexture.__atlasId) {
        if (window.PIXI && PIXI.utils && PIXI.utils.uid) {
          baseTexture.__atlasId = "bt_" + PIXI.utils.uid();
        } else {
          baseTexture.__atlasId = "bt_" + Math.random().toString(36).slice(2);
        }
      }
      id = baseTexture.__atlasId;
      name = "renderTexture";
    }

    // 이름 매핑 저장 (로깅 활성화된 경우에만)
    if (window.__atlasCanvas._loggingEnabled) {
      window.__atlasCanvas._textureNames.set(id, name);
    }

    return id;
  }

  // BaseTexture 사용 기록
  function __noteCanvasAtlas(baseTexture) {
    const A = window.__atlasCanvas;
    const id = __getAtlasIdFromBaseTexture(baseTexture);
    if (id == null) return;

    // 전환 감지 + 로깅
    if (A._lastId !== null && A._lastId !== id) {
      A.switches++;

      // 전환 로그 기록 (로깅 활성화된 경우에만)
      if (A._loggingEnabled) {
        const fromName = A._textureNames.get(A._lastId) || "unknown";
        const toName = A._textureNames.get(id) || "unknown";
        A._switchLog.push({
          from: A._lastId,
          to: id,
          fromName,
          toName,
          count: A.switches,
        });

        // 로그 크기 제한 (최근 N개만 유지)
        if (A._switchLog.length > A._maxLogSize) {
          A._switchLog.splice(0, A._switchLog.length - A._maxLogSize);
        }
      }
    }
    A._lastId = id;

    // 고유 아틀라스 집계
    A._set.add(id);
    A.unique = A._set.size;
  }

  // PixiJS가 로드되면 패칭 적용
  function applyPixiPatches() {
    if (!window.PIXI) return;
    __ensureSpineTracking();

    // Sprite 패칭
    if (PIXI.Sprite && PIXI.Sprite.prototype._renderCanvas) {
      const P = PIXI.Sprite.prototype;
      if (!P.__ATLAS_CANVAS_PATCHED__) {
        P.__ATLAS_CANVAS_PATCHED__ = true;
        const orig = P._renderCanvas;

        P._renderCanvas = function (renderer) {
          try {
            const tex = this.texture;
            const base = tex && tex.baseTexture;
            __noteCanvasAtlas(base);
          } catch (e) {
            /* noop */
          }

          return orig.apply(this, arguments);
        };
      }
    }

    // Mesh 패칭
    if (PIXI.mesh && PIXI.mesh.Mesh && PIXI.mesh.Mesh.prototype._renderCanvas) {
      const M = PIXI.mesh.Mesh.prototype;
      if (!M.__ATLAS_CANVAS_PATCHED__) {
        M.__ATLAS_CANVAS_PATCHED__ = true;
        const orig = M._renderCanvas;

        M._renderCanvas = function (renderer) {
          try {
            const tex = this.texture || (this.shader && this.shader.texture);
            const base = tex && tex.baseTexture;
            __noteCanvasAtlas(base);
          } catch (e) {
            /* noop */
          }

          return orig.apply(this, arguments);
        };
      }
    }

    // pixi-spine v1.x 패칭 (선택적)
    if (
      PIXI.spine &&
      PIXI.spine.SpineBase &&
      PIXI.spine.SpineBase.prototype._renderCanvas
    ) {
      const S = PIXI.spine.SpineBase.prototype;
      if (!S.__SPINE_CANVAS_PATCHED__) {
        S.__SPINE_CANVAS_PATCHED__ = true;
        const orig = S._renderCanvas;

        S._renderCanvas = function (renderer) {
          try {
            __registerSpineInstance(this);
            // Spine 슬롯별 텍스처 추적
            if (this.skeleton && this.skeleton.slots) {
              for (let i = 0; i < this.skeleton.slots.length; i++) {
                const slot = this.skeleton.slots[i];
                const attachment = slot.attachment || slot.getAttachment();
                if (
                  attachment &&
                  attachment.texture &&
                  attachment.texture.baseTexture
                ) {
                  __noteCanvasAtlas(attachment.texture.baseTexture);
                }
              }
            }
          } catch (e) {
            /* noop */
          }

          return orig.apply(this, arguments);
        };
      }
    }
  }

  // PixiJS 로드 대기
  if (window.PIXI) {
    applyPixiPatches();
  } else {
    // PixiJS가 나중에 로드될 경우를 대비
    const checkPixi = setInterval(() => {
      if (window.PIXI) {
        clearInterval(checkPixi);
        applyPixiPatches();
      }
    }, 100);

    // 5초 후 체크 중단
    setTimeout(() => clearInterval(checkPixi), 5000);
  }

  /* ==========================================================
     편의 함수들
  ========================================================== */

  // 프레임별 리셋 (ticker나 requestAnimationFrame에서 호출)
  window.resetCanvasProfiler = function () {
    if (window.__resetCanvasCounters) window.__resetCanvasCounters();
    if (window.__resetAtlasCanvas) window.__resetAtlasCanvas();
  };

  // 현재 프로파일링 데이터 반환
  window.getCanvasProfileData = function () {
    const c = window.__canvasCounters || {};
    const a = window.__atlasCanvas || {};

    return {
      total: c.total || 0,
      raster: c.raster || 0,
      path: c.path || 0,
      text: c.text || 0,
      clear: c.clear || 0,
      clip: c.clip || 0,
      blendChanges: c.blendChanges || 0,
      texturesUsed: c.texturesUsed || 0,
      atlasSwitches: a.switches || 0,
      uniqueAtlases: a.unique || 0,
      switchLog: [...(a._switchLog || [])], // 전환 로그 복사본
    };
  };

  // 텍스처 전환 상세 분석
  window.getAtlasSwitchDetails = function () {
    const a = window.__atlasCanvas || {};
    const log = a._switchLog || [];
    const names = a._textureNames || new Map();

    // 전환 패턴 분석
    const switchPatterns = new Map();
    log.forEach((entry) => {
      const pattern = `${entry.fromName} → ${entry.toName}`;
      switchPatterns.set(pattern, (switchPatterns.get(pattern) || 0) + 1);
    });

    // 가장 빈번한 전환 패턴
    const topPatterns = Array.from(switchPatterns.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);

    return {
      totalSwitches: log.length,
      switchLog: log,
      textureNames: Array.from(names.entries()),
      topSwitchPatterns: topPatterns,
      uniqueTextures: names.size,
    };
  };

  console.log("PixiJS Canvas Profiler loaded");
})();
