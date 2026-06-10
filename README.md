# Rate Hike Watch

금리 인상 가능성을 직접 예측한다고 주장하지 않고, 인상 쪽으로 시장과 매크로 지표가 기울고 있는지 매일 같은 기준으로 보는 정적 웹페이지입니다.

## 구성

- `index.html`: 대시보드 화면
- `styles.css`: 반응형 스타일
- `app.js`: FRED 데이터 로딩, 점수 계산, 브라우저 저장 기록
- `data/fred-snapshot.json`: GitHub Pages용 FRED 스냅샷
- `.github/workflows/update-fred-snapshot.yml`: 평일 FRED 스냅샷 자동 갱신

## 주요 지표

- CME FedWatch 연내 인상 확률
- 미국 2년물 금리와 정책금리 상단의 차이
- CPI, Core PCE, 10년 기대인플레이션
- 실업률, 실업률 3개월 변화, 비농업 고용 서프라이즈
- Fed 발언 톤
