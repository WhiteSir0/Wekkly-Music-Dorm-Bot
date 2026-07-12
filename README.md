# Wekkly-Music-Dorm-Bot

요일별 YouTube Music 신청을 관리하는 Discord 봇입니다. 검색 API는 Oracle Cloud에서, Discord 봇과 SQLite 데이터는 Raspberry Pi에서 각각 실행합니다.

## 구성

- **Oracle Cloud (Japan)**: YouTube Music 검색 API (`4310/tcp`)
- **Raspberry Pi**: Discord 연결, 명령 처리, SQLite 저장, 주간 초기화와 마감 공지
- **서버 간 통신**: Tailscale 사설망과 Bearer 토큰

## Oracle 검색 API 배포

```bash
cp .env.search.example .env.search
docker compose -f compose.search.yml up -d --build
```

`.env.search`의 `SEARCH_API_TOKEN`을 임의의 긴 값으로 설정합니다. `4310/tcp`는 인터넷에 공개하지 않고 Tailscale 인터페이스에서만 허용합니다.

```bash
sudo ufw deny 4310/tcp
sudo ufw allow in on tailscale0 to any port 4310 proto tcp
curl http://127.0.0.1:4310/health
```

## Raspberry Pi 봇 배포

```bash
cp .env.bot.example .env.bot
docker compose -f compose.bot.yml up -d --build
```

`.env.bot`에 Discord 설정을 입력하고, `SEARCH_API_URL`에는 Oracle 서버의 Tailscale 주소를 지정합니다. `SEARCH_API_TOKEN`은 검색 API와 동일해야 합니다.

```env
SEARCH_API_URL=http://100.x.x.x:4310
```

## 테스트

```bash
npm test
```

## 라이선스와 원저작물

이 프로젝트는 `koori0831/YouTube-Music-Weekly-Scheduler-Bot`을 기반으로 수정되었습니다. 원저작물과 이 저장소의 배포 조건은 [LICENSE](LICENSE), 상세 귀속은 [NOTICE](NOTICE)를 확인하세요.
