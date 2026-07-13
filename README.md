# Wekkly-Music-Dorm-Bot

요일별 YouTube Music 신청을 관리하는 Discord 봇입니다. 검색 API는 Oracle Cloud에서, Discord 봇과 SQLite 데이터는 Raspberry Pi에서 각각 실행합니다.

## 구성

- **Oracle Cloud (Japan)**: YouTube Music 검색 API (`4310/tcp`)
- **Raspberry Pi**: Discord 연결, 명령 처리, SQLite 저장, 주간 초기화와 마감 공지
- **서버 간 통신**: Tailscale 사설망과 Bearer 토큰

## Oracle 검색 API 배포

```bash
cp .env.search.example .env.search
docker compose --env-file .env.search -f compose.search.yml up -d --build
```

`.env.search`의 `SEARCH_API_TOKEN`을 임의의 긴 값으로 설정하고 `SEARCH_BIND_ADDRESS`에는 Oracle 서버의 Tailscale IPv4 주소를 입력합니다. `4310/tcp`는 인터넷에 공개하지 않습니다.

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

봇을 서버에 추가한 뒤 관리자가 `/채널설정 신청채널 공지채널`을 실행합니다. 설정은 SQLite에 서버별로 저장되며, `/신청`은 지정된 신청 채널에서만 동작하고 마감 플레이리스트는 지정된 공지 채널로 전송됩니다. `SONG_REQUEST_CHANNEL_ID`와 `SONG_ANNOUNCEMENT_CHANNEL_ID`는 아직 설정하지 않은 서버를 위한 선택적 폴백입니다.

노래 신청자 이름은 같은 서버의 기숙사 봇 `/학번등록` 이름을 우선 사용합니다. 등록 정보가 없으면 Discord 서버 프로필 이름을 사용하며, 기숙사 봇의 `database` 폴더는 미쿠봇 컨테이너에 읽기 전용으로 연결됩니다.

`/정보`에서 봇 정보와 공개 원본 소스 링크를 확인할 수 있습니다.

## 테스트

```bash
npm test
```

## 라이선스와 원저작물

공개 소스: [WhiteSir0/Wekkly-Music-Dorm-Bot](https://github.com/WhiteSir0/Wekkly-Music-Dorm-Bot)

이 프로젝트는 `koori0831/YouTube-Music-Weekly-Scheduler-Bot`을 기반으로 수정되었습니다. 기존 원저작자 귀속과 배포 조건은 그대로 유지됩니다. [LICENSE](LICENSE)와 상세 귀속인 [NOTICE](NOTICE)를 확인하세요.
