# PixiJS 4.7 Canvas 모드 Draw Call 프로파일러 정리 (보완판)

## 1. 개요
PixiJS 4.7의 **Canvas 모드**에서 실제 렌더링 비용을 파악하기 위해 2D Context API 호출을 계측하는 방식의 프로파일러를 정리했다.  
본 문서는 **드로우콜 기반 지표 정의**, **패치 방식**, **활용 방법**을 설명하며, 기존 정리에서 검증·보완된 부분을 포함한다.

---

## 2. 계측 지표 정의

### 핵심 카운터
- **drawImageCount**: 모든 drawImage 호출 횟수
- **pathCount**: `fill` / `stroke` 호출 횟수
- **textCount**: `fillText` / `strokeText` 호출 횟수  
  - 단, `PIXI.Text`는 내부 전용 canvas에 캐시 후 drawImage로 붙이므로 **텍스트 내용이 변경될 때만 증가**.
- **clearCount**: `clearRect` 호출 횟수
- **clipCount**: `clip` 호출 횟수
- **atlasSwitches**: 다른 BaseTexture(아틀라스)로 전환될 때 증가  
  - 단, Canvas에는 WebGL 같은 배치 개념이 없으므로 **“핵심 지표 중 하나”**로만 기술.

### 보완 지표
- **fillRate**: 모든 drawImage의 `(dstW × dstH)` 합 → 픽셀 단위의 실제 그려진 면적
- **transformChanges**: `setTransform`/`transform` 호출 횟수
- **stateStackCount**: `save`/`restore` 호출 횟수
- **stateChanges**: `globalAlpha`, `imageSmoothingEnabled`, `shadow*`, `filter` 등 상태 전환 횟수
- **sourceTypeBreakdown**: Image / Canvas / Video / ImageBitmap 별 draw 카운트
- **resampleRatioSum**: src→dst 리샘플링 비율 합계 (특히 다운스케일 비용 확인)

---

## 3. 구현 방식

### Context 패치
- 모든 `CanvasRenderingContext2D` 프로토타입의 주요 메서드를 래핑
- 전역 카운터 대신 **renderer(view) 단위 네임스페이스**를 권장
- 오프스크린 캔버스/내부 텍스처도 계측 가능하나, **Pixi 초기화 전에 패치 주입 필요**

### 렌더 대상별 패치
- Sprite, Graphics, Text, TilingSprite 중심
- Mesh/Spine 등은 Canvas 지원이 제한적이므로 **존재 여부 확인 후 조건부 패치**

### 성능 오버헤드
- 호출 래핑에 따른 오버헤드는 보통 3~5% 이내  
- HUD를 끄면 오버헤드가 거의 0에 수렴

---

## 4. 사용 가이드

### HUD 표시
- 프레임별 카운터 표시
- Top-N atlas 전환 경로 표시 (`from → to`)
- 프레임 CPU 시간(`performance.now()`) 병기

### 분석 시 고려 사항
- **텍스트**: `PIXI.Text`는 캐시 기반이라 텍스트 변경 빈도가 핵심
- **Clear vs Overdraw**: `clearRect` + 전체 그리기 vs **배경 불투명 덮기** 성능 차이는 브라우저/장면에 따라 다름 → 반드시 실측 비교
- **픽셀 비용**: 단순 호출 수보다 fill rate(픽셀 면적 합)가 실제 성능 상관성이 높음

### 결과 내보내기
- JSON/CSV로 프레임별 지표 저장 가능
- 세션 종료 시 내보내기 버튼 제공 권장

---

## 5. 안전장치 / 호환성
- **브라우저 가드**: `context.filter` 등 브라우저별 지원 차이 확인 필요
- **패치 가드**: `prototype._renderCanvas` 존재 확인 후 래핑
- **Re-entrancy**: 원본 함수 핸들 보존, 객체 생성 최소화

---

## 6. 요약
- **Canvas 렌더링 성능**은 호출 수뿐 아니라 **픽셀 면적, 상태 전환, 소스 전환 빈도**가 핵심
- 본 프로파일러는 PixiJS 4.7 Canvas 모드에서 **프레임 단위 병목 파악**을 지원
- 실측 기반 보완 지표(filled pixel, transform, state change 등)를 함께 추적하면 정확성이 높아짐
