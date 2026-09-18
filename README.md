# PeerCord — Phase 1: Skeleton & Peer Discovery

Децентрализованный P2P-аналог Discord для локальной сети.
**Фаза 1** реализует: каркас Tauri-приложения, mDNS-обнаружение пиров,
TCP-сигналинг и первый WebRTC DataChannel между двумя инстансами.

---

## Архитектура Фазы 1

```

┌─────────────────────────── PeerCord Instance A ───────────────────────────┐
│                                                                            │
│  React UI (Zustand)                                                        │
│      │  invoke()                        ▲ emit("peer:found")               │
│      ▼                                  │                                  │
│  ┌───────────────── Tauri Core (Rust) ──┴───────────────────────────────┐  │
│  │  discovery.rs   →  mdns-sd  →  _peercord._tcp.local.  (LAN broadcast)│  │
│  │  signaling.rs   →  TCP listener on random port (line-delimited JSON) │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│      │                                                                     │
│      ▼                                                                     │
│  peerManager.ts → RTCPeerConnection (perfect negotiation) → DataChannel    │
└────────────────────────────────────────────────────────────────────────────┘
▲
mDNS + TCP signaling (no central server)
▼
┌─────────────────────────── PeerCord Instance B ───────────────────────────┐
└────────────────────────────────────────────────────────────────────────────┘

```

### Обмен SDP/ICE
1. Оба инстанса регистрируют mDNS-сервис `_peercord._tcp.local.` с TXT-записями
   `peer_id`, `name`, `port` (порт TCP-сигналинга).
2. При обнаружении пира каждый клиент открывает `RTCPeerConnection`.
   Инициатор определяется детерминированно: `selfId < peerId` → impolite (создаёт offer + DataChannel).
3. SDP/ICE передаются напрямую по TCP (`send_signal`), без сервера.

---

## Требования

- **Rust** ≥ 1.77 (`rustup`)
- **Node.js** ≥ 18
- **Tauri CLI v2**: `cargo install tauri-cli --version "^2.0"` (или используйте `npx tauri`)

Системные зависимости Tauri: см. https://tauri.app/start/prerequisites/

---

## Установка

```bash
cd peercord
npm install
```

### Иконки

Tauri требует набор иконок в `src-tauri/icons/`. Сгенерируйте их из любого PNG 1024×1024:

```
npx tauri icon ./path/to/logo.png
```

(Либо скопируйте дефолтные иконки из `create-tauri-app`.)

---

## Запуск

### Первый инстанс

```
npm run tauri dev
```

### Второй инстанс (для проверки P2P)

Vite-дев-сервер уже занят первым инстансом, поэтому запускаем второй экземпляр
бинаря напрямую:

```
# после первой сборки:
./src-tauri/target/debug/peercord
```

> На Windows: `src-tauri\target\debug\peercord.exe`
> На macOS: `src-tauri/target/debug/peercord`

Оба окна должны автоматически обнаружить друг друга и установить DataChannel
(статус `connected` в правом сайдбаре). Кнопка **Broadcast** отправляет
тестовый пакет по всем открытым каналам — он появится в логе второго окна.

---

## Структура проекта

```
peercord/
├─ src/                          # Frontend (React + TS)
│  ├─ components/                # UI-компоненты (стиль Discord)
│  │  ├─ ServerRail.tsx
│  │  ├─ ChannelSidebar.tsx
│  │  ├─ TopBar.tsx
│  │  ├─ NetworkPanel.tsx        # ядро Фазы 1: пиры + лог
│  │  ├─ MemberSidebar.tsx
│  │  └─ StatusBar.tsx
│  ├─ lib/
│  │  ├─ types.ts                # общие типы
│  │  └─ tauriBridge.ts          # обёртка над invoke/listen
│  ├─ services/
│  │  ├─ peerLink.ts             # RTCPeerConnection + DataChannel
│  │  ├─ peerManager.ts          # оркестрация связей
│  │  └─ bootstrap.ts            # старт узла + подписки на события
│  ├─ store/
│  │  └─ useAppStore.ts          # Zustand
│  ├─ App.tsx
│  ├─ main.tsx
│  └─ styles.css
└─ src-tauri/                    # Backend (Rust)
   ├─ src/
   │  ├─ main.rs
   │  ├─ lib.rs                  # Tauri commands + state
   │  ├─ discovery.rs            # mDNS (mdns-sd)
   │  └─ signaling.rs            # TCP signaling server
   ├─ capabilities/default.json
   ├─ Cargo.toml
   ├─ build.rs
   └─ tauri.conf.json
```

---

## Tauri Commands (Фаза 1)

| Command ↕▾ | Аргументы ↕▾ | Возврат ↕▾ |
|---|---|---|
| −`start_node` | `peerId`, `displayName` | `{ peerId, displayName, signalPort }` |
| −`stop_node` | — | `void` |
| −`get_node_info` | — | `NodeInfo | null` |
| −`send_signal` | `addr`, `port`, `message` | `void` |
⚙

## Tauri Events (Фаза 1)

| Event ↕▾ | Payload ↕▾ |
|---|---|
| −`peer:found` | `{ peerId, displayName, address, port, fullname }` |
| −`peer:lost` | `{ peerId, fullname }` |
| −`signal:incoming` | `{ from, fromName, fromSignalPort, kind, payload, addr }` |
⚙

---

## Что дальше (не входит в Фазу 1)

- **Фаза 2** — Yjs поверх DataChannel, каналы `#general` / `#media`, SQLite-кэш
- **Фаза 3** — Voice Mesh (Opus, VAD, PTT, индикация говорящего)
- **Фаза 4** — Screen Share + синхронный YouTube-плеер
- **Фаза 5** — полировка UI, обработка реконнектов

---

## Отладка

- Логи Rust: `RUST_LOG=debug npm run tauri dev`
- Если пиры не находят друг друга — проверьте, что firewall не блокирует
**UDP 5353** (mDNS) и входящие TCP-соединения на случайном порту сигналинга.
- В корпоративных сетях multicast может быть отключён — тогда нужен ручной
ввод IP (будет добавлено в Фазе 5).

